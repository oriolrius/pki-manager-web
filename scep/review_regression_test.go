package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestBackendURLRequiresTLSExceptLoopback(t *testing.T) {
	for _, s := range []string{"http://backend:3000", "http://10.0.0.1", "http://localhost.example", "ftp://localhost", "https://user:pass@example.com"} {
		if validateBackendURL(s) == nil {
			t.Errorf("unsafe backend URL accepted: %s", s)
		}
	}
	for _, s := range []string{"https://pki.example.com", "http://127.0.0.1:3000", "http://[::1]:3000", "http://localhost:3000"} {
		if err := validateBackendURL(s); err != nil {
			t.Errorf("valid backend URL rejected: %s", s)
		}
	}
}
func TestStartupRenewalFailureKeepsValidRAOnly(t *testing.T) {
	g, f, _, _ := fixture(t)
	saved := state{CertificatePEM: publicPEM(g.ra)}
	outage := func(context.Context) (state, error) { return state{}, errors.New("renewal lease busy") }
	current, err := startupRARenew(context.Background(), saved, f.ca, outage)
	if err != nil || current.CertificatePEM != saved.CertificatePEM {
		t.Fatal("valid RA could not start", err)
	}
	tmpl := *g.ra
	tmpl.NotBefore = time.Now().Add(-2 * time.Hour)
	tmpl.NotAfter = time.Now().Add(-time.Hour)
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, f.ca, g.ra.PublicKey, f.key)
	if err != nil {
		t.Fatal(err)
	}
	expired, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := startupRARenew(context.Background(), state{CertificatePEM: publicPEM(expired)}, f.ca, outage); err == nil {
		t.Fatal("expired RA accepted after failed renewal")
	}
}

type blockedStatus struct {
	*fakeIssuer
	entered chan struct{}
	release chan struct{}
	calls   atomic.Int32
}

func (s *blockedStatus) Active(ctx context.Context, _ *x509.Certificate) error {
	s.calls.Add(1)
	close(s.entered)
	select {
	case <-s.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func TestBlockedRequestDoesNotBlockRenewalOrDiscovery(t *testing.T) {
	g, f, key, signer := fixture(t)
	msg := request(t, g, key, signer, testChallenge, nil)
	status := &blockedStatus{fakeIssuer: f, entered: make(chan struct{}), release: make(chan struct{})}
	g.issuer = status
	completed := make(chan struct{})
	go func() { invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw); close(completed) }()
	<-status.entered
	renewed := make(chan error, 1)
	saved := nextState(t, g, f)
	go func() {
		renewed <- g.renewRA(context.Background(), filepath.Join(t.TempDir(), "ra.json"), func(context.Context) (state, error) { return saved, nil })
	}()
	select {
	case err := <-renewed:
		if err != nil {
			t.Error(err)
		}
	case <-time.After(time.Second):
		t.Error("blocked request held RA write lock")
	}
	if invoke(g, "GET", "/scep?operation=GetCACaps", nil).Code != 200 || invoke(g, "GET", "/scep?operation=GetCACert", nil).Code != 200 {
		t.Error("discovery blocked")
	}
	if status.calls.Load() != 1 {
		t.Error("discovery called backend")
	}
	close(status.release)
	<-completed
}
func TestRASignAndDecryptUseCancellation(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 3072)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var calls int
	b := &backend{url: "http://localhost", client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Context().Err() == nil {
			t.Error("RA operation lost request cancellation")
		}
		return nil, r.Context().Err()
	})}}
	k := &backendKey{backend: b, public: &key.PublicKey, ctx: ctx}
	digest := sha256.Sum256([]byte("test"))
	if _, err := k.Sign(nil, digest[:], crypto.SHA256); err == nil {
		t.Fatal("cancelled sign succeeded")
	}
	if _, err := k.Decrypt(nil, make([]byte, 384), nil); err == nil {
		t.Fatal("cancelled decrypt succeeded")
	}
	if calls != 2 {
		t.Fatal("missing operations")
	}
}
func TestGatewayPropagatesRequestCancellationToRA(t *testing.T) {
	g, _, clientKey, signer := fixture(t)
	msg := request(t, g, clientKey, signer, testChallenge, nil)
	entered := make(chan struct{}, 1)
	b := &backend{url: "http://localhost", client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		select {
		case entered <- struct{}{}:
		default:
		}
		<-r.Context().Done()
		return nil, r.Context().Err()
	})}}
	remote := &backendKey{backend: b, public: g.ra.PublicKey.(*rsa.PublicKey)}
	g.key = remote
	g.decryptor = remote
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest("POST", "/scep?operation=PKIOperation", bytes.NewReader(msg.Raw)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/x-pki-message")
	done := make(chan struct{})
	go func() { g.ServeHTTP(httptest.NewRecorder(), req); close(done) }()
	<-entered
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancelled request kept RA call alive")
	}
}
