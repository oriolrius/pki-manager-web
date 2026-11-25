package signer

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"
)

// testCertPEM returns a self-signed certificate made for this run.
func testCertPEM(tb testing.TB) string {
	tb.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		tb.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "fuzz"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		tb.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

// respond is an http.RoundTripper that answers every request with a fixed
// status and body, so the fuzz target needs no network.
type respond struct {
	status int
	body   []byte
}

func (r respond) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: r.status, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(r.body))}, nil
}

// FuzzClientResponse feeds an arbitrary HTTP status and body as the answer of
// the PKI Manager API. The client must not panic, a status >= 400 must always be
// an error, and a call must give a response or an error, never both.
func FuzzClientResponse(f *testing.F) {
	good, err := json.Marshal(SignResponse{ID: "c1", SerialNumber: "01", CertificatePEM: testCertPEM(f)})
	if err != nil {
		f.Fatal(err)
	}
	f.Add(200, good)
	f.Add(200, []byte(`{"id":"c1","serialNumber":"01","certificatePem":"-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n"}`))
	f.Add(200, []byte(`{"id":"c1","serialNumber":"01","certificatePem":""}`))
	f.Add(200, []byte(`{}`))
	f.Add(200, []byte(`{"status":"ok","cluster":{"id":"k1","name":"prod","caId":"ca1"}}`))
	f.Add(200, []byte(`{"status":"revoked","serialNumber":"01"}`))
	f.Add(400, []byte(`{"error":{"code":"INVALID_CSR","message":"bad"}}`))
	f.Add(401, []byte(`{"error":"a string, not an object"}`))
	f.Add(500, []byte(`<html>upstream error</html>`))
	f.Add(200, []byte(`{"serialNumber":1}`))
	f.Add(200, []byte(`[]`))
	f.Add(200, []byte(`null`))
	f.Add(200, []byte{})
	f.Add(204, []byte{})
	f.Add(-1, []byte(`{`))

	f.Fuzz(func(t *testing.T, status int, body []byte) {
		c := New("https://pki.example.test", "token")
		c.hc.Transport = respond{status, body}
		ctx := context.Background()

		sign, serr := c.Sign(ctx, &SignRequest{CSRPem: "csr", RequestUID: "uid"})
		health, herr := c.Health(ctx)
		bundle, berr := c.CABundle(ctx)
		revoke, rerr := c.Revoke(ctx, &RevokeRequest{SerialNumber: "01"})

		for name, pair := range map[string][2]bool{
			"Sign":     {sign == nil, serr == nil},
			"Health":   {health == nil, herr == nil},
			"CABundle": {bundle == nil, berr == nil},
			"Revoke":   {revoke == nil, rerr == nil},
		} {
			if pair[0] == pair[1] {
				t.Fatalf("%s: response and error are both set or both absent (status %d, body %q)", name, status, body)
			}
			if status >= 400 && pair[1] {
				t.Fatalf("%s: HTTP %d did not give an error", name, status)
			}
		}
		// An accepted sign response always carries a parseable certificate: the
		// controller writes it to the CertificateRequest and marks it Ready.
		if serr == nil {
			block, _ := pem.Decode([]byte(sign.CertificatePEM))
			if block == nil || block.Type != "CERTIFICATE" {
				t.Fatalf("Sign accepted a response with no certificate: %q", body)
			}
			if _, err := x509.ParseCertificate(block.Bytes); err != nil {
				t.Fatalf("Sign accepted a response with a bad certificate: %v", err)
			}
		} else if !strings.Contains(serr.Error(), "pki-manager") && status >= 400 {
			t.Fatalf("Sign error does not name the API: %v", serr)
		}
	})
}

// FuzzWithCABundle feeds an arbitrary caBundle (it comes from the Issuer
// resource). A bad bundle must not panic, and the client must stay usable.
func FuzzWithCABundle(f *testing.F) {
	f.Add([]byte("-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n"))
	f.Add([]byte("-----BEGIN CERTIFICATE-----\n"))
	f.Add([]byte("not pem"))
	f.Add([]byte{})

	f.Fuzz(func(t *testing.T, pem []byte) {
		c := New("https://pki.example.test", "token", WithCABundle(pem))
		if c == nil || c.hc == nil {
			t.Fatal("no client")
		}
		if len(pem) == 0 {
			return
		}
		tr, ok := c.hc.Transport.(*http.Transport)
		if !ok || tr.TLSClientConfig == nil || tr.TLSClientConfig.RootCAs == nil {
			t.Fatal("a caBundle did not pin the roots")
		}
	})
}
