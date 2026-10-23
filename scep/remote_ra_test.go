package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRemoteRAUsesOnlyScopedBackendOperations(t *testing.T) {
	private, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing integration token")
		}
		var input map[string][]byte
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if len(input) != 1 {
			t.Error("unexpected operation selectors")
		}
		var output []byte
		if strings.HasSuffix(r.URL.Path, "/sign") {
			output, err = rsa.SignPKCS1v15(rand.Reader, private, crypto.SHA256, input["digest"])
		} else if strings.HasSuffix(r.URL.Path, "/decrypt") {
			output, err = rsa.DecryptPKCS1v15(rand.Reader, private, input["data"])
		} else {
			t.Error("unexpected path")
		}
		if err != nil {
			t.Error(err)
		}
		json.NewEncoder(w).Encode(map[string][]byte{"data": output})
	}))
	defer server.Close()
	k := &backendKey{backend: &backend{url: server.URL, token: "test-token", client: server.Client()}, public: &private.PublicKey}
	if err := keyCheck(k); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("unexpected requests")
	}
	digest := sha256.Sum256([]byte("test"))
	if _, err := k.Sign(nil, digest[:], &rsa.PSSOptions{Hash: crypto.SHA256}); err == nil {
		t.Fatal("accepted algorithm override")
	}
	if calls != 2 {
		t.Fatal("invalid operation reached backend")
	}
}

// Real KMS lives behind the backend. The test never receives KMS coordinates or IDs.
func TestLiveBackendRABoundary(t *testing.T) {
	endpoint := os.Getenv("SCEP_TEST_BACKEND_URL")
	if endpoint == "" {
		t.Skip("SCEP_TEST_BACKEND_URL is not set")
	}
	token, err := os.ReadFile(os.Getenv("SCEP_TEST_TOKEN_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	b := &backend{url: endpoint, token: strings.TrimSpace(string(token)), client: &http.Client{Timeout: 30 * time.Second}}
	saved, err := b.RAState(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	certs, err := parsePEMCerts(saved.CertificatePEM)
	if err != nil {
		t.Fatal(err)
	}
	k := &backendKey{backend: b, public: certs[0].PublicKey.(*rsa.PublicKey)}
	if err := keyCheck(k); err != nil {
		t.Fatal(err)
	}
	chain, err := b.Bundle(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := validateRA(certs[0], chain[0], k.Public()); err != nil {
		t.Fatal(err)
	}
	var output any
	err = b.call(context.Background(), http.MethodPost, "ra/sign", map[string]any{"digest": make([]byte, 32), "keyId": "foreign-key"}, &output)
	if err == nil {
		t.Fatal("backend accepted key identifier")
	}
	_, err = x509.ParseCertificate(certs[0].Raw)
	if err != nil {
		t.Fatal(err)
	}
}
