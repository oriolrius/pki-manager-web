package decrypt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// assertDecryptCode requires a non-nil error carrying exit code Decrypt (3).
func assertDecryptCode(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	if e, ok := err.(*exitcodes.Error); !ok || e.Code != exitcodes.Decrypt {
		t.Fatalf("expected exit code Decrypt(3), got %v", err)
	}
}

// writeHostKey generates an ecdsa nistp256 key, writes it in OpenSSH private-key
// format (like /etc/ssh/ssh_host_ecdsa_key), and returns the path + ecdh key.
func writeHostKey(t *testing.T) (string, *ecdh.PrivateKey) {
	t.Helper()
	ec, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	blk, err := ssh.MarshalPrivateKey(ec, "test")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "ssh_host_ecdsa_key")
	if err := os.WriteFile(path, pem.EncodeToMemory(blk), 0o600); err != nil {
		t.Fatal(err)
	}
	k, err := ec.ECDH()
	if err != nil {
		t.Fatal(err)
	}
	return path, k
}

// sealV1 mirrors the backend eciesEncryptV1 (test-only sender) so this package's
// round-trip is self-contained; cross-impl parity with node is proven in KRLC-02a.
func sealV1(t *testing.T, recipient *ecdh.PublicKey, pt []byte) []byte {
	t.Helper()
	eph, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ephPub := eph.PublicKey().Bytes() // 65B uncompressed
	shared, err := eph.ECDH(recipient)
	if err != nil {
		t.Fatal(err)
	}
	key, err := hkdf.Key(sha256.New, shared, salt, string(ephPub), 32)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	nonce := make([]byte, nonceLen)
	if _, err := rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	ct := gcm.Seal(nil, nonce, pt, nil)
	out := append([]byte{}, ephPub...)
	out = append(out, nonce...)
	out = append(out, ct...)
	return out
}

func TestLoadHostKeyAndOpenRoundTrip(t *testing.T) {
	path, k := writeHostKey(t)
	priv, err := LoadHostKey(path)
	if err != nil {
		t.Fatalf("LoadHostKey: %v", err)
	}
	pt := []byte(`{"krl":"AAAA","ca_signature":null,"krl_version":"sha256:x","valid_until":9999999999,"host_id":"h.example.com"}`)
	env := sealV1(t, k.PublicKey(), pt)
	if len(env) != ephLen+nonceLen+len(pt)+tagLen {
		t.Fatalf("envelope length %d, want %d", len(env), ephLen+nonceLen+len(pt)+tagLen)
	}
	got, err := Open(priv, env, path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if string(got) != string(pt) {
		t.Fatalf("plaintext mismatch: %q", got)
	}
}

func TestOpenRejectsTamper(t *testing.T) {
	path, k := writeHostKey(t)
	priv, _ := LoadHostKey(path)
	env := sealV1(t, k.PublicKey(), []byte("secret-krl"))
	env[len(env)-1] ^= 0x01 // flip a tag bit
	_, err := Open(priv, env, path)
	assertDecryptCode(t, err)
}

func TestOpenRejectsWrongKey(t *testing.T) {
	_, kA := writeHostKey(t)
	pathB, _ := writeHostKey(t)
	privB, _ := LoadHostKey(pathB)
	env := sealV1(t, kA.PublicKey(), []byte("x"))
	_, err := Open(privB, env, pathB)
	assertDecryptCode(t, err)

	// AC#2 — a wrong-key AEAD failure must be actionable, not cryptic: it names
	// the offending key path and the exact onboarding fix (register <path>.pub).
	msg := err.Error()
	for _, want := range []string{pathB, pathB + ".pub", "register", "pki-manager"} {
		if !strings.Contains(msg, want) {
			t.Errorf("AEAD-failure message missing %q; got: %s", want, msg)
		}
	}
}

func TestOpenRejectsShortEnvelope(t *testing.T) {
	path, _ := writeHostKey(t)
	priv, _ := LoadHostKey(path)
	_, err := Open(priv, []byte("too short"), path)
	assertDecryptCode(t, err)
}

func TestLoadHostKeyRejectsEd25519(t *testing.T) {
	_, edPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	blk, err := ssh.MarshalPrivateKey(edPriv, "ed")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "ssh_host_ed25519_key")
	if err := os.WriteFile(path, pem.EncodeToMemory(blk), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = LoadHostKey(path)
	assertDecryptCode(t, err)

	// AC#2 — an ed25519 host key must yield an actionable fix, not just "wrong type".
	msg := err.Error()
	for _, want := range []string{path + ".pub", "register", "keygen"} {
		if !strings.Contains(msg, want) {
			t.Errorf("ed25519 message missing %q; got: %s", want, msg)
		}
	}
}

// AC#2 — an ed25519-only host has no /etc/ssh/ssh_host_ecdsa_key at all: the
// missing-file error must name the exact onboarding step (generate an ecdsa key
// and register its .pub, or use `krl-client keygen`) instead of a bare ENOENT.
func TestLoadHostKeyMissingFileIsActionable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ssh_host_ecdsa_key") // never created
	_, err := LoadHostKey(path)
	if err == nil {
		t.Fatal("expected an error for a missing host key")
	}
	e, ok := err.(*exitcodes.Error)
	if !ok || e.Code != exitcodes.Usage {
		t.Fatalf("expected exit code Usage(1), got %v", err)
	}
	msg := err.Error()
	for _, want := range []string{path, path + ".pub", "ed25519", "keygen", "register"} {
		if !strings.Contains(msg, want) {
			t.Errorf("missing-file message missing %q; got: %s", want, msg)
		}
	}
}
