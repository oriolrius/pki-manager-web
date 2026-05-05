package signer

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealth_Success(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "no auth", 401)
			return
		}
		_ = json.NewEncoder(w).Encode(HealthResponse{Status: "ok"})
	}))
	defer ts.Close()
	c := New(ts.URL, "tok")
	h, err := c.Health(context.Background())
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if h.Status != "ok" {
		t.Fatalf("status = %q", h.Status)
	}
}

func TestSign_ParsesError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":{"code":"INVALID_CSR","message":"bad"}}`))
	}))
	defer ts.Close()
	c := New(ts.URL, "t")
	_, err := c.Sign(context.Background(), &SignRequest{CSRPem: "x", RequestUID: "u"})
	if err == nil || !strings.Contains(err.Error(), "INVALID_CSR") {
		t.Fatalf("expected INVALID_CSR error, got %v", err)
	}
}

func TestRevoke_Success(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(RevokeResponse{Status: "revoked", SerialNumber: "01"})
	}))
	defer ts.Close()
	c := New(ts.URL, "t")
	r, err := c.Revoke(context.Background(), &RevokeRequest{SerialNumber: "01"})
	if err != nil || r.Status != "revoked" {
		t.Fatalf("err=%v r=%+v", err, r)
	}
}
