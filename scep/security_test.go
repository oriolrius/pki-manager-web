package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSharedSubjectAndRenewalIdentity(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	csr := func(subject pkix.Name) *x509.CertificateRequest {
		der, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: subject}, key)
		if err != nil {
			t.Fatal(err)
		}
		result, err := x509.ParseCertificateRequest(der)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	if !validSharedSubject(csr(pkix.Name{CommonName: "device"}), nil) {
		t.Fatal("CN rejected")
	}
	organizational := csr(pkix.Name{CommonName: "device", Organization: []string{"Example"}})
	if validSharedSubject(organizational, nil) || !validSharedSubject(organizational, map[string]string{"O": "Example"}) || validSharedSubject(organizational, map[string]string{"O": "Other"}) {
		t.Fatal("DN policy bypass")
	}
	if validSharedSubject(csr(pkix.Name{CommonName: "device", ExtraNames: []pkix.AttributeTypeAndValue{{Type: asn1.ObjectIdentifier{2, 5, 4, 5}, Value: "untrusted"}}}), nil) {
		t.Fatal("extra DN accepted")
	}
	previous := makeCert(&key.PublicKey, pkix.Name{CommonName: "device"}, nil, key, false)
	if !sameRenewalIdentity(csr(previous.Subject), previous) || sameRenewalIdentity(organizational, previous) {
		t.Fatal("subject identity changed")
	}
	previous.DNSNames = []string{"cached"}
	previous.Extensions = append(previous.Extensions, pkix.Extension{Id: asn1.ObjectIdentifier{2, 5, 29, 17}, Value: []byte{1}})
	if sameRenewalIdentity(csr(previous.Subject), previous) {
		t.Fatal("SAN removal accepted")
	}
}
func TestSlowBodyDoesNotOccupyIssuanceSlot(t *testing.T) {
	g, _, _, _ := fixture(t)
	reader, writer := io.Pipe()
	defer reader.Close()
	r := httptest.NewRequest(http.MethodPost, "/scep?operation=PKIOperation", reader)
	r.Header.Set("Content-Type", "application/x-pki-message")
	done := make(chan struct{})
	go func() { g.ServeHTTP(httptest.NewRecorder(), r); close(done) }()
	if len(g.slots) != 0 {
		t.Error("slow body acquired slot")
	}
	if invoke(g, "GET", "/scep?operation=GetCACaps", nil).Code != 200 {
		t.Error("slow body blocked discovery")
	}
	writer.Close()
	<-done
}
func TestDistinctCSRDoesNotWaitForRemoteOperation(t *testing.T) {
	g, _, _, _ := fixture(t)
	release, err := g.acquireCSR(context.Background(), []byte("first"))
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	other, err := g.acquireCSR(ctx, []byte("other"))
	if err != nil {
		t.Fatal("unrelated CSR blocked", err)
	}
	other()
	cancelled, cancelNow := context.WithCancel(context.Background())
	cancelNow()
	if _, err := g.acquireCSR(cancelled, []byte("first")); err == nil {
		t.Fatal("cancelled duplicate admitted")
	}
}
func TestTransientRevocationKeepsJournalAndRAIsProtected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pending.json")
	journal := revocationJournal{Tenant: "tenant", ClientID: "client", Issuer: "CN=CA", Requests: []revocationRequest{{Context: "a", Serial: "01", Issuer: "CN=CA"}}}
	if err := saveJournal(path, journal); err != nil {
		t.Fatal(err)
	}
	a, _ := newIntuneAuthorizer("tenant", "client", "secret", &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("transient failure must not upload acknowledgment")
		return nil, io.ErrUnexpectedEOF
	})})
	if err := a.pollRevocations(context.Background(), &fakeRevoker{status: 500}, "CN=CA", path); err == nil {
		t.Fatal("transient failure ignored")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("journal lost", err)
	}
	g, _, _, _ := fixture(t)
	b := &backend{protectedRA: g.isRASerial}
	if err := b.Revoke(context.Background(), g.ra.SerialNumber.Text(16)); err == nil {
		t.Fatal("RA revocation admitted")
	}
}
