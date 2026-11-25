package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/smallstep/pkcs7"
	"github.com/smallstep/scep"
)

// Native Go fuzz targets for the input that the gateway does not control: the
// SCEP PKIOperation message of a device, the SAN extension of its CSR, and the
// PEM that the backend returns. See docs/development/testing.md (Fuzzing).

// fuzzFixtureEnv names a file with the keys and the seed messages of the fuzz
// run. `go test -fuzz` runs the target in several worker processes. A valid SCEP
// message is valid only for the RA key it was encrypted to, so the coordinator
// writes the fixture once and the workers load the same one.
const fuzzFixtureEnv = "SCEP_FUZZ_FIXTURE"

type fuzzFixture struct {
	CAKey, RAKey, LeafKey []byte   // PKCS#1 DER, test-only keys made for this run
	CA, RA, Signer        []byte   // certificate DER
	Valid                 [][]byte // messages that the gateway must issue for
	Rejected              [][]byte // well-formed messages that it must refuse
}

func (x *fuzzFixture) gateway(tb testing.TB) (*gateway, *fakeIssuer) {
	tb.Helper()
	must := func(err error) {
		if err != nil {
			tb.Fatal(err)
		}
	}
	caKey, err := x509.ParsePKCS1PrivateKey(x.CAKey)
	must(err)
	raKey, err := x509.ParsePKCS1PrivateKey(x.RAKey)
	must(err)
	ca, err := x509.ParseCertificate(x.CA)
	must(err)
	ra, err := x509.ParseCertificate(x.RA)
	must(err)
	pkcs7.ContentEncryptionAlgorithm = pkcs7.EncryptionAlgorithmAES256CBC
	issuer := &fakeIssuer{ca: ca, ra: ra, key: caKey, issued: make(map[string]*x509.Certificate)}
	return newGateway(issuer, ra, raKey, raKey, []*x509.Certificate{ca}, testChallenge), issuer
}

// loadFuzzFixture returns the fixture of this fuzz run. The first process makes
// it and removes the file when it ends.
func loadFuzzFixture(f *testing.F) *fuzzFixture {
	f.Helper()
	if path := os.Getenv(fuzzFixtureEnv); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			f.Fatal(err)
		}
		var x fuzzFixture
		if err = json.Unmarshal(data, &x); err != nil {
			f.Fatal(err)
		}
		return &x
	}
	g, issuer, leafKey, signer := fixture(f)
	raKey := g.key.(*rsa.PrivateKey)
	x := &fuzzFixture{
		CAKey: x509.MarshalPKCS1PrivateKey(issuer.key), RAKey: x509.MarshalPKCS1PrivateKey(raKey), LeafKey: x509.MarshalPKCS1PrivateKey(leafKey),
		CA: issuer.ca.Raw, RA: g.ra.Raw, Signer: signer.Raw,
	}
	x.Valid = append(x.Valid, request(f, g, leafKey, signer, testChallenge, nil).Raw)
	caExt, _ := asn1.Marshal(struct{ CA bool }{true})
	x.Rejected = append(x.Rejected,
		request(f, g, leafKey, signer, "wrong-challenge", nil).Raw,
		request(f, g, leafKey, signer, testChallenge, []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 19}, Value: caExt}}).Raw,
		request(f, g, leafKey, signer, testChallenge, []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 17}, Value: sanDER(generalName(2, "device-001.example.com"))}}).Raw,
	)
	// A message for another key pair: the outer signature is good, the CSR key
	// is not the signer key.
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		f.Fatal(err)
	}
	x.Rejected = append(x.Rejected, request(f, g, other, signer, testChallenge, nil).Raw)

	data, err := json.Marshal(x)
	if err != nil {
		f.Fatal(err)
	}
	file, err := os.CreateTemp("", "scep-fuzz-fixture-*.json")
	if err != nil {
		f.Fatal(err)
	}
	if _, err = file.Write(data); err != nil {
		f.Fatal(err)
	}
	if err = file.Close(); err != nil {
		f.Fatal(err)
	}
	f.Setenv(fuzzFixtureEnv, file.Name())
	f.Cleanup(func() { _ = os.Remove(file.Name()) })
	return x
}

// csrOf returns the DER of the CSR in a valid seed message.
func csrOf(tb testing.TB, g *gateway, raw []byte) string {
	tb.Helper()
	msg, err := scep.ParsePKIMessage(raw)
	if err != nil {
		tb.Fatal(err)
	}
	if err = msg.DecryptPKIEnvelope(g.ra, g.decryptor); err != nil {
		tb.Fatal(err)
	}
	return string(msg.CSR.Raw)
}

func addMessageSeeds(f *testing.F, x *fuzzFixture, add func([]byte)) {
	f.Helper()
	for _, raw := range append(append([][]byte{}, x.Valid...), x.Rejected...) {
		add(raw)
		add(raw[:len(raw)/2])
	}
	ca, _ := x509.ParseCertificate(x.CA)
	degenerate, err := scep.DegenerateCertificates([]*x509.Certificate{ca})
	if err != nil {
		f.Fatal(err)
	}
	add(degenerate) // signedData with no signer
	add(x.CA)       // DER that is not PKCS#7
	add([]byte{})
	add([]byte{0x30, 0x80})
	add([]byte{0x30, 0x84, 0xff, 0xff, 0xff, 0xff})
	add([]byte("-----BEGIN PKCS7-----\nMAA=\n-----END PKCS7-----\n"))
}

// FuzzEnroll feeds arbitrary bytes as the PKIOperation message. The gateway must
// not panic, and it must ask the issuer for a certificate only for the CSR of a
// message that has the challenge password and a valid signature.
func FuzzEnroll(f *testing.F) {
	x := loadFuzzFixture(f)
	g, issuer := x.gateway(f)
	allowed := map[string]bool{}
	for _, raw := range x.Valid {
		allowed[csrOf(f, g, raw)] = true
	}
	addMessageSeeds(f, x, func(b []byte) { f.Add(b) })

	f.Fuzz(func(t *testing.T, data []byte) {
		reply, err := g.snapshot(context.Background()).enroll(context.Background(), data)
		if err == nil {
			if _, perr := pkcs7.Parse(reply); perr != nil {
				t.Fatalf("the reply is not PKCS#7: %v", perr)
			}
		} else if reply != nil {
			t.Fatal("enroll returned a reply together with an error")
		}
		for der := range issuer.issued {
			if !allowed[der] {
				t.Fatalf("the gateway issued a certificate for a CSR that is not authorized: %x", der)
			}
		}
	})
}

// FuzzPKIOperationHTTP sends an arbitrary PKIOperation over HTTP, as POST body
// or as the GET `message` parameter. The handler must answer with one of the
// documented status codes.
func FuzzPKIOperationHTTP(f *testing.F) {
	x := loadFuzzFixture(f)
	g, issuer := x.gateway(f)
	allowed := map[string]bool{}
	for _, raw := range x.Valid {
		allowed[csrOf(f, g, raw)] = true
	}
	addMessageSeeds(f, x, func(b []byte) {
		f.Add(false, "application/x-pki-message", b)
		f.Add(true, "", []byte(base64.StdEncoding.EncodeToString(b)))
	})
	f.Add(false, "text/plain", []byte("x"))
	f.Add(false, "application/octet-stream; charset=\"", []byte("x"))
	f.Add(true, "", []byte("not base64 !!"))
	f.Add(true, "", []byte("AAAA AAAA+/=="))

	f.Fuzz(func(t *testing.T, get bool, contentType string, body []byte) {
		var r *http.Request
		if get {
			r = httptest.NewRequest(http.MethodGet, "/scep?operation=PKIOperation&message="+url.QueryEscape(string(body)), nil)
		} else {
			r = httptest.NewRequest(http.MethodPost, "/scep?operation=PKIOperation", bytes.NewReader(body))
			r.Header["Content-Type"] = []string{contentType}
		}
		w := httptest.NewRecorder()
		g.ServeHTTP(w, r)
		switch w.Code {
		case 200:
			if _, err := pkcs7.Parse(w.Body.Bytes()); err != nil {
				t.Fatalf("HTTP 200 without a PKCS#7 reply: %v", err)
			}
		case 400, 413, 415:
		default:
			t.Fatalf("unexpected HTTP status %d: %s", w.Code, w.Body)
		}
		for der := range issuer.issued {
			if !allowed[der] {
				t.Fatalf("the gateway issued a certificate for a CSR that is not authorized: %x", der)
			}
		}
	})
}

// FuzzValidateSAN feeds an arbitrary subjectAltName extension value (it comes
// from the CSR of a device). An accepted value must hold 1..32 names, each of a
// supported type and without the characters that the validator forbids.
func FuzzValidateSAN(f *testing.F) {
	upn, _ := asn1.MarshalWithParams("device@tenant.example", "utf8")
	other, _ := asn1.MarshalWithParams(struct {
		OID   asn1.ObjectIdentifier
		Value asn1.RawValue
	}{asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 311, 20, 2, 3}, asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 0, IsCompound: true, Bytes: upn}}, "tag:0")
	f.Add(sanDER(generalName(2, "device-001.example.com")))
	f.Add(sanDER(generalName(6, "urn:uuid:12345678-1234-1234-1234-123456789abc")))
	f.Add(sanDER(generalName(1, "device@tenant.example")))
	f.Add(sanDER(asn1.RawValue{FullBytes: other}))
	f.Add(sanDER(asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 7, Bytes: []byte{192, 0, 2, 1}}))
	f.Add(sanDER(generalName(2, "*.example.com")))
	f.Add(sanDER(generalName(2, "a..b")))
	f.Add(sanDER(generalName(6, "http://example.com")))
	f.Add(sanDER(generalName(4, "directoryName")))
	f.Add([]byte{0x30, 0x00})
	f.Add([]byte{0x30, 0x80, 0x82, 0x01, 0x61, 0x00, 0x00})
	f.Add([]byte{})

	f.Fuzz(func(t *testing.T, der []byte) {
		if validateSAN(der) != nil {
			return
		}
		var names []asn1.RawValue
		rest, err := asn1.Unmarshal(der, &names)
		if err != nil || len(rest) != 0 {
			t.Fatalf("accepted a SAN that is not one DER sequence: %x", der)
		}
		if len(names) == 0 || len(names) > 32 {
			t.Fatalf("accepted %d names", len(names))
		}
		for _, name := range names {
			if name.Class != asn1.ClassContextSpecific {
				t.Fatalf("accepted class %d", name.Class)
			}
			value := string(name.Bytes)
			switch name.Tag {
			case 0:
			case 1:
				if strings.ContainsAny(value, "\x00\r\n<> ") || !strings.Contains(value, "@") {
					t.Fatalf("accepted email SAN %q", value)
				}
			case 2:
				if value == "" || len(value) > 253 || strings.ContainsAny(value, "*_ /\\\x00\r\n") || strings.HasPrefix(value, ".") || strings.HasSuffix(value, ".") {
					t.Fatalf("accepted DNS SAN %q", value)
				}
			case 6:
				if strings.ContainsAny(value, "\x00\r\n ") || !(strings.HasPrefix(strings.ToLower(value), "https:") || strings.HasPrefix(strings.ToLower(value), "urn:") || strings.HasPrefix(strings.ToLower(value), "tag:")) {
					t.Fatalf("accepted URI SAN %q", value)
				}
			case 7:
				if len(name.Bytes) != net.IPv4len && len(name.Bytes) != net.IPv6len {
					t.Fatalf("accepted IP SAN of %d bytes", len(name.Bytes))
				}
			default:
				t.Fatalf("accepted SAN type %d", name.Tag)
			}
		}
	})
}

// FuzzParsePEMCerts feeds an arbitrary string as the PEM that the backend
// returns (CA bundle, issued certificate, RA state).
func FuzzParsePEMCerts(f *testing.F) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		f.Fatal(err)
	}
	cert := makeCert(&key.PublicKey, pkix.Name{CommonName: "Fuzz CA"}, nil, key, true)
	good := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw}))
	f.Add(good)
	f.Add(good + good)
	f.Add(good + "trailing text")
	f.Add("-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n")
	// Built from parts so that the secret scan does not read it as a committed key.
	f.Add(string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE" + " KEY", Bytes: []byte{0x30, 0x00}})))
	f.Add(good[:len(good)/2])
	f.Add("")

	f.Fuzz(func(t *testing.T, data string) {
		certs, err := parsePEMCerts(data)
		if err != nil {
			if certs != nil {
				t.Fatal("parsePEMCerts returned certificates together with an error")
			}
			return
		}
		if len(certs) == 0 {
			t.Fatal("parsePEMCerts accepted input with no certificate")
		}
		// Round trip: the PEM of the parsed certificates gives the same DER.
		var again strings.Builder
		for _, c := range certs {
			if c == nil || len(c.Raw) == 0 {
				t.Fatal("parsePEMCerts returned an empty certificate")
			}
			again.Write(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Raw}))
		}
		second, err := parsePEMCerts(again.String())
		if err != nil || len(second) != len(certs) {
			t.Fatalf("round trip failed: %v", err)
		}
		for i := range certs {
			if !bytes.Equal(certs[i].Raw, second[i].Raw) {
				t.Fatal("round trip changed a certificate")
			}
		}
	})
}

// FuzzValidateBackendURL checks that an accepted SCEP_BACKEND_URL can never send
// the service token over plain HTTP to a host that is not loopback.
func FuzzValidateBackendURL(f *testing.F) {
	for _, seed := range []string{"https://pki.example.com", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000",
		"http://pki.example.com", "https://user:pw@pki.example.com", "https://pki.example.com/?a=b", "ftp://localhost", "http://localhost.evil.example",
		"http://127.0.0.1.evil.example", "https://", "http://LOCALHOST", "://", "http://0x7f.1", ""} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		if validateBackendURL(raw) != nil {
			return
		}
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("accepted a URL that does not parse: %q", raw)
		}
		if u.User != nil || u.Hostname() == "" {
			t.Fatalf("accepted %q", raw)
		}
		if u.Scheme == "https" {
			return
		}
		host := strings.ToLower(u.Hostname())
		ip := net.ParseIP(host)
		if u.Scheme != "http" || !(host == "localhost" || (ip != nil && ip.IsLoopback())) {
			t.Fatalf("accepted plain HTTP to a host that is not loopback: %q", raw)
		}
	})
}

// FuzzSharedSubjectConfig checks that an accepted SCEP_SHARED_SUBJECT holds only
// the subject fields that validSharedSubject enforces.
func FuzzSharedSubjectConfig(f *testing.F) {
	for _, seed := range []string{"", `{"O":"Example","C":"ES"}`, `{"OU":"Devices","ST":"Catalonia","L":"Barcelona"}`, `{"CN":"x"}`, `{"O":""}`,
		`{"O":1}`, `[]`, `{"o":"x"}`, `{"":"x"}`, `{`, `{"O|OU":"Example"}`} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		fields, err := sharedSubjectConfig(raw)
		if err != nil {
			return
		}
		for key, value := range fields {
			switch key {
			case "O", "OU", "C", "ST", "L":
			default:
				t.Fatalf("accepted subject field %q, which is never enforced", key)
			}
			if value == "" {
				t.Fatalf("accepted an empty value for %q", key)
			}
		}
	})
}
