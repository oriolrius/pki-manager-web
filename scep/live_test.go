package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/json"
	"github.com/smallstep/pkcs7"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/smallstep/scep"
)

// Opt-in black-box check against a running gateway, PKI backend and Cosmian KMS.
// Only run against an isolated test CA: this creates a real certificate.
func TestLiveEnrollment(t *testing.T) {
	endpoint := os.Getenv("SCEP_TEST_SERVER_URL")
	if endpoint == "" {
		t.Skip("SCEP_TEST_SERVER_URL is not set")
	}
	challengeFile := os.Getenv("SCEP_TEST_CHALLENGE_FILE")
	challenge, err := os.ReadFile(challengeFile)
	if err != nil {
		t.Fatal("test challenge file unavailable")
	}
	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Get(endpoint + "?operation=GetCACert")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(resp.Body)
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
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer := makeCert(&key.PublicKey, pkix.Name{CommonName: "live-device"}, nil, key, false)
	msg := request(t, &gateway{ra: ra}, key, signer, strings.TrimSpace(string(challenge)), nil)
	var serial string
	for n := 0; n < 2; n++ {
		resp, err = client.Post(endpoint+"?operation=PKIOperation", "application/x-pki-message", bytes.NewReader(msg.Raw))
		if err != nil {
			t.Fatal(err)
		}
		raw, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("enrollment failed HTTP %d", resp.StatusCode)
		}
		reply, err := scep.ParsePKIMessage(raw, scep.WithCACerts([]*x509.Certificate{ra}))
		if err != nil {
			t.Fatal(err)
		}
		if reply.PKIStatus != scep.SUCCESS {
			t.Fatal("enrollment rejected")
		}
		if err = reply.DecryptPKIEnvelope(signer, key); err != nil {
			t.Fatal(err)
		}
		cert := reply.Certificate
		if cert.CheckSignatureFrom(ca) != nil || cert.IsCA || !bytes.Equal(cert.RawSubjectPublicKeyInfo, signer.RawSubjectPublicKeyInfo) {
			t.Fatal("issued certificate does not match request")
		}
		if n == 0 {
			serial = cert.SerialNumber.Text(16)
		} else if serial != cert.SerialNumber.Text(16) {
			t.Fatal("retry issued a second certificate")
		}
	}
	t.Log("live SCEP discovery, KMS RA signature/decryption, backend issuance and idempotent retry verified")
}

// Exercises managed SANs, key-rotating renewal and revocation against the real
// backend and KMS. MDM approval here is a test double, not a live Intune tenant.
func TestLiveManagedProfileWithKMS(t *testing.T) {
	endpoint := os.Getenv("SCEP_TEST_BACKEND_URL")
	if endpoint == "" {
		t.Skip("SCEP_TEST_BACKEND_URL is not set")
	}
	token, err := os.ReadFile(os.Getenv("SCEP_TEST_BACKEND_TOKEN_FILE"))
	if err != nil {
		t.Fatal("backend test token unavailable")
	}
	savedBytes, err := os.ReadFile(os.Getenv("SCEP_TEST_RA_STATE_FILE"))
	if err != nil {
		t.Fatal("test RA state unavailable")
	}
	var saved state
	if err = json.Unmarshal(savedBytes, &saved); err != nil {
		t.Fatal(err)
	}
	certs, err := parsePEMCerts(saved.CertificatePEM)
	if err != nil {
		t.Fatal(err)
	}
	ra := certs[0]
	client := &http.Client{Timeout: 60 * time.Second}
	b := &backend{url: endpoint, token: strings.TrimSpace(string(token)), days: 90, client: client}
	chain, err := b.Bundle(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	key := &kmsKey{url: os.Getenv("SCEP_TEST_KMS_URL"), id: saved.KeyID, public: ra.PublicKey.(*rsa.PublicKey), client: client}
	g := newGateway(b, ra, key, key, chain, "unused")
	g.authorizer = &fakeManaged{}
	pkcs7.ContentEncryptionAlgorithm = pkcs7.EncryptionAlgorithmAES256CBC
	clientKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer := makeCert(&clientKey.PublicKey, pkix.Name{CommonName: "test-managed-device"}, nil, clientKey, false)
	ku, _ := asn1.Marshal(asn1.BitString{Bytes: []byte{0xa0}, BitLength: 3})
	bc, _ := asn1.Marshal(struct {
		CA bool `asn1:"optional"`
	}{false})
	upn, _ := asn1.MarshalWithParams("managed-device@tenant.example", "utf8")
	other, _ := asn1.MarshalWithParams(struct {
		OID   asn1.ObjectIdentifier
		Value asn1.RawValue
	}{asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 311, 20, 2, 3}, asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 0, IsCompound: true, Bytes: upn}}, "tag:0")
	san := sanDER(generalName(2, "managed-device.example.com"), generalName(6, "tag:microsoft.com,2022-09-14:sid:S-1-5-21-100-200-300-400"), asn1.RawValue{FullBytes: other})
	msg := request(t, g, clientKey, signer, "test-only-dynamic-mdm-challenge", []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 17}, Value: san}, {Id: asn1.ObjectIdentifier{2, 5, 29, 15}, Value: ku}, {Id: asn1.ObjectIdentifier{2, 5, 29, 19}, Value: bc}})
	w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
	reply, err := scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil {
		t.Fatalf("managed reply HTTP %d: %v", w.Code, err)
	}
	if reply.PKIStatus != scep.SUCCESS {
		t.Fatal("managed enrollment failed")
	}
	if err = reply.DecryptPKIEnvelope(signer, clientKey); err != nil {
		t.Fatal(err)
	}
	oldCert := reply.Certificate
	if len(oldCert.DNSNames) != 1 || len(oldCert.URIs) != 1 || oldCert.CheckSignatureFrom(chain[0]) != nil {
		t.Fatal("SAN profile not preserved")
	}
	newKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	eku, _ := asn1.Marshal([]asn1.ObjectIdentifier{{1, 3, 6, 1, 5, 5, 7, 3, 2}})
	csr := newCSR(t, newKey, "new-test-mdm-challenge", []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 37}, Value: eku}, {Id: asn1.ObjectIdentifier{2, 5, 29, 17}, Value: san}})
	renewal, err := scep.NewCSRRequest(csr, &scep.PKIMessage{MessageType: scep.RenewalReq, Recipients: []*x509.Certificate{ra}, SignerCert: oldCert, SignerKey: clientKey})
	if err != nil {
		t.Fatal(err)
	}
	w = invoke(g, "POST", "/scep?operation=PKIOperation", renewal.Raw)
	reply, err = scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if reply.PKIStatus != scep.SUCCESS {
		t.Fatal("live renewal failed")
	}
	if err = reply.DecryptPKIEnvelope(oldCert, clientKey); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(reply.Certificate.RawSubjectPublicKeyInfo, csr.RawSubjectPublicKeyInfo) {
		t.Fatal("renewal did not use new key")
	}
	if err = b.Revoke(context.Background(), oldCert.SerialNumber.Text(16)); err != nil {
		t.Fatal(err)
	}
	if b.Active(context.Background(), oldCert) == nil {
		t.Fatal("revoked old certificate still active")
	}
	w = invoke(g, "POST", "/scep?operation=PKIOperation", renewal.Raw)
	reply, err = scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if reply.PKIStatus != scep.FAILURE {
		t.Fatal("revoked signer renewed")
	}
	t.Log("real KMS/backend SAN issuance, new-key renewal, CRL-backed revocation and renewal rejection verified; MDM authority mocked")
}
