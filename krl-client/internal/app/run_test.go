package app

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"

	"github.com/oriolrius/pki-manager-krl-client/internal/config"
	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
	"github.com/oriolrius/pki-manager-krl-client/internal/logx"
	"github.com/oriolrius/pki-manager-krl-client/internal/state"
)

// eciesSalt must match decrypt.salt / the backend eciesEncryptV1 verbatim.
var eciesSalt = []byte("pki-manager-krl-ecies-v1")

const krlPath = "/api/v1/external/ssh/krl"

// fixture is a fully-provisioned host: on-disk host key + CA pubkey, plus the
// sealed ciphertext the server should return and the expected version.
type fixture struct {
	hostKeyPath string
	caPubPath   string
	krlFile     string
	stateDir    string
	hostID      string
	krl         []byte            // bare KRL bytes (a secret-ish blob to scan for)
	version     string            // sha256:<hex> == X-KRL-Version
	plaintext   []byte            // the decrypted payload JSON (must never be logged)
	ciphertext  []byte            // the ECIES envelope the server returns (must never be logged)
	hostKeyPEM  []byte            // the raw private key file (must never be logged)
	hostPub     *ecdh.PublicKey   // recipient for re-sealing custom payloads (AC#2 cases)
	caKey       *ecdsa.PrivateKey // signer for re-signing custom payloads (AC#2 cases)
}

// newFixture generates keys, signs a KRL, and seals the payload to the host key.
func newFixture(t *testing.T, hostID string, krlNumber int64) *fixture {
	t.Helper()
	dir := t.TempDir()

	// Host ECDSA key -> OpenSSH private-key file (the ECIES decrypt key).
	hostEC, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	blk, err := ssh.MarshalPrivateKey(hostEC, "host")
	if err != nil {
		t.Fatal(err)
	}
	hostKeyPEM := pem.EncodeToMemory(blk)
	hostKeyPath := filepath.Join(dir, "ssh_host_ecdsa_key")
	if err := os.WriteFile(hostKeyPath, hostKeyPEM, 0o600); err != nil {
		t.Fatal(err)
	}
	hostECDH, err := hostEC.ECDH()
	if err != nil {
		t.Fatal(err)
	}

	// CA ECDSA key -> authorized_keys pubkey file (TrustedUserCAKeys shape).
	caEC, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caSSHPub, err := ssh.NewPublicKey(&caEC.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	caPubPath := filepath.Join(dir, "ssh-user-ca.pub")
	if err := os.WriteFile(caPubPath, ssh.MarshalAuthorizedKey(caSSHPub), 0o644); err != nil {
		t.Fatal(err)
	}

	// KRL blob + version + detached CA signature (ECDSA-P256 DER over sha256(krl)).
	krl := []byte("SSHKRL-SECRET-REVOCATION-BLOB-0123456789abcdef")
	sum := sha256.Sum256(krl)
	version := "sha256:" + hex.EncodeToString(sum[:])
	sig, err := ecdsa.SignASN1(rand.Reader, caEC, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	plaintext, err := json.Marshal(map[string]any{
		"krl":          base64.StdEncoding.EncodeToString(krl),
		"ca_signature": sigB64,
		"krl_version":  version,
		"krl_number":   krlNumber,
		"valid_until":  int64(9999999999),
		"host_id":      hostID,
	})
	if err != nil {
		t.Fatal(err)
	}

	return &fixture{
		hostKeyPath: hostKeyPath,
		caPubPath:   caPubPath,
		krlFile:     filepath.Join(dir, "revoked_keys"),
		stateDir:    filepath.Join(dir, "state"),
		hostID:      hostID,
		krl:         krl,
		version:     version,
		plaintext:   plaintext,
		ciphertext:  sealV1(t, hostECDH.PublicKey(), plaintext),
		hostKeyPEM:  hostKeyPEM,
		hostPub:     hostECDH.PublicKey(),
		caKey:       caEC,
	}
}

// sealV1 mirrors the backend eciesEncryptV1 sender (see decrypt_test.sealV1).
func sealV1(t *testing.T, recipient *ecdh.PublicKey, pt []byte) []byte {
	t.Helper()
	eph, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ephPub := eph.PublicKey().Bytes()
	shared, err := eph.ECDH(recipient)
	if err != nil {
		t.Fatal(err)
	}
	key, err := hkdf.Key(sha256.New, shared, eciesSalt, string(ephPub), 32)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	nonce := make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	ct := gcm.Seal(nil, nonce, pt, nil)
	out := append([]byte{}, ephPub...)
	out = append(out, nonce...)
	return append(out, ct...)
}

func (f *fixture) cfg(serverURL, format string) *config.Config {
	return &config.Config{
		ServerURL: serverURL,
		HostID:    f.hostID,
		HostKey:   f.hostKeyPath,
		CAPubkey:  f.caPubPath,
		KRLFile:   f.krlFile,
		StateDir:  f.stateDir,
		Timeout:   config.DefaultTimeout,
		Retries:   0,
		ClockSkew: config.DefaultClockSkew,
		LogFormat: format,
	}
}

// serve returns a KRL endpoint that honours If-None-Match (304) and otherwise
// returns 200 + the sealed ciphertext, both carrying X-KRL-Version.
func (f *fixture) serve(t *testing.T) *httptest.Server {
	return serveKRL(t, f.version, f.ciphertext)
}

// serveKRL is the fake PKI-Manager KRL endpoint: it advertises version via
// X-KRL-Version, answers 304 when the client's If-None-Match already matches,
// and otherwise returns 200 + ct. Used by every case that needs a custom
// ciphertext/version pair (the AC#2 policy-failure table, the golden interop).
func serveKRL(t *testing.T, version string, ct []byte) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != krlPath || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
			return
		}
		w.Header().Set("X-KRL-Version", version)
		if r.Header.Get("If-None-Match") == version {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(ct)
	}))
}

// bufLogger builds a json logger writing to buf so events can be scanned.
func bufLogger(buf *bytes.Buffer, opts logx.Options) *slog.Logger {
	opts.Format = "json"
	opts.Writer = buf
	return logx.New(opts)
}

// summaryEvents returns every parsed JSON line whose event == "run_summary".
func summaryEvents(t *testing.T, out string) []map[string]any {
	t.Helper()
	var summaries []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(line), &obj); err != nil {
			t.Fatalf("log line is not valid JSON: %v\n%s", err, line)
		}
		if obj["event"] == "run_summary" {
			summaries = append(summaries, obj)
		}
	}
	return summaries
}

// AC#1 + AC#3 — a full happy path: decrypt, verify, install; the summary reports
// outcome=updated with http_status/krl_version/host_id/exit_code, and NO secret
// (payload plaintext, ciphertext, host key, base64 KRL) appears in the output.
func TestRunHappyPathUpdatedAndRedacted(t *testing.T) {
	f := newFixture(t, "web01.example.com", 5)
	srv := f.serve(t)
	defer srv.Close()

	var buf bytes.Buffer
	code := run(f.cfg(srv.URL, "json"), bufLogger(&buf, logx.Options{Verbose: true}))
	out := buf.String()

	if code != exitcodes.OK {
		t.Fatalf("exit code = %d, want 0\n%s", code, out)
	}
	// The KRL was actually installed.
	got, err := os.ReadFile(f.krlFile)
	if err != nil || !bytes.Equal(got, f.krl) {
		t.Fatalf("krl file mismatch: err=%v got=%q", err, got)
	}

	sums := summaryEvents(t, out)
	if len(sums) != 1 {
		t.Fatalf("want exactly one run_summary event, got %d\n%s", len(sums), out)
	}
	s := sums[0]
	assertField(t, s, "outcome", "updated")
	assertField(t, s, "krl_version", f.version)
	assertField(t, s, "host_id", f.hostID)
	if s["http_status"] != float64(200) {
		t.Errorf("http_status = %v, want 200", s["http_status"])
	}
	if s["exit_code"] != float64(0) {
		t.Errorf("exit_code = %v, want 0", s["exit_code"])
	}

	// AC#3 — secrets must never appear at any level.
	assertAbsent(t, out, string(f.plaintext), "decrypted payload plaintext")
	assertAbsent(t, out, base64.StdEncoding.EncodeToString(f.krl), "base64 KRL field")
	assertAbsent(t, out, string(f.ciphertext), "ECIES ciphertext")
	assertAbsent(t, out, string(f.hostKeyPEM[100:200]), "host private-key material")
}

// AC#1 — the 304 path yields outcome=up_to_date, http_status=304, exit 0.
func TestRunUpToDate304(t *testing.T) {
	f := newFixture(t, "web01.example.com", 5)
	// Pre-seed the cache so If-None-Match is sent and the server answers 304.
	if err := state.Write(f.stateDir, &state.State{Version: f.version, Number: 5}); err != nil {
		t.Fatal(err)
	}
	srv := f.serve(t)
	defer srv.Close()

	var buf bytes.Buffer
	code := run(f.cfg(srv.URL, "json"), bufLogger(&buf, logx.Options{}))
	out := buf.String()

	if code != exitcodes.OK {
		t.Fatalf("exit = %d, want 0\n%s", code, out)
	}
	sums := summaryEvents(t, out)
	if len(sums) != 1 {
		t.Fatalf("want one run_summary, got %d\n%s", len(sums), out)
	}
	assertField(t, sums[0], "outcome", "up_to_date")
	if sums[0]["http_status"] != float64(304) {
		t.Errorf("http_status = %v, want 304", sums[0]["http_status"])
	}
}

// AC#2 — on failure the summary is an ERROR-level event, so it surfaces even
// under --quiet; the exit code is carried by the summary.
func TestRunErrorSummarySurfacesUnderQuiet(t *testing.T) {
	f := newFixture(t, "web01.example.com", 5)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound) // -> NotProvisioned (9)
	}))
	defer srv.Close()

	var buf bytes.Buffer
	code := run(f.cfg(srv.URL, "json"), bufLogger(&buf, logx.Options{Quiet: true}))
	out := buf.String()

	if code != exitcodes.NotProvisioned {
		t.Fatalf("exit = %d, want 9\n%s", code, out)
	}
	sums := summaryEvents(t, out)
	if len(sums) != 1 {
		t.Fatalf("error summary must surface under --quiet, got %d events\n%s", len(sums), out)
	}
	assertField(t, sums[0], "outcome", "error")
	assertField(t, sums[0], "level", "ERROR")
	if sums[0]["exit_code"] != float64(exitcodes.NotProvisioned) {
		t.Errorf("exit_code = %v, want 9", sums[0]["exit_code"])
	}
}

// AC#2 — when the server 404s (host has no P-256 key registered), the run_summary
// error field carries the actionable onboarding step, not a cryptic status line.
func TestRunNotRegisteredSurfacesActionableStep(t *testing.T) {
	f := newFixture(t, "web01.example.com", 5)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"code":"NOT_FOUND","message":"host not registered for KRL distribution"}}`))
	}))
	defer srv.Close()

	var buf bytes.Buffer
	code := run(f.cfg(srv.URL, "json"), bufLogger(&buf, logx.Options{}))
	if code != exitcodes.NotProvisioned {
		t.Fatalf("exit = %d, want 9\n%s", code, buf.String())
	}
	sums := summaryEvents(t, buf.String())
	if len(sums) != 1 {
		t.Fatalf("want one run_summary, got %d\n%s", len(sums), buf.String())
	}
	errMsg, _ := sums[0]["error"].(string)
	for _, want := range []string{"/etc/ssh/ssh_host_ecdsa_key.pub", "register", "pki-manager"} {
		if !strings.Contains(errMsg, want) {
			t.Errorf("run_summary error missing %q; got: %s", want, errMsg)
		}
	}
}

// AC#2 — --quiet suppresses the info-level summary of a SUCCESSFUL run entirely
// (cron-friendly silence), while --verbose adds per-step debug events.
func TestQuietSilentOnSuccessVerboseAddsSteps(t *testing.T) {
	f := newFixture(t, "web01.example.com", 7)

	// Quiet + success (304) => no output at all.
	if err := state.Write(f.stateDir, &state.State{Version: f.version, Number: 7}); err != nil {
		t.Fatal(err)
	}
	srv := f.serve(t)
	defer srv.Close()

	var quiet bytes.Buffer
	if code := run(f.cfg(srv.URL, "json"), bufLogger(&quiet, logx.Options{Quiet: true})); code != exitcodes.OK {
		t.Fatalf("quiet 304 run exit = %d\n%s", code, quiet.String())
	}
	if strings.TrimSpace(quiet.String()) != "" {
		t.Errorf("quiet successful run must be silent, got:\n%s", quiet.String())
	}

	// Verbose + success (304) => per-step debug events present alongside the summary.
	var verbose bytes.Buffer
	if code := run(f.cfg(srv.URL, "json"), bufLogger(&verbose, logx.Options{Verbose: true})); code != exitcodes.OK {
		t.Fatalf("verbose 304 run exit = %d\n%s", code, verbose.String())
	}
	if !strings.Contains(verbose.String(), "fetch complete") {
		t.Errorf("verbose run must emit per-step debug events, got:\n%s", verbose.String())
	}
}

func assertField(t *testing.T, obj map[string]any, key, want string) {
	t.Helper()
	if got, _ := obj[key].(string); got != want {
		t.Errorf("summary[%q] = %q, want %q", key, got, want)
	}
}

func assertAbsent(t *testing.T, out, secret, label string) {
	t.Helper()
	if secret != "" && strings.Contains(out, secret) {
		t.Errorf("%s leaked into log output", label)
	}
}
