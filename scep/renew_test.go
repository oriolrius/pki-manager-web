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
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/smallstep/scep"
)

func dueRA(t *testing.T, g *gateway, f *fakeIssuer) {
	t.Helper()
	template := *g.ra
	template.NotBefore = time.Now().Add(-22 * time.Hour)
	template.NotAfter = time.Now().Add(2 * time.Hour)
	der, err := x509.CreateCertificate(rand.Reader, &template, f.ca, g.key.Public(), f.key)
	if err != nil {
		t.Fatal(err)
	}
	g.ra, err = x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	f.ra = g.ra
}

func TestRARenewalPersistsSameKeyAndSupportsCachedRecipient(t *testing.T) {
	g, f, key, signer := fixture(t)
	dueRA(t, g, f)
	old := g.ra
	message := request(t, g, key, signer, testChallenge, nil)
	path := filepath.Join(t.TempDir(), "ra.json")
	var uid string
	issue := func(ctx context.Context, csr *x509.CertificateRequest, id string) (*x509.Certificate, error) {
		uid = id
		return f.Issue(ctx, csr)
	}
	if err := g.renewRA(context.Background(), path, "same-kms-key", issue, time.Now()); err != nil {
		t.Fatal(err)
	}
	if !g.ra.NotAfter.After(old.NotAfter) || !bytes.Equal(g.ra.RawSubjectPublicKeyInfo, old.RawSubjectPublicKeyInfo) || len(g.previousRA) != 1 {
		t.Fatal("RA was not renewed with key/recipient overlap")
	}
	if uid == "" {
		t.Fatal("missing renewal idempotency key")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var saved state
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.KeyID != "same-kms-key" || len(saved.PreviousCertificatesPEM) != 1 {
		t.Fatal("missing restart state")
	}
	// Restore persisted state as on restart, retaining cached-recipient support.
	current, err := parsePEMCerts(saved.CertificatePEM)
	if err != nil {
		t.Fatal(err)
	}
	restored := newGateway(f, current[0], g.key, g.decryptor, g.chain, testChallenge)
	for _, encoded := range saved.PreviousCertificatesPEM {
		certs, err := parsePEMCerts(encoded)
		if err != nil {
			t.Fatal(err)
		}
		restored.previousRA = append(restored.previousRA, certs[0])
	}
	restoredReply := invoke(restored, "POST", "/scep?operation=PKIOperation", message.Raw)
	parsed, err := scep.ParsePKIMessage(restoredReply.Body.Bytes())
	if err != nil || parsed.PKIStatus != scep.SUCCESS {
		t.Fatal("cached recipient lost after restart", err)
	}
	w := invoke(g, "GET", "/scep?operation=GetCACert", nil)
	certs, err := scep.CACerts(w.Body.Bytes())
	if err != nil || !bytes.Equal(certs[0].Raw, g.ra.Raw) {
		t.Fatal("discovery did not switch to new RA")
	}
	w = invoke(g, "POST", "/scep?operation=PKIOperation", message.Raw)
	reply, err := scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil || reply.PKIStatus != scep.SUCCESS {
		t.Fatalf("cached RA recipient failed: %v", err)
	}
	calls := f.calls
	if err := g.renewRA(context.Background(), path, "same-kms-key", issue, time.Now()); err != nil || calls != f.calls {
		t.Fatal("renewed again before threshold", err)
	}
}

func TestRARenewalConcurrentDiscovery(t *testing.T) {
	g, f, _, _ := fixture(t)
	dueRA(t, g, f)
	path := filepath.Join(t.TempDir(), "ra.json")
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 8 {
				w := invoke(g, "GET", "/scep?operation=GetCACert", nil)
				if w.Code != 200 {
					t.Errorf("discovery unavailable during renewal: %d", w.Code)
				}
			}
		}()
	}
	err := g.renewRA(context.Background(), path, "key", func(ctx context.Context, csr *x509.CertificateRequest, _ string) (*x509.Certificate, error) {
		return f.Issue(ctx, csr)
	}, time.Now())
	wg.Wait()
	if err != nil {
		t.Fatal(err)
	}
}

func TestRARenewalFailureKeepsCurrentCertificateAndRetriesUID(t *testing.T) {
	g, f, _, _ := fixture(t)
	dueRA(t, g, f)
	old := g.ra
	dir := t.TempDir()
	path := filepath.Join(dir, "missing", "ra.json")
	var ids []string
	issue := func(ctx context.Context, csr *x509.CertificateRequest, id string) (*x509.Certificate, error) {
		ids = append(ids, id)
		return f.Issue(ctx, csr)
	}
	if err := g.renewRA(context.Background(), path, "kms-key", issue, time.Now()); err == nil {
		t.Fatal("write failure ignored")
	}
	if g.ra != old || len(g.previousRA) != 0 {
		t.Fatal("published unpersisted RA")
	}
	if err := os.Mkdir(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := g.renewRA(context.Background(), path, "kms-key", issue, time.Now()); err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != ids[1] {
		t.Fatal("renewal retry changed idempotency key")
	}
}

func TestRARenewalRejectsRevokedOrInvalidReplacement(t *testing.T) {
	g, f, _, _ := fixture(t)
	dueRA(t, g, f)
	old := g.ra
	path := filepath.Join(t.TempDir(), "ra.json")
	f.ra = nil
	called := false
	issue := func(context.Context, *x509.CertificateRequest, string) (*x509.Certificate, error) {
		called = true
		return nil, errors.New("unexpected issuance")
	}
	if err := g.renewRA(context.Background(), path, "key", issue, time.Now()); err == nil || called {
		t.Fatal("revoked RA renewed")
	}
	f.ra = old
	issue = func(context.Context, *x509.CertificateRequest, string) (*x509.Certificate, error) { return old, nil }
	if err := g.renewRA(context.Background(), path, "key", issue, time.Now()); err == nil || g.ra != old {
		t.Fatal("nonextending certificate accepted")
	}
}

func TestSharedClientRenewalRequiresChallengeAndOwnedSigner(t *testing.T) {
	for _, mode := range []string{"valid", "wrong challenge", "unowned"} {
		t.Run(mode, func(t *testing.T) {
			g, f, key, _ := fixture(t)
			oldCSR := newCSR(t, key, testChallenge, nil)
			old, err := f.Issue(context.Background(), oldCSR)
			if err != nil {
				t.Fatal(err)
			}
			newKey, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				t.Fatal(err)
			}
			challenge := testChallenge
			if mode == "wrong challenge" {
				challenge = "wrong-challenge"
			}
			if mode == "unowned" {
				delete(f.issued, string(oldCSR.Raw))
			}
			eku, _ := asn1.Marshal([]asn1.ObjectIdentifier{{1, 3, 6, 1, 5, 5, 7, 3, 2}})
			csr := newCSR(t, newKey, challenge, []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 37}, Value: eku}})
			msg, err := scep.NewCSRRequest(csr, &scep.PKIMessage{MessageType: scep.RenewalReq, Recipients: []*x509.Certificate{g.ra}, SignerCert: old, SignerKey: key})
			if err != nil {
				t.Fatal(err)
			}
			w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
			reply, err := scep.ParsePKIMessage(w.Body.Bytes())
			if err != nil {
				t.Fatal(err)
			}
			if (reply.PKIStatus == scep.SUCCESS) != (mode == "valid") {
				t.Fatal("incorrect shared renewal authorization", reply.PKIStatus)
			}
		})
	}
}
