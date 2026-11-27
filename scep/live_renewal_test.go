package main

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/smallstep/pkcs7"
	"github.com/smallstep/scep"
)

// Opt-in black-box check against a running gateway and backend: a PKCSReq and a
// key-rotating RenewalReq for each content cipher the client library can send
// (AES-128/256, CBC/GCM: 16- and 32-byte session keys). It works with either RA
// key provider; the backend chooses. Only run against an isolated test CA.
func TestLiveEnrollmentAndRenewal(t *testing.T) {
	endpoint := os.Getenv("SCEP_TEST_SERVER_URL")
	if endpoint == "" {
		t.Skip("SCEP_TEST_SERVER_URL is not set")
	}
	raw, err := os.ReadFile(os.Getenv("SCEP_TEST_CHALLENGE_FILE"))
	if err != nil {
		t.Fatal("test challenge file unavailable")
	}
	challenge := strings.TrimSpace(string(raw))
	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Get(endpoint + "?operation=GetCACert")
	if err != nil {
		t.Fatal(err)
	}
	raw, err = io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil || resp.StatusCode != 200 {
		t.Fatal("CA discovery failed")
	}
	certs, err := scep.CACerts(raw)
	if err != nil {
		t.Fatal(err)
	}
	var ra, ca *x509.Certificate
	for _, c := range certs {
		if c.IsCA {
			ca = c
		} else {
			ra = c
		}
	}
	if ra == nil || ca == nil {
		t.Fatal("CA/RA discovery failed")
	}
	post := func(t *testing.T, msg *scep.PKIMessage, signer *x509.Certificate, key *rsa.PrivateKey) *x509.Certificate {
		t.Helper()
		resp, err := client.Post(endpoint+"?operation=PKIOperation", "application/x-pki-message", bytes.NewReader(msg.Raw))
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("PKIOperation HTTP %d", resp.StatusCode)
		}
		reply, err := scep.ParsePKIMessage(body, scep.WithCACerts([]*x509.Certificate{ra}))
		if err != nil {
			t.Fatal(err)
		}
		if reply.PKIStatus != scep.SUCCESS {
			t.Fatalf("request rejected: status %s, failInfo %s", reply.PKIStatus, reply.FailInfo)
		}
		if err = reply.DecryptPKIEnvelope(signer, key); err != nil {
			t.Fatal(err)
		}
		cert := reply.Certificate
		if cert.CheckSignatureFrom(ca) != nil || cert.IsCA {
			t.Fatal("issued certificate is not a leaf of the discovered CA")
		}
		return cert
	}
	eku, _ := asn1.Marshal([]asn1.ObjectIdentifier{{1, 3, 6, 1, 5, 5, 7, 3, 2}})
	ekuExt := []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 37}, Value: eku}}
	ciphers := map[string]int{"AES-128-CBC": pkcs7.EncryptionAlgorithmAES128CBC, "AES-256-CBC": pkcs7.EncryptionAlgorithmAES256CBC,
		"AES-128-GCM": pkcs7.EncryptionAlgorithmAES128GCM, "AES-256-GCM": pkcs7.EncryptionAlgorithmAES256GCM}
	defer func() { pkcs7.ContentEncryptionAlgorithm = pkcs7.EncryptionAlgorithmDESCBC }()
	for name, cipher := range ciphers {
		t.Run(name, func(t *testing.T) {
			pkcs7.ContentEncryptionAlgorithm = cipher
			key, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				t.Fatal(err)
			}
			self := makeCert(&key.PublicKey, pkix.Name{CommonName: "live-device"}, nil, key, false)
			first := post(t, request(t, &gateway{ra: ra}, key, self, challenge, nil), self, key)
			if !bytes.Equal(first.RawSubjectPublicKeyInfo, self.RawSubjectPublicKeyInfo) {
				t.Fatal("enrollment did not certify the request key")
			}
			newKey, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				t.Fatal(err)
			}
			csr := newCSR(t, newKey, challenge, ekuExt)
			msg, err := scep.NewCSRRequest(csr, &scep.PKIMessage{MessageType: scep.RenewalReq, Recipients: []*x509.Certificate{ra}, SignerCert: first, SignerKey: key})
			if err != nil {
				t.Fatal(err)
			}
			renewed := post(t, msg, first, key)
			if !bytes.Equal(renewed.RawSubjectPublicKeyInfo, csr.RawSubjectPublicKeyInfo) || renewed.SerialNumber.Cmp(first.SerialNumber) == 0 {
				t.Fatal("renewal did not certify the new key")
			}
			t.Logf("%s: enrollment serial %s, renewal serial %s", name, first.SerialNumber.Text(16), renewed.SerialNumber.Text(16))
		})
	}
}
