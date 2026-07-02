package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/oriolrius/pki-manager-krl-client/internal/config"
	"github.com/oriolrius/pki-manager-krl-client/internal/decrypt"
	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
	"github.com/oriolrius/pki-manager-krl-client/internal/logx"
	"github.com/oriolrius/pki-manager-krl-client/internal/payload"
	"github.com/oriolrius/pki-manager-krl-client/internal/state"
	"github.com/oriolrius/pki-manager-krl-client/internal/verify"
)

// goldenDir holds vectors produced by the REAL backend crypto + real ssh-keygen
// (see testdata/gen/generate-golden.mts): a backend eciesEncryptV1 ciphertext, an
// ECDSA-P256/DER CA signature, and a `ssh-keygen -k` bare KRL. Committing them
// turns this test into a cross-implementation interop guard — if the backend
// envelope, the signature scheme, or the KRL framing drifts, the Go client fails.
const goldenDir = "testdata/golden"

type goldenMeta struct {
	HostID     string `json:"host_id"`
	KRLVersion string `json:"krl_version"`
	KRLNumber  int64  `json:"krl_number"`
	ValidUntil int64  `json:"valid_until"`
	KRLSha256  string `json:"krl_sha256"`
}

func readGolden(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(goldenDir, name))
	if err != nil {
		t.Fatalf("read golden %s: %v", name, err)
	}
	return b
}

// AC#1 + AC#3 — the definitive end-to-end interop test. The fake PKI serves a
// ciphertext produced by the backend's eciesEncryptV1, wrapping a real ssh-keygen
// KRL under a real ECDSA-P256/DER CA signature. The client drives the full
// fetch -> local-decrypt -> validate -> verify -> install cycle and must land the
// exact golden KRL bytes at 0444 with the correct persisted state; real OpenSSH
// tooling must then agree the installed KRL revokes the revoked key.
func TestGoldenBackendInteropAndSshKeygenQ(t *testing.T) {
	var meta goldenMeta
	if err := json.Unmarshal(readGolden(t, "meta.json"), &meta); err != nil {
		t.Fatalf("parse meta.json: %v", err)
	}
	ciphertext := readGolden(t, "ciphertext.bin")
	goldenKRL := readGolden(t, "revoked_keys.krl")

	srv := serveKRL(t, meta.KRLVersion, ciphertext)
	defer srv.Close()

	work := t.TempDir()
	cfg := &config.Config{
		ServerURL: srv.URL,
		HostID:    meta.HostID,
		HostKey:   filepath.Join(goldenDir, "ssh_host_ecdsa_key"),
		CAPubkey:  filepath.Join(goldenDir, "ca.pub"),
		KRLFile:   filepath.Join(work, "revoked_keys"),
		StateDir:  filepath.Join(work, "state"),
		Timeout:   config.DefaultTimeout,
		Retries:   0,
		ClockSkew: config.DefaultClockSkew,
		LogFormat: "json",
	}

	var buf bytes.Buffer
	if code := run(cfg, bufLogger(&buf, logx.Options{})); code != exitcodes.OK {
		t.Fatalf("golden run exit = %d, want 0\n%s", code, buf.String())
	}

	// AC#1 — the backend ciphertext decrypted to exactly the golden KRL bytes.
	got, err := os.ReadFile(cfg.KRLFile)
	if err != nil {
		t.Fatalf("read installed KRL: %v", err)
	}
	if !bytes.Equal(got, goldenKRL) {
		t.Fatalf("installed KRL mismatch: got %d bytes, want %d", len(got), len(goldenKRL))
	}

	// AC#1 — installed with mode 0444 (world-readable, non-writable).
	info, err := os.Stat(cfg.KRLFile)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o444 {
		t.Errorf("installed mode = %#o, want 0444", perm)
	}

	// AC#1 — persisted state matches the golden metadata (version/number/sha256).
	st, err := state.Read(cfg.StateDir)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(goldenKRL)
	wantSHA := hex.EncodeToString(sum[:])
	if st.Version != meta.KRLVersion {
		t.Errorf("state version = %q, want %q", st.Version, meta.KRLVersion)
	}
	if st.Number != meta.KRLNumber {
		t.Errorf("state number = %d, want %d", st.Number, meta.KRLNumber)
	}
	if st.SHA256 != wantSHA || st.SHA256 != meta.KRLSha256 {
		t.Errorf("state sha256 = %q, want %q", st.SHA256, meta.KRLSha256)
	}

	// AC#3 — real OpenSSH tooling agrees: the revoked key is REVOKED, the other ok.
	assertSSHKeygenQ(t, cfg.KRLFile, filepath.Join(goldenDir, "revoked_id.pub"), true)
	assertSSHKeygenQ(t, cfg.KRLFile, filepath.Join(goldenDir, "valid_id.pub"), false)
}

// TestGoldenDecryptInterop proves the LOCAL-decrypt contract at the plaintext
// level: the backend-produced ECIES ciphertext, opened by the Go decrypt package
// with the host's own key, yields byte-for-byte the committed payload.json, and
// the payload's embedded fields resolve to the committed KRL + DER CA signature.
// This is the narrow, backend<->Go crypto-interop guard beneath the full pipeline.
func TestGoldenDecryptInterop(t *testing.T) {
	priv, err := decrypt.LoadHostKey(filepath.Join(goldenDir, "ssh_host_ecdsa_key"))
	if err != nil {
		t.Fatalf("load golden host key: %v", err)
	}
	ciphertext := readGolden(t, "ciphertext.bin")
	wantPlain := readGolden(t, "payload.json")

	got, err := decrypt.Open(priv, ciphertext, "golden")
	if err != nil {
		t.Fatalf("decrypt backend ciphertext: %v", err)
	}
	if !bytes.Equal(got, wantPlain) {
		t.Fatalf("decrypted plaintext != committed payload.json\n got: %s\nwant: %s", got, wantPlain)
	}

	p, err := payload.Parse(got)
	if err != nil {
		t.Fatalf("parse decrypted payload: %v", err)
	}
	if !bytes.Equal(p.KRL, readGolden(t, "revoked_keys.krl")) {
		t.Error("payload krl field does not resolve to the committed KRL")
	}
	if !bytes.Equal(p.CASig, readGolden(t, "ca_signature.der")) {
		t.Error("payload ca_signature field does not resolve to the committed DER signature")
	}
	// The DER signature is a real ECDSA-P256 signature that verifies under ca.pub.
	if err := verify.Check(filepath.Join(goldenDir, "ca.pub"), p.KRL, p.CASig, false); err != nil {
		t.Errorf("golden CA signature does not verify under ca.pub: %v", err)
	}
}

// assertSSHKeygenQ runs `ssh-keygen -Q -f <krl> <pub>` and checks the verdict via
// its documented exit status (1 = revoked, 0 = not revoked). It skips when
// ssh-keygen is unavailable so the suite still runs in minimal CI images.
func assertSSHKeygenQ(t *testing.T, krlFile, pub string, wantRevoked bool) {
	t.Helper()
	bin, err := exec.LookPath("ssh-keygen")
	if err != nil {
		t.Skip("ssh-keygen not on PATH; skipping OpenSSH byte-compat check")
	}
	runErr := exec.Command(bin, "-Q", "-f", krlFile, pub).Run()
	if ee, ok := runErr.(*exec.ExitError); ok && ee.ExitCode() != 1 {
		t.Fatalf("ssh-keygen -Q %s exited %d (want 0 or 1)", filepath.Base(pub), ee.ExitCode())
	}
	if revoked := runErr != nil; revoked != wantRevoked {
		t.Errorf("ssh-keygen -Q %s: revoked=%v, want %v", filepath.Base(pub), revoked, wantRevoked)
	}
}
