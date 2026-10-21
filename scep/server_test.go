package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/pem"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/smallstep/pkcs7"
	"github.com/smallstep/scep"
)

const testChallenge = "this-is-a-test-only-challenge-password"

type fakeIssuer struct {
	ra     *x509.Certificate
	ca     *x509.Certificate
	key    *rsa.PrivateKey
	issued map[string]*x509.Certificate
	calls  int
	fail   bool
}

func (f *fakeIssuer) Bundle(context.Context) ([]*x509.Certificate, error) {
	return []*x509.Certificate{f.ca}, nil
}
func (f *fakeIssuer) Issue(_ context.Context, csr *x509.CertificateRequest) (*x509.Certificate, error) {
	f.calls++
	if f.fail {
		return nil, io.ErrUnexpectedEOF
	}
	if c := f.issued[string(csr.Raw)]; c != nil {
		return c, nil
	}
	c := makeCert(csr.PublicKey, csr.Subject, f.ca, f.key, false)
	f.issued[string(csr.Raw)] = c
	return c, nil
}
func makeCert(pub any, subject pkix.Name, parent *x509.Certificate, key *rsa.PrivateKey, ca bool) *x509.Certificate {
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	tmpl := &x509.Certificate{SerialNumber: serial, Subject: subject, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour), BasicConstraintsValid: true, IsCA: ca, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment}
	if ca {
		tmpl.KeyUsage |= x509.KeyUsageCertSign
	} else {
		tmpl.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}
	}
	if parent == nil {
		parent = tmpl
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, pub, key)
	if err != nil {
		panic(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		panic(err)
	}
	return cert
}
func fixture(t *testing.T) (*gateway, *fakeIssuer, *rsa.PrivateKey, *x509.Certificate) {
	t.Helper()
	pkcs7.ContentEncryptionAlgorithm = pkcs7.EncryptionAlgorithmAES256CBC
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	ca := makeCert(&caKey.PublicKey, pkix.Name{CommonName: "Test CA"}, nil, caKey, true)
	raKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	ra := makeCert(&raKey.PublicKey, pkix.Name{CommonName: "Test RA"}, ca, caKey, false)
	issuer := &fakeIssuer{ca: ca, ra: ra, key: caKey, issued: make(map[string]*x509.Certificate)}
	leafKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer := makeCert(&leafKey.PublicKey, pkix.Name{CommonName: "device-1"}, nil, leafKey, false)
	return newGateway(issuer, ra, raKey, raKey, []*x509.Certificate{ca}, testChallenge), issuer, leafKey, signer
}
func request(t *testing.T, g *gateway, key *rsa.PrivateKey, signer *x509.Certificate, challenge string, extra []pkix.Extension) *scep.PKIMessage {
	t.Helper()
	eku, _ := asn1.Marshal([]asn1.ObjectIdentifier{{1, 3, 6, 1, 5, 5, 7, 3, 2}})
	csr := newCSR(t, key, challenge, append([]pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 37}, Value: eku}}, extra...))
	msg, err := scep.NewCSRRequest(csr, &scep.PKIMessage{MessageType: scep.PKCSReq, Recipients: []*x509.Certificate{g.ra}, SignerKey: key, SignerCert: signer})
	if err != nil {
		t.Fatal(err)
	}
	return msg
}

// Build PKCS#10 attributes with challengePassword as a SET of DirectoryString.
// This is deliberately independent of the server's CSR parser.
func newCSR(t *testing.T, key *rsa.PrivateKey, challenge string, extensions []pkix.Extension) *x509.CertificateRequest {
	t.Helper()
	tmpl := &x509.CertificateRequest{Subject: pkix.Name{CommonName: "device-1"}, ExtraExtensions: extensions, SignatureAlgorithm: x509.SHA256WithRSA}
	der, err := x509.CreateCertificateRequest(rand.Reader, tmpl, key)
	if err != nil {
		t.Fatal(err)
	}
	var outer struct {
		Info      asn1.RawValue
		Algorithm pkix.AlgorithmIdentifier
		Signature asn1.BitString
	}
	if _, err = asn1.Unmarshal(der, &outer); err != nil {
		t.Fatal(err)
	}
	var info struct {
		Version    int
		Subject    asn1.RawValue
		SPKI       asn1.RawValue
		Attributes []asn1.RawValue `asn1:"tag:0"`
	}
	if _, err = asn1.Unmarshal(outer.Info.FullBytes, &info); err != nil {
		t.Fatal(err)
	}
	cp, _ := asn1.Marshal(struct {
		OID    asn1.ObjectIdentifier
		Values []string `asn1:"set"`
	}{asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 7}, []string{challenge}})
	info.Attributes = append(info.Attributes, asn1.RawValue{FullBytes: cp})
	rawInfo, err := asn1.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	h := cryptoSHA256(rawInfo)
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, h)
	if err != nil {
		t.Fatal(err)
	}
	der, err = asn1.Marshal(struct {
		Info      asn1.RawValue
		Algorithm pkix.AlgorithmIdentifier
		Signature asn1.BitString
	}{asn1.RawValue{FullBytes: rawInfo}, outer.Algorithm, asn1.BitString{Bytes: sig, BitLength: len(sig) * 8}})
	if err != nil {
		t.Fatal(err)
	}
	csr, err := x509.ParseCertificateRequest(der)
	if err != nil {
		t.Fatal(err)
	}
	return csr
}
func cryptoSHA256(data []byte) []byte { h := sha256.Sum256(data); return h[:] }
func invoke(g *gateway, method, path string, body []byte) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	if method == http.MethodPost {
		r.Header.Set("Content-Type", "application/x-pki-message")
	}
	w := httptest.NewRecorder()
	g.ServeHTTP(w, r)
	return w
}
func TestEnrollmentRoundTrip(t *testing.T) {
	g, issuer, key, signer := fixture(t)
	msg := request(t, g, key, signer, testChallenge, nil)
	for _, method := range []string{"POST", "GET"} {
		path := "/scep?operation=PKIOperation"
		body := msg.Raw
		if method == "GET" {
			path += "&message=" + url.QueryEscape(base64.StdEncoding.EncodeToString(body))
			body = nil
		}
		w := invoke(g, method, path, body)
		if w.Code != 200 {
			t.Fatalf("HTTP %d: %s", w.Code, w.Body)
		}
		p7, err := pkcs7.Parse(w.Body.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		if !p7.Signers[0].DigestAlgorithm.Algorithm.Equal(pkcs7.OIDDigestAlgorithmSHA256) {
			t.Fatal("response is not SHA256 signed")
		}
		reply, err := scep.ParsePKIMessage(w.Body.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		if reply.PKIStatus != scep.SUCCESS || reply.TransactionID != msg.TransactionID || !bytes.Equal(reply.RecipientNonce, msg.SenderNonce) {
			t.Fatal("invalid CertRep attributes")
		}
		if err = reply.DecryptPKIEnvelope(signer, key); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(reply.Certificate.RawSubjectPublicKeyInfo, signer.RawSubjectPublicKeyInfo) || reply.Certificate.CheckSignatureFrom(issuer.ca) != nil {
			t.Fatal("invalid issued certificate")
		}
	}
	if len(issuer.issued) != 1 {
		t.Fatal("retry created multiple certificates")
	}
}
func TestChallengeAndCSRPolicy(t *testing.T) {
	g, issuer, key, signer := fixture(t)
	caExt, _ := asn1.Marshal(struct{ CA bool }{true})
	nonRep, _ := asn1.Marshal(asn1.BitString{Bytes: []byte{0xc0}, BitLength: 2})
	for _, test := range []struct {
		name, challenge string
		ext             []pkix.Extension
	}{
		{"wrong challenge", "wrong", nil},
		{"unsupported usage", testChallenge, []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 15}, Value: nonRep}}},
		{"request CA", testChallenge, []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 19}, Value: caExt}}},
		{"request SAN", testChallenge, []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 17}, Value: []byte{0x30, 0}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			msg := request(t, g, key, signer, test.challenge, test.ext)
			w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
			if w.Code != 200 {
				t.Fatalf("HTTP %d", w.Code)
			}
			reply, err := scep.ParsePKIMessage(w.Body.Bytes())
			if err != nil {
				t.Fatal(err)
			}
			if reply.PKIStatus != scep.FAILURE {
				t.Fatal("expected signed failure")
			}
		})
	}
	if issuer.calls != 0 {
		t.Fatal("unauthorized CSR reached issuer")
	}
}
func TestSignatureAndKeyBinding(t *testing.T) {
	g, issuer, key, signer := fixture(t)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	// A valid outer signature does not authorize a CSR for a different key.
	msg := request(t, g, other, makeCert(&other.PublicKey, pkix.Name{CommonName: "other"}, nil, other, false), testChallenge, nil)
	msg.Raw[len(msg.Raw)-1] ^= 1
	w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
	if w.Code == 200 {
		t.Fatal("tampered signature accepted")
	}
	csr := newCSR(t, other, testChallenge, nil)
	if validateCSR(csr, signer) == nil {
		t.Fatal("CSR key mismatch accepted")
	}
	_ = key
	if issuer.calls != 0 {
		t.Fatal("invalid signature reached issuer")
	}
}
func TestDiscoveryAndHTTP(t *testing.T) {
	g, _, _, _ := fixture(t)
	w := invoke(g, "GET", "/scep?operation=GetCACaps", nil)
	if w.Code != 200 || strings.Contains(w.Body.String(), "Renewal") || !strings.Contains(w.Body.String(), "SHA-256") {
		t.Fatal("incorrect capabilities")
	}
	w = invoke(g, "GET", "/scep?operation=GetCACert", nil)
	certs, err := scep.CACerts(w.Body.Bytes())
	if err != nil || len(certs) != 2 {
		t.Fatal("missing CA/RA bundle")
	}
	for _, test := range []struct {
		method, path string
		want         int
	}{{"GET", "/scep?operation=GetCRL", 400}, {"PUT", "/scep", 405}, {"GET", "/unknown", 404}, {"POST", "/scep?operation=GetCACert", 400}, {"POST", "/scep?operation=PKIOperation", 400}} {
		if got := invoke(g, test.method, test.path, nil).Code; got != test.want {
			t.Fatalf("%s: HTTP %d", test.path, got)
		}
	}
	w = invoke(g, "POST", "/scep?operation=PKIOperation", bytes.Repeat([]byte{1}, maxMessage+1))
	if w.Code == 200 {
		t.Fatal("oversized message accepted")
	}
}
func TestBackendFailureIsSigned(t *testing.T) {
	g, issuer, key, signer := fixture(t)
	issuer.fail = true
	msg := request(t, g, key, signer, testChallenge, nil)
	w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
	reply, err := scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if reply.PKIStatus != scep.FAILURE {
		t.Fatal("expected failure")
	}
}

func TestOpenSSLCertRep(t *testing.T) {
	if _, err := exec.LookPath("openssl"); err != nil {
		t.Skip("openssl is unavailable")
	}
	g, _, key, signer := fixture(t)
	msg := request(t, g, key, signer, testChallenge, nil)
	w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
	if w.Code != 200 {
		t.Fatal("enrollment failed")
	}
	dir := t.TempDir()
	files := map[string][]byte{
		"response.der":   w.Body.Bytes(),
		"ca.pem":         pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: g.chain[0].Raw}),
		"client.pem":     pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: signer.Raw}),
		"client-key.pem": pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}),
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, args := range [][]string{
		{"cms", "-verify", "-binary", "-inform", "DER", "-in", "response.der", "-CAfile", "ca.pem", "-purpose", "any", "-out", "envelope.der"},
		{"cms", "-decrypt", "-inform", "DER", "-in", "envelope.der", "-recip", "client.pem", "-inkey", "client-key.pem", "-out", "issued.p7b"},
		{"pkcs7", "-inform", "DER", "-in", "issued.p7b", "-print_certs", "-out", "issued.pem"},
	} {
		cmd := exec.Command("openssl", args...)
		cmd.Dir = dir
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("OpenSSL %s: %v: %s", args[0], err, output)
		}
	}
	data, err := os.ReadFile(filepath.Join(dir, "issued.pem"))
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		t.Fatal("OpenSSL did not extract a certificate")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(cert.RawSubjectPublicKeyInfo, signer.RawSubjectPublicKeyInfo) {
		t.Fatal("wrong leaf key")
	}
}
