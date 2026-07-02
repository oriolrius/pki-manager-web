package app

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
	"github.com/oriolrius/pki-manager-krl-client/internal/logx"
	"github.com/oriolrius/pki-manager-krl-client/internal/state"
)

// validPayload builds a fully valid decrypted-payload map for f, so a case can
// mutate exactly one field to reach a single failure at its intended stage. The
// anti-rollback number rides f.krl's signed header (set via newFixture), not JSON.
func validPayload(t *testing.T, f *fixture) map[string]any {
	t.Helper()
	sum := sha256.Sum256(f.krl)
	sig, err := ecdsa.SignASN1(rand.Reader, f.caKey, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{
		"krl":          base64.StdEncoding.EncodeToString(f.krl),
		"ca_signature": base64.StdEncoding.EncodeToString(sig),
		"krl_version":  f.version,
		"valid_until":  int64(9999999999),
		"host_id":      f.hostID,
	}
}

// seal marshals a payload map and seals it to f's host key (mirrors the backend).
func seal(t *testing.T, f *fixture, m map[string]any) []byte {
	t.Helper()
	pt, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return sealV1(t, f.hostPub, pt)
}

// AC#2 — each policy failure surfaces as one ERROR-level run_summary carrying its
// documented exit code (anti-rollback 8, bad-signature 4, expired 5,
// host-mismatch 6, null-signature-without-allow-unsigned 4), and nothing is
// installed. Payloads are re-sealed to the host key so the pipeline actually
// decrypts and reaches the validate/verify stage under test.
func TestRunPolicyFailureExitCodes(t *testing.T) {
	const host = "web01.example.com"

	// A second CA whose signature will NOT verify against the fixture's --ca-pubkey.
	wrongCA, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name     string
		number   int64
		mutate   func(f *fixture, m map[string]any)
		preState *state.State // pre-seeded cache (anti-rollback)
		wantCode exitcodes.Code
	}{
		{
			name:     "anti_rollback",
			number:   3, // f.krl's signed header carries 3
			preState: &state.State{Version: "sha256:0000", Number: 10},
			wantCode: exitcodes.Version, // 8 — header number 3 <= installed 10
		},
		{
			name:   "bad_signature",
			number: 5,
			mutate: func(f *fixture, m map[string]any) {
				sum := sha256.Sum256(f.krl)
				sig, serr := ecdsa.SignASN1(rand.Reader, wrongCA, sum[:])
				if serr != nil {
					t.Fatal(serr)
				}
				m["ca_signature"] = base64.StdEncoding.EncodeToString(sig)
			},
			wantCode: exitcodes.Verify, // 4 — signature does not verify against --ca-pubkey
		},
		{
			name:     "expired",
			number:   5,
			mutate:   func(_ *fixture, m map[string]any) { m["valid_until"] = int64(1000000000) }, // 2001
			wantCode: exitcodes.Expired,                                                           // 5
		},
		{
			name:     "host_mismatch",
			number:   5,
			mutate:   func(_ *fixture, m map[string]any) { m["host_id"] = "other.example.com" },
			wantCode: exitcodes.HostMismatch, // 6
		},
		{
			name:     "null_signature_without_allow_unsigned",
			number:   5,
			mutate:   func(_ *fixture, m map[string]any) { m["ca_signature"] = nil },
			wantCode: exitcodes.Verify, // 4 — ca_signature null and --allow-unsigned not set
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t, host, tc.number)
			m := validPayload(t, f)
			if tc.mutate != nil {
				tc.mutate(f, m)
			}
			if tc.preState != nil {
				if err := state.Write(f.stateDir, tc.preState); err != nil {
					t.Fatal(err)
				}
			}
			srv := serveKRL(t, f.version, seal(t, f, m))
			defer srv.Close()

			var buf bytes.Buffer
			code := run(f.cfg(srv.URL, "json"), bufLogger(&buf, logx.Options{}))
			out := buf.String()
			if code != tc.wantCode {
				t.Fatalf("exit = %d, want %d\n%s", code, tc.wantCode, out)
			}

			sums := summaryEvents(t, out)
			if len(sums) != 1 {
				t.Fatalf("want one run_summary, got %d\n%s", len(sums), out)
			}
			assertField(t, sums[0], "outcome", "error")
			if sums[0]["exit_code"] != float64(tc.wantCode) {
				t.Errorf("summary exit_code = %v, want %d", sums[0]["exit_code"], tc.wantCode)
			}

			// A rejected KRL must never be installed.
			if _, err := os.Stat(f.krlFile); !os.IsNotExist(err) {
				t.Errorf("KRL file must not exist after a %s failure", tc.name)
			}
		})
	}
}

// AC#2 (complement) — a null signature DOES install under --allow-unsigned, so
// the exit-4 rejection above is specifically the policy, not a decode failure.
func TestRunNullSignatureAllowUnsignedInstalls(t *testing.T) {
	f := newFixture(t, "web01.example.com", 9)
	m := validPayload(t, f)
	m["ca_signature"] = nil // unsigned payload

	srv := serveKRL(t, f.version, seal(t, f, m))
	defer srv.Close()

	cfg := f.cfg(srv.URL, "json")
	cfg.AllowUnsigned = true

	var buf bytes.Buffer
	if code := run(cfg, bufLogger(&buf, logx.Options{})); code != exitcodes.OK {
		t.Fatalf("allow-unsigned run exit = %d, want 0\n%s", code, buf.String())
	}
	got, err := os.ReadFile(f.krlFile)
	if err != nil || !bytes.Equal(got, f.krl) {
		t.Fatalf("KRL not installed under --allow-unsigned: err=%v", err)
	}
}
