package krlclient

import (
	"context"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

func codeOf(err error) exitcodes.Code {
	if e, ok := err.(*exitcodes.Error); ok {
		return e.Code
	}
	return -1
}

func TestFetch200ThenConditional304(t *testing.T) {
	const version = "sha256:abc123"
	var sawHostID string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/external/ssh/krl" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
			return
		}
		var body struct {
			HostID string `json:"host_id"`
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &body)
		sawHostID = body.HostID
		w.Header().Set("X-KRL-Version", version)
		if r.Header.Get("If-None-Match") == version {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("CIPHERTEXT"))
	}))
	defer srv.Close()

	c, err := New(srv.URL, "", false, 5*time.Second, 1)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	r, err := c.FetchKRL(ctx, "h.example.com", "")
	if err != nil {
		t.Fatalf("first fetch: %v", err)
	}
	if r.NotModified || string(r.Body) != "CIPHERTEXT" || r.Version != version {
		t.Fatalf("unexpected first result: %+v", r)
	}
	if sawHostID != "h.example.com" {
		t.Fatalf("server saw host_id %q", sawHostID)
	}

	r2, err := c.FetchKRL(ctx, "h.example.com", version)
	if err != nil {
		t.Fatalf("conditional fetch: %v", err)
	}
	if !r2.NotModified {
		t.Fatalf("expected 304 not-modified, got %+v", r2)
	}
}

func TestStatusToExitCode(t *testing.T) {
	cases := []struct {
		status int
		want   exitcodes.Code
	}{
		{http.StatusBadRequest, exitcodes.NotProvisioned},
		{http.StatusNotFound, exitcodes.NotProvisioned},
		{http.StatusNotImplemented, exitcodes.NotProvisioned},
		{http.StatusTooManyRequests, exitcodes.RateLimited},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
		}))
		c, _ := New(srv.URL, "", false, 5*time.Second, 0)
		_, err := c.FetchKRL(context.Background(), "h", "")
		if codeOf(err) != tc.want {
			t.Errorf("status %d: got exit %v, want %v (err=%v)", tc.status, codeOf(err), tc.want, err)
		}
		srv.Close()
	}
}

// AC#2 — a 404 (host unknown / no P-256 key on file) carries an actionable
// onboarding hint (register the ecdsa .pub) rather than a bare status line.
func TestNotFoundMessageIsActionable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"code":"NOT_FOUND","message":"host not registered for KRL distribution"}}`))
	}))
	defer srv.Close()

	c, _ := New(srv.URL, "", false, 5*time.Second, 0)
	_, err := c.FetchKRL(context.Background(), "web01.example.com", "")
	if codeOf(err) != exitcodes.NotProvisioned {
		t.Fatalf("want NotProvisioned, got %v (%v)", codeOf(err), err)
	}
	for _, want := range []string{"/etc/ssh/ssh_host_ecdsa_key.pub", "register", "pki-manager"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("404 message missing %q; got: %s", want, err.Error())
		}
	}
}

func TestRetriesOn5xxThenSucceeds(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&calls, 1) < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("X-KRL-Version", "sha256:v")
		_, _ = w.Write([]byte("OK"))
	}))
	defer srv.Close()

	c, _ := New(srv.URL, "", false, 5*time.Second, 3)
	r, err := c.FetchKRL(context.Background(), "h", "")
	if err != nil {
		t.Fatalf("expected success after retries: %v", err)
	}
	if string(r.Body) != "OK" {
		t.Fatalf("unexpected body %q", r.Body)
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Fatalf("expected 3 calls, got %d", calls)
	}
}

func TestExhausted5xxIsNetworkError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	c, _ := New(srv.URL, "", false, 2*time.Second, 1)
	_, err := c.FetchKRL(context.Background(), "h", "")
	if codeOf(err) != exitcodes.Network {
		t.Fatalf("want Network, got %v (%v)", codeOf(err), err)
	}
}

func TestTLSVerificationEnforced(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-KRL-Version", "sha256:v")
		_, _ = w.Write([]byte("X"))
	}))
	defer srv.Close()

	// Verification on (default): the self-signed cert is untrusted -> transport error -> Network.
	c, _ := New(srv.URL, "", false, 3*time.Second, 0)
	if _, err := c.FetchKRL(context.Background(), "h", ""); codeOf(err) != exitcodes.Network {
		t.Fatalf("expected TLS verification failure (Network), got %v", err)
	}
	// --insecure bypasses verification.
	ci, _ := New(srv.URL, "", true, 3*time.Second, 0)
	r, err := ci.FetchKRL(context.Background(), "h", "")
	if err != nil || string(r.Body) != "X" {
		t.Fatalf("insecure fetch failed: %v", err)
	}
}

// A 200 body larger than the configured ceiling is rejected (fail-closed) rather
// than buffered — a hostile/compromised endpoint cannot OOM the client. The read
// is bounded to maxBytes+1, so the multi-KB body here is never fully consumed.
func TestOversizeResponseBodyRejected(t *testing.T) {
	big := strings.Repeat("A", 4096)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-KRL-Version", "sha256:v")
		_, _ = w.Write([]byte(big))
	}))
	defer srv.Close()

	c, _ := New(srv.URL, "", false, 5*time.Second, 0)
	c.SetMaxResponseBytes(64) // ceiling far below the 4096-byte body
	r, err := c.FetchKRL(context.Background(), "h", "")
	if r != nil {
		t.Fatalf("expected no result for an oversize body, got %+v", r)
	}
	if codeOf(err) != exitcodes.Network {
		t.Fatalf("expected Network exit for oversize body, got %v (%v)", codeOf(err), err)
	}

	// A body within the ceiling still succeeds through the bounded reader.
	c.SetMaxResponseBytes(4096)
	r2, err := c.FetchKRL(context.Background(), "h", "")
	if err != nil || string(r2.Body) != big {
		t.Fatalf("in-limit body should pass: err=%v len=%d", err, len(r2.Body))
	}
}

func TestServerURLRequired(t *testing.T) {
	if _, err := New("", "", false, time.Second, 0); codeOf(err) != exitcodes.Usage {
		t.Fatalf("expected Usage error for empty server-url, got %v", err)
	}
}

func TestCABundlePinning(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-KRL-Version", "sha256:v")
		_, _ = w.Write([]byte("PINNED"))
	}))
	defer srv.Close()

	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw})
	bundle := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(bundle, pemBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := New(srv.URL, bundle, false, 3*time.Second, 0)
	if err != nil {
		t.Fatal(err)
	}
	r, err := c.FetchKRL(context.Background(), "h", "")
	if err != nil || string(r.Body) != "PINNED" {
		t.Fatalf("pinned --ca-bundle fetch failed: %v", err)
	}
}

func TestTimeoutAborts(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(300 * time.Millisecond)
		_, _ = w.Write([]byte("late"))
	}))
	defer srv.Close()
	c, _ := New(srv.URL, "", false, 50*time.Millisecond, 0)
	_, err := c.FetchKRL(context.Background(), "h", "")
	if codeOf(err) != exitcodes.Network {
		t.Fatalf("expected Network (timeout), got %v", err)
	}
}
