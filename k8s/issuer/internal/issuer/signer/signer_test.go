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

// Found with FuzzClientResponse: a 200 answer with no certificate was accepted,
// and the controller then marked the CertificateRequest Ready with an empty
// certificate.
func TestSign_RejectsResponseWithoutCertificate(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `{"serialNumber":"01","certificatePem":""}`,
		`{"certificatePem":"-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n"}`,
		`{"certificatePem":"-----BEGIN PRIVATE KEY-----\nMAA=\n-----END PRIVATE KEY-----\n"}`} {
		c := New("https://pki.example.test", "t")
		c.hc.Transport = respond{200, []byte(body)}
		if r, err := c.Sign(context.Background(), &SignRequest{CSRPem: "x", RequestUID: "u"}); err == nil || r != nil {
			t.Fatalf("accepted %s", body)
		}
	}
}

func TestSign_AcceptsResponseWithCertificate(t *testing.T) {
	body, _ := json.Marshal(SignResponse{SerialNumber: "01", CertificatePEM: testCertPEM(t)})
	c := New("https://pki.example.test", "t")
	c.hc.Transport = respond{200, body}
	r, err := c.Sign(context.Background(), &SignRequest{CSRPem: "x", RequestUID: "u"})
	if err != nil || r.SerialNumber != "01" {
		t.Fatalf("err=%v r=%+v", err, r)
	}
}
