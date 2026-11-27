package main

import (
	"bytes"
	"crypto"
	"crypto/cipher"
	"crypto/des"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"context"

	"github.com/smallstep/pkcs7"
	"github.com/smallstep/scep"
)

// Positive fixtures for each content cipher that SCEP clients send. They are
// made with the same pkcs7 library that the gateway uses, plus one 3DES envelope
// built here because the library does not encrypt with 3DES.

var aesCiphers = []struct {
	name      string
	algorithm int
	length    int
}{
	{"AES-128-CBC", pkcs7.EncryptionAlgorithmAES128CBC, 16},
	{"AES-256-CBC", pkcs7.EncryptionAlgorithmAES256CBC, 32},
	{"AES-128-GCM", pkcs7.EncryptionAlgorithmAES128GCM, 16},
	{"AES-256-GCM", pkcs7.EncryptionAlgorithmAES256GCM, 32},
}

// withContentCipher sets the global pkcs7 content cipher for one test.
func withContentCipher(t *testing.T, algorithm int) {
	t.Helper()
	saved := pkcs7.ContentEncryptionAlgorithm
	pkcs7.ContentEncryptionAlgorithm = algorithm
	t.Cleanup(func() { pkcs7.ContentEncryptionAlgorithm = saved })
}

// toIndefiniteBER rewrites every constructed element of a DER encoding with the
// BER indefinite length form, as some SCEP clients send it.
func toIndefiniteBER(t testing.TB, der []byte) []byte {
	t.Helper()
	var out []byte
	for len(der) > 0 {
		var raw asn1.RawValue
		rest, err := asn1.Unmarshal(der, &raw)
		if err != nil {
			t.Fatal(err)
		}
		if raw.IsCompound {
			out = append(out, raw.FullBytes[0], 0x80)
			out = append(out, toIndefiniteBER(t, raw.Bytes)...)
			out = append(out, 0, 0)
		} else {
			out = append(out, raw.FullBytes...)
		}
		der = rest
	}
	return out
}

func mustMarshal(t testing.TB, v any) []byte {
	t.Helper()
	der, err := asn1.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return der
}

// envelope builds an EnvelopedData ContentInfo with one RSA PKCS#1 v1.5
// recipient. The caller gives the content cipher and its encrypted content.
func envelope(t testing.TB, recipient *x509.Certificate, sessionKey []byte, cipherAlgorithm pkix.AlgorithmIdentifier, encrypted []byte) []byte {
	t.Helper()
	wrapped, err := rsa.EncryptPKCS1v15(rand.Reader, recipient.PublicKey.(*rsa.PublicKey), sessionKey)
	if err != nil {
		t.Fatal(err)
	}
	recipientInfo := mustMarshal(t, struct {
		Version               int
		IssuerAndSerialNumber struct {
			Issuer asn1.RawValue
			Serial *big.Int
		}
		KeyEncryptionAlgorithm pkix.AlgorithmIdentifier
		EncryptedKey           []byte
	}{0, struct {
		Issuer asn1.RawValue
		Serial *big.Int
	}{asn1.RawValue{FullBytes: recipient.RawIssuer}, recipient.SerialNumber},
		pkix.AlgorithmIdentifier{Algorithm: pkcs7.OIDEncryptionAlgorithmRSA, Parameters: asn1.NullRawValue}, wrapped})
	enveloped := mustMarshal(t, struct {
		Version        int
		RecipientInfos asn1.RawValue
		ECI            struct {
			ContentType asn1.ObjectIdentifier
			Algorithm   pkix.AlgorithmIdentifier
			Content     asn1.RawValue
		}
	}{0, asn1.RawValue{Class: 0, Tag: 17, IsCompound: true, Bytes: recipientInfo}, struct {
		ContentType asn1.ObjectIdentifier
		Algorithm   pkix.AlgorithmIdentifier
		Content     asn1.RawValue
	}{pkcs7.OIDData, cipherAlgorithm, asn1.RawValue{Class: 2, Tag: 0, Bytes: encrypted}}})
	return mustMarshal(t, struct {
		ContentType asn1.ObjectIdentifier
		Content     asn1.RawValue
	}{oidEnvelopedData, asn1.RawValue{Class: 2, Tag: 0, IsCompound: true, Bytes: enveloped}})
}

// tripleDESEnvelope encrypts content with DES-EDE3-CBC (RFC 3370 section 5.1).
func tripleDESEnvelope(t testing.TB, recipient *x509.Certificate, content []byte) []byte {
	t.Helper()
	key := make([]byte, 24)
	iv := make([]byte, des.BlockSize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		t.Fatal(err)
	}
	block, err := des.NewTripleDESCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	pad := des.BlockSize - len(content)%des.BlockSize
	padded := append(append([]byte(nil), content...), bytes.Repeat([]byte{byte(pad)}, pad)...)
	encrypted := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(encrypted, padded)
	ivDER := mustMarshal(t, iv)
	return envelope(t, recipient, key, pkix.AlgorithmIdentifier{Algorithm: oidDESEDE3CBC, Parameters: asn1.RawValue{FullBytes: ivDER}}, encrypted)
}

// signedRequest signs an envelope as a SCEP PKCSReq, as scep.NewCSRRequest does,
// so a test can give the envelope bytes it wants.
func signedRequest(t testing.TB, envelope []byte, key *rsa.PrivateKey, signer *x509.Certificate) []byte {
	t.Helper()
	sd, err := pkcs7.NewSignedData(envelope)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		t.Fatal(err)
	}
	attrs := []pkcs7.Attribute{{Type: oidTransaction, Value: "cipher-compatibility-test"}, {Type: oidMessageType, Value: scep.PKCSReq}, {Type: oidSenderNonce, Value: nonce}}
	if err := sd.AddSigner(signer, key, pkcs7.SignerInfoConfig{ExtraSignedAttributes: attrs}); err != nil {
		t.Fatal(err)
	}
	raw, err := sd.Finish()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func enrollmentCSR(t testing.TB, key *rsa.PrivateKey) *x509.CertificateRequest {
	t.Helper()
	eku := mustMarshal(t, []asn1.ObjectIdentifier{{1, 3, 6, 1, 5, 5, 7, 3, 2}})
	return newCSR(t, key, testChallenge, []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 37}, Value: eku}})
}

func enrollReply(t testing.TB, g *gateway, raw []byte) *scep.PKIMessage {
	t.Helper()
	w := invoke(g, "POST", "/scep?operation=PKIOperation", raw)
	if w.Code != 200 {
		t.Fatalf("HTTP %d: %s", w.Code, w.Body)
	}
	reply, err := scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	return reply
}

func TestEnvelopeSessionKeyLengthForSupportedCiphers(t *testing.T) {
	g, _, _, _ := fixture(t)
	for _, c := range aesCiphers {
		t.Run(c.name, func(t *testing.T) {
			withContentCipher(t, c.algorithm)
			der, err := pkcs7.Encrypt([]byte("content"), []*x509.Certificate{g.ra})
			if err != nil {
				t.Fatal(err)
			}
			for form, data := range map[string][]byte{"DER": der, "BER": toIndefiniteBER(t, der)} {
				n, err := envelopeSessionKeyLength(data)
				if err != nil || n != c.length {
					t.Fatalf("%s: length %d, error %v; want %d", form, n, err, c.length)
				}
			}
		})
	}
	der := tripleDESEnvelope(t, g.ra, []byte("content"))
	for form, data := range map[string][]byte{"DER": der, "BER": toIndefiniteBER(t, der)} {
		if n, err := envelopeSessionKeyLength(data); err != nil || n != 24 {
			t.Fatalf("3DES %s: length %d, error %v", form, n, err)
		}
	}
}

func TestEnvelopeSessionKeyLengthRefusesOtherCiphers(t *testing.T) {
	g, _, _, _ := fixture(t)
	withContentCipher(t, pkcs7.EncryptionAlgorithmDESCBC)
	desCBC, err := pkcs7.Encrypt([]byte("content"), []*x509.Certificate{g.ra})
	if err != nil {
		t.Fatal(err)
	}
	aes192 := envelope(t, g.ra, make([]byte, 24), pkix.AlgorithmIdentifier{Algorithm: asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 1, 22}, Parameters: asn1.RawValue{FullBytes: mustMarshal(t, make([]byte, 16))}}, make([]byte, 16))
	for name, data := range map[string][]byte{"DES-CBC": desCBC, "AES-192-CBC": aes192, "DES-CBC BER": toIndefiniteBER(t, desCBC)} {
		if _, err := envelopeSessionKeyLength(data); !errors.Is(err, errUnsupportedContentCipher) {
			t.Fatalf("%s: got %v", name, err)
		}
	}
}

func TestEnvelopeContentCipherValidatesStructure(t *testing.T) {
	g, _, _, _ := fixture(t)
	valid, err := pkcs7.Encrypt([]byte("content"), []*x509.Certificate{g.ra})
	if err != nil {
		t.Fatal(err)
	}
	signedData := mustMarshal(t, struct {
		ContentType asn1.ObjectIdentifier
		Content     asn1.RawValue
	}{pkcs7.OIDSignedData, asn1.RawValue{Class: 2, Tag: 0, IsCompound: true, Bytes: []byte{0x30, 0}}})
	deep := append([]byte{0x30, 0x80}, bytes.Repeat([]byte{0x30, 0x80}, berMaxDepth+4)...)
	deep = append(deep, bytes.Repeat([]byte{0, 0}, berMaxDepth+5)...)
	deepEnvelope := mustMarshal(t, struct {
		ContentType asn1.ObjectIdentifier
		Content     asn1.RawValue
	}{oidEnvelopedData, asn1.RawValue{Class: 2, Tag: 0, IsCompound: true, Bytes: append([]byte{0x30, 0x80, 0x02, 0x01, 0x00, 0x31, 0x80}, deep...)}})
	for name, data := range map[string][]byte{
		"empty":                nil,
		"truncated":            valid[:len(valid)/2],
		"one byte":             {0x30},
		"open indefinite":      {0x30, 0x80},
		"primitive indefinite": {0x30, 0x80, 0x06, 0x80, 0, 0},
		"long length form":     {0x30, 0x85, 1, 0, 0, 0, 0},
		"high tag number":      {0x3f, 0x01, 0x00},
		"not enveloped":        signedData,
		"nested too deep":      deepEnvelope,
	} {
		if _, err := envelopeContentCipher(data); !errors.Is(err, errInvalidEnvelope) {
			t.Fatalf("%s: got %v", name, err)
		}
	}
}

func TestEnrollmentAcceptsSupportedContentCiphers(t *testing.T) {
	for _, c := range aesCiphers {
		t.Run(c.name, func(t *testing.T) {
			g, _, key, signer := fixture(t)
			withContentCipher(t, c.algorithm)
			msg := request(t, g, key, signer, testChallenge, nil)
			if reply := enrollReply(t, g, msg.Raw); reply.PKIStatus != scep.SUCCESS {
				t.Fatalf("status %s, failInfo %s", reply.PKIStatus, reply.FailInfo)
			}
		})
	}
	t.Run("3DES", func(t *testing.T) {
		g, _, key, signer := fixture(t)
		raw := signedRequest(t, tripleDESEnvelope(t, g.ra, enrollmentCSR(t, key).Raw), key, signer)
		if reply := enrollReply(t, g, raw); reply.PKIStatus != scep.SUCCESS {
			t.Fatalf("status %s, failInfo %s", reply.PKIStatus, reply.FailInfo)
		}
	})
	t.Run("indefinite-length BER envelope", func(t *testing.T) {
		g, _, key, signer := fixture(t)
		withContentCipher(t, pkcs7.EncryptionAlgorithmAES128CBC)
		der, err := pkcs7.Encrypt(enrollmentCSR(t, key).Raw, []*x509.Certificate{g.ra})
		if err != nil {
			t.Fatal(err)
		}
		raw := signedRequest(t, toIndefiniteBER(t, der), key, signer)
		if reply := enrollReply(t, g, raw); reply.PKIStatus != scep.SUCCESS {
			t.Fatalf("status %s, failInfo %s", reply.PKIStatus, reply.FailInfo)
		}
	})
}

type countingDecrypter struct {
	crypto.Decrypter
	calls int
}

func (d *countingDecrypter) Decrypt(r io.Reader, data []byte, opts crypto.DecrypterOpts) ([]byte, error) {
	d.calls++
	return d.Decrypter.Decrypt(r, data, opts)
}

func TestEnrollmentRefusesUnsupportedCipherBeforeRADecryption(t *testing.T) {
	g, issuer, key, signer := fixture(t)
	counter := &countingDecrypter{Decrypter: g.decryptor}
	g.decryptor = counter
	withContentCipher(t, pkcs7.EncryptionAlgorithmDESCBC)
	msg := request(t, g, key, signer, testChallenge, nil)
	reply := enrollReply(t, g, msg.Raw)
	if reply.PKIStatus != scep.FAILURE || reply.FailInfo != scep.BadAlg {
		t.Fatalf("status %s, failInfo %s", reply.PKIStatus, reply.FailInfo)
	}
	if counter.calls != 0 || issuer.calls != 0 {
		t.Fatalf("RA decryptions %d, issuances %d", counter.calls, issuer.calls)
	}
}

func TestLocalDecryptorEnforcesSessionKeyLength(t *testing.T) {
	g, _, _, _ := fixture(t)
	sessionKey := make([]byte, 32)
	wrapped, err := rsa.EncryptPKCS1v15(rand.Reader, g.ra.PublicKey.(*rsa.PublicKey), sessionKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sessionDecrypter(g.decryptor, 16).Decrypt(rand.Reader, wrapped, nil); err == nil {
		t.Fatal("accepted a 32-byte key for a 16-byte cipher")
	}
	if plain, err := sessionDecrypter(g.decryptor, 32).Decrypt(rand.Reader, wrapped, nil); err != nil || len(plain) != 32 {
		t.Fatal("refused the matching key length", err)
	}
}

// raBackend serves ra/sign and ra/decrypt with a local key and records the
// session key length of each decryption request.
type raBackend struct {
	mu      sync.Mutex
	key     *rsa.PrivateKey
	lengths []string
	reply   func([]byte) []byte
}

func (s *raBackend) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var input map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	var data []byte
	var output []byte
	var err error
	switch {
	case strings.HasSuffix(r.URL.Path, "/ra/sign"):
		_ = json.Unmarshal(input["digest"], &data)
		output, err = rsa.SignPKCS1v15(rand.Reader, s.key, crypto.SHA256, data)
	case strings.HasSuffix(r.URL.Path, "/ra/decrypt"):
		_ = json.Unmarshal(input["data"], &data)
		s.mu.Lock()
		s.lengths = append(s.lengths, string(input["sessionKeyLength"]))
		s.mu.Unlock()
		output, err = rsa.DecryptPKCS1v15(rand.Reader, s.key, data)
		if err == nil && s.reply != nil {
			output = s.reply(output)
		}
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "RA operation failed", 400)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string][]byte{"data": output})
}

func backendGateway(t *testing.T) (*gateway, *fakeIssuer, *rsa.PrivateKey, *x509.Certificate, *raBackend) {
	t.Helper()
	g, issuer, key, signer := fixture(t)
	ra := &raBackend{key: g.key.(*rsa.PrivateKey)}
	server := httptest.NewServer(ra)
	t.Cleanup(server.Close)
	k := &backendKey{backend: &backend{url: server.URL, token: "test-token", client: server.Client()}, public: g.ra.PublicKey.(*rsa.PublicKey)}
	g.key, g.decryptor = k, k
	return g, issuer, key, signer, ra
}

func TestBackendKeyReceivesSessionKeyLengthForCurrentAndPreviousRA(t *testing.T) {
	for _, c := range aesCiphers {
		t.Run(c.name, func(t *testing.T) {
			g, issuer, key, signer, ra := backendGateway(t)
			withContentCipher(t, c.algorithm)
			msg := request(t, g, key, signer, testChallenge, nil)
			if reply := enrollReply(t, g, msg.Raw); reply.PKIStatus != scep.SUCCESS {
				t.Fatalf("current RA: status %s, failInfo %s", reply.PKIStatus, reply.FailInfo)
			}
			// After an RA renewal the same request reaches the previous RA certificate.
			if err := g.renewRA(context.Background(), filepath.Join(t.TempDir(), "ra.json"), func(context.Context) (state, error) { return nextState(t, g, issuer), nil }); err != nil {
				t.Fatal(err)
			}
			if reply := enrollReply(t, g, msg.Raw); reply.PKIStatus != scep.SUCCESS {
				t.Fatalf("previous RA: status %s, failInfo %s", reply.PKIStatus, reply.FailInfo)
			}
			want := strings.Repeat(","+big.NewInt(int64(c.length)).String(), 2)[1:]
			if got := strings.Join(ra.lengths, ","); got != want {
				t.Fatalf("session key lengths %q, want %q", got, want)
			}
		})
	}
}

func TestBackendKeyRefusesWrongSessionKeyLength(t *testing.T) {
	g, issuer, key, signer, ra := backendGateway(t)
	// A backend that ignores the requested length must not get a key through.
	ra.reply = func(plain []byte) []byte { return append(plain, make([]byte, 16)...) }
	withContentCipher(t, pkcs7.EncryptionAlgorithmAES128CBC)
	msg := request(t, g, key, signer, testChallenge, nil)
	if reply := enrollReply(t, g, msg.Raw); reply.PKIStatus != scep.FAILURE || reply.FailInfo != scep.BadRequest {
		t.Fatalf("status %s, failInfo %s", reply.PKIStatus, reply.FailInfo)
	}
	if issuer.calls != 0 {
		t.Fatal("issued after a wrong key length")
	}
	k := g.key.(*backendKey).withSessionKeyLength(8)
	before := len(ra.lengths)
	if _, err := k.Decrypt(rand.Reader, make([]byte, k.public.Size()), nil); err == nil || len(ra.lengths) != before {
		t.Fatal("sent an invalid session key length to the backend")
	}
}

func TestDecodeSafelyMakesLibraryPanicsUniform(t *testing.T) {
	if err := decodeSafely(func() error { panic("library bug") }); err != errDecode {
		t.Fatalf("got %v", err)
	}
	want := errors.New("decode failed")
	if err := decodeSafely(func() error { return want }); err != want {
		t.Fatalf("got %v", err)
	}
}
