package config

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// ── test doubles for the injectable env / file sources ──────────────────────

func noEnv(string) string { return "" }

func envMap(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func noFile(string) ([]byte, error) { return nil, os.ErrNotExist }

func fileWith(content string) func(string) ([]byte, error) {
	return func(string) ([]byte, error) { return []byte(content), nil }
}

func wantUsageErr(t *testing.T, err error, substr string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected usage error containing %q, got nil", substr)
	}
	var ce *exitcodes.Error
	if !errors.As(err, &ce) {
		t.Fatalf("error %v is not *exitcodes.Error", err)
	}
	if ce.Code != exitcodes.Usage {
		t.Fatalf("exit code = %d, want %d (Usage)", ce.Code, exitcodes.Usage)
	}
	if !strings.Contains(ce.Msg, substr) {
		t.Fatalf("error %q does not contain %q", ce.Msg, substr)
	}
}

// AC#2 — every on-host path default equals the ssh-config.ts canonical constant,
// and a host provisioned from 60-ssh-ca.conf parses with ONLY --server-url.
func TestDefaultsDeriveFromCanonicalPaths(t *testing.T) {
	cfg, err := parse([]string{"--server-url", "https://pki.example"}, "test", noEnv, noFile)
	if err != nil {
		t.Fatalf("parse with only --server-url failed: %v", err)
	}
	checks := []struct {
		name, got, want string
	}{
		{"host-key", cfg.HostKey, "/etc/ssh/ssh_host_ecdsa_key"}, // hostKeyPathFor('ecdsa-sha2-nistp256')
		{"ca-pubkey", cfg.CAPubkey, "/etc/ssh/ssh-user-ca.pub"},  // USER_CA_PATH
		{"krl-file", cfg.KRLFile, "/etc/ssh/revoked_keys"},       // REVOKED_KEYS_PATH
		{"state-dir", cfg.StateDir, "/var/lib/krl-client"},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s default = %q, want %q", c.name, c.got, c.want)
		}
	}
	if cfg.HostID == "" {
		t.Error("host-id should derive from `hostname -f`, got empty")
	}
	if cfg.Timeout != 30*time.Second || cfg.Retries != 3 || cfg.ClockSkew != 300*time.Second {
		t.Errorf("scalar defaults drifted: timeout=%s retries=%d skew=%s", cfg.Timeout, cfg.Retries, cfg.ClockSkew)
	}
	if cfg.LogFormat != "text" || cfg.Insecure || cfg.AllowUnsigned || cfg.DryRun {
		t.Errorf("boolean/format defaults drifted: %+v", cfg)
	}
}

// AC#1 — precedence flag > env > file > default, verified for server-url.
func TestPrecedence_ServerURL(t *testing.T) {
	const env, file = "https://env.example", "https://file.example"
	e := envMap(map[string]string{"KRL_CLIENT_SERVER_URL": env})
	f := fileWith("server-url: https://file.example\nhost-id: h.example\n")

	cfg, err := parse([]string{"--server-url", "https://flag.example"}, "t", e, f)
	if err != nil || cfg.ServerURL != "https://flag.example" {
		t.Fatalf("flag should win: got %q err=%v", cfg.ServerURL, err)
	}
	cfg, err = parse(nil, "t", e, f) // no flag -> env
	if err != nil || cfg.ServerURL != env {
		t.Fatalf("env should win: got %q err=%v", cfg.ServerURL, err)
	}
	cfg, err = parse(nil, "t", noEnv, f) // no flag/env -> file
	if err != nil || cfg.ServerURL != file {
		t.Fatalf("file should win: got %q err=%v", cfg.ServerURL, err)
	}
}

// AC#1 — precedence verified for host-key (static default, no exec).
func TestPrecedence_HostKey(t *testing.T) {
	base := []string{"--server-url", "https://x", "--host-id", "h.example"}
	e := envMap(map[string]string{"KRL_CLIENT_HOST_KEY": "/env/key"})
	f := fileWith("host-key: /file/key\n")

	cfg, _ := parse(append(base, "--host-key", "/flag/key"), "t", e, f)
	if cfg.HostKey != "/flag/key" {
		t.Errorf("flag should win, got %q", cfg.HostKey)
	}
	cfg, _ = parse(base, "t", e, f)
	if cfg.HostKey != "/env/key" {
		t.Errorf("env should win, got %q", cfg.HostKey)
	}
	cfg, _ = parse(base, "t", noEnv, f)
	if cfg.HostKey != "/file/key" {
		t.Errorf("file should win, got %q", cfg.HostKey)
	}
	cfg, _ = parse(base, "t", noEnv, noFile)
	if cfg.HostKey != DefaultHostKey {
		t.Errorf("default should apply, got %q", cfg.HostKey)
	}
}

// AC#1 — precedence verified for host-id (flag > env > file; else derived).
func TestPrecedence_HostID(t *testing.T) {
	base := []string{"--server-url", "https://x"}
	e := envMap(map[string]string{"KRL_CLIENT_HOST_ID": "env.example"})
	f := fileWith("host-id: file.example\n")

	cfg, _ := parse(append(base, "--host-id", "flag.example"), "t", e, f)
	if cfg.HostID != "flag.example" {
		t.Errorf("flag should win, got %q", cfg.HostID)
	}
	cfg, _ = parse(base, "t", e, f)
	if cfg.HostID != "env.example" {
		t.Errorf("env should win, got %q", cfg.HostID)
	}
	cfg, _ = parse(base, "t", noEnv, f)
	if cfg.HostID != "file.example" {
		t.Errorf("file should win, got %q", cfg.HostID)
	}
	cfg, _ = parse(base, "t", noEnv, noFile)
	if cfg.HostID == "" {
		t.Error("host-id should derive when no source sets it")
	}
}

// Env values are parsed with the correct types, and multi-hyphen flag names map
// to KRL_CLIENT_ underscore keys (clock-skew -> KRL_CLIENT_CLOCK_SKEW).
func TestEnvTypedParsing(t *testing.T) {
	e := envMap(map[string]string{
		"KRL_CLIENT_SERVER_URL": "https://e",
		"KRL_CLIENT_HOST_ID":    "h.example",
		"KRL_CLIENT_RETRIES":    "7",
		"KRL_CLIENT_TIMEOUT":    "12s",
		"KRL_CLIENT_CLOCK_SKEW": "10s",
		"KRL_CLIENT_DRY_RUN":    "1",
		"KRL_CLIENT_INSECURE":   "true",
	})
	cfg, err := parse(nil, "t", e, noFile)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cfg.Retries != 7 || cfg.Timeout != 12*time.Second || cfg.ClockSkew != 10*time.Second {
		t.Errorf("typed env parse wrong: retries=%d timeout=%s skew=%s", cfg.Retries, cfg.Timeout, cfg.ClockSkew)
	}
	if !cfg.DryRun || !cfg.Insecure {
		t.Errorf("bool env parse wrong: dryRun=%v insecure=%v", cfg.DryRun, cfg.Insecure)
	}
}

func TestEnvBadValueIsUsageError(t *testing.T) {
	e := envMap(map[string]string{
		"KRL_CLIENT_SERVER_URL": "https://e",
		"KRL_CLIENT_HOST_ID":    "h.example",
		"KRL_CLIENT_RETRIES":    "not-a-number",
	})
	_, err := parse(nil, "t", e, noFile)
	wantUsageErr(t, err, "KRL_CLIENT_RETRIES")
}

func TestConfigFileValid(t *testing.T) {
	content := "" +
		"# managed by ansible\n" +
		"server-url: https://cfg.example\n" +
		"host-id: \"quoted.example\"\n" +
		"retries: 5   # inline comment\n" +
		"timeout: 45s\n" +
		"insecure: true\n" +
		"log-format: json\n" +
		"\n"
	cfg, err := parse(nil, "t", noEnv, fileWith(content))
	if err != nil {
		t.Fatalf("parse valid config file: %v", err)
	}
	if cfg.ServerURL != "https://cfg.example" || cfg.HostID != "quoted.example" {
		t.Errorf("string values wrong: url=%q host=%q", cfg.ServerURL, cfg.HostID)
	}
	if cfg.Retries != 5 || cfg.Timeout != 45*time.Second || !cfg.Insecure || cfg.LogFormat != "json" {
		t.Errorf("typed values wrong: retries=%d timeout=%s insecure=%v fmt=%s", cfg.Retries, cfg.Timeout, cfg.Insecure, cfg.LogFormat)
	}
}

func TestConfigFileRejections(t *testing.T) {
	cases := []struct {
		name, content, substr string
	}{
		{"unknown key", "server-url: x\nbogus: y\n", "unknown key"},
		{"duplicate key", "host-id: a\nhost-id: b\n", "duplicate key"},
		{"indentation", "server-url: x\n  nested: y\n", "indentation"},
		{"sequence", "- one\n- two\n", "sequences"},
		{"missing colon", "server-url x\n", "missing ':'"},
		{"unterminated quote", "host-id: \"oops\n", "unterminated"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := parse([]string{"--server-url", "https://x"}, "t", noEnv, fileWith(c.content))
			wantUsageErr(t, err, c.substr)
		})
	}
}

func TestMissingServerURLIsUsageError(t *testing.T) {
	_, err := parse([]string{"--host-id", "h.example"}, "t", noEnv, noFile)
	wantUsageErr(t, err, "--server-url is required")
}

func TestMutuallyExclusiveFlags(t *testing.T) {
	base := []string{"--server-url", "https://x", "--host-id", "h.example"}
	_, err := parse(append(base, "--quiet", "--verbose"), "t", noEnv, noFile)
	wantUsageErr(t, err, "mutually exclusive")

	_, err = parse(append(base, "--insecure", "--ca-bundle", "/tmp/ca.pem"), "t", noEnv, noFile)
	wantUsageErr(t, err, "mutually exclusive")
}

func TestInvalidLogFormat(t *testing.T) {
	_, err := parse([]string{"--server-url", "x", "--host-id", "h", "--log-format", "xml"}, "t", noEnv, noFile)
	wantUsageErr(t, err, "log-format")
}

func TestSystemdForcesJSON(t *testing.T) {
	cfg, err := parse([]string{"--server-url", "x", "--host-id", "h", "--systemd"}, "t", noEnv, noFile)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cfg.LogFormat != "json" {
		t.Errorf("--systemd should force json, got %q", cfg.LogFormat)
	}
	// An explicit conflicting format is rejected rather than silently overridden.
	_, err = parse([]string{"--server-url", "x", "--host-id", "h", "--systemd", "--log-format", "text"}, "t", noEnv, noFile)
	wantUsageErr(t, err, "systemd")
}

func TestVersionRequested(t *testing.T) {
	_, err := parse([]string{"--version"}, "1.2.3", noEnv, noFile)
	if !errors.Is(err, ErrVersionRequested) {
		t.Fatalf("expected ErrVersionRequested, got %v", err)
	}
}

func TestExplicitMissingConfigFileErrors(t *testing.T) {
	// An explicitly requested --config that does not exist is an error...
	_, err := parse([]string{"--server-url", "x", "--host-id", "h", "--config", "/nope.yaml"}, "t", noEnv, noFile)
	wantUsageErr(t, err, "read config file")

	// ...but the absent DEFAULT file is silently tolerated.
	if _, err := parse([]string{"--server-url", "x", "--host-id", "h"}, "t", noEnv, noFile); err != nil {
		t.Fatalf("missing default config file should be tolerated, got %v", err)
	}
}

func TestNegativeRetriesRejected(t *testing.T) {
	_, err := parse([]string{"--server-url", "x", "--host-id", "h", "--retries", "-1"}, "t", noEnv, noFile)
	wantUsageErr(t, err, "retries")
}
