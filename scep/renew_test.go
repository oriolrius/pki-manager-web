package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"github.com/smallstep/scep"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func publicPEM(c *x509.Certificate) string {
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Raw}))
}
func nextState(t *testing.T, g *gateway, f *fakeIssuer) state {
	t.Helper()
	tmpl := *g.ra
	tmpl.NotAfter = g.ra.NotAfter.Add(time.Hour)
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, f.ca, g.key.Public(), f.key)
	if err != nil {
		t.Fatal(err)
	}
	next, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	f.issued[string(next.Raw)] = next
	return state{CertificatePEM: publicPEM(next), PreviousCertificatesPEM: []string{publicPEM(g.ra)}}
}
func TestBackendRenewalPersistsPublicStateAndCachedRecipient(t *testing.T) {
	g, f, key, signer := fixture(t)
	old := g.ra
	msg := request(t, g, key, signer, testChallenge, nil)
	saved := nextState(t, g, f)
	path := filepath.Join(t.TempDir(), "ra.json")
	if err := g.renewRA(context.Background(), path, func(context.Context) (state, error) { return saved, nil }); err != nil {
		t.Fatal(err)
	}
	if g.ra == old || len(g.previousRA) != 1 {
		t.Fatal("renewal not published")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) == "" {
		t.Fatal("missing public state")
	}
	w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
	reply, err := scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil || reply.PKIStatus != scep.SUCCESS {
		t.Fatal("cached recipient rejected", err)
	}
}
func TestBackendRenewalFailsClosed(t *testing.T) {
	g, f, _, _ := fixture(t)
	old := g.ra
	path := filepath.Join(t.TempDir(), "missing", "ra.json")
	saved := nextState(t, g, f)
	if err := g.renewRA(context.Background(), path, func(context.Context) (state, error) { return saved, nil }); err == nil || g.ra != old {
		t.Fatal("published unpersisted state")
	}
	if err := g.renewRA(context.Background(), path, func(context.Context) (state, error) { return state{}, errors.New("backend unavailable") }); err == nil || g.ra != old {
		t.Fatal("ignored backend failure")
	}
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	saved.CertificatePEM = publicPEM(makeCert(&other.PublicKey, g.ra.Subject, f.ca, f.key, false))
	if err := g.renewRA(context.Background(), path, func(context.Context) (state, error) { return saved, nil }); err == nil || g.ra != old {
		t.Fatal("adopted another key")
	}
}
func TestRenewalNetworkDoesNotBlockDiscovery(t *testing.T) {
	g, f, _, _ := fixture(t)
	saved := nextState(t, g, f)
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		done <- g.renewRA(context.Background(), filepath.Join(t.TempDir(), "ra.json"), func(context.Context) (state, error) { close(started); <-release; return saved, nil })
	}()
	<-started
	discovery := make(chan int, 1)
	go func() { discovery <- invoke(g, "GET", "/scep?operation=GetCACert", nil).Code }()
	select {
	case code := <-discovery:
		if code != 200 {
			t.Errorf("discovery HTTP %d", code)
		}
	case <-time.After(time.Second):
		t.Error("renewal blocked discovery")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
