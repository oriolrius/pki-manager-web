package keygen

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"

	"github.com/oriolrius/pki-manager-krl-client/internal/decrypt"
	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// eciesSalt must match decrypt.salt / the backend eciesEncryptV1 verbatim.
var eciesSalt = []byte("pki-manager-krl-ecies-v1")

func stubHost(string) func() (string, error) {
	return func() (string, error) { return "host.example.com", nil }
}

// sealV1 mirrors the backend eciesEncryptV1 sender (see decrypt_test.sealV1) so
// the round-trip through the GENERATED keypair is self-contained.
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
	return append(append(append([]byte{}, ephPub...), nonce...), ct...)
}

// ecdhPubFromFile parses an OpenSSH public-key line and returns its P-256 ECDH
// public key — exactly what pki-manager does before eciesEncryptV1.
func ecdhPubFromFile(t *testing.T, pubPath string) *ecdh.PublicKey {
	t.Helper()
	raw, err := os.ReadFile(pubPath)
	if err != nil {
		t.Fatal(err)
	}
	pub, _, _, _, err := ssh.ParseAuthorizedKey(raw)
	if err != nil {
		t.Fatalf("parse %s: %v", pubPath, err)
	}
	if pub.Type() != "ecdsa-sha2-nistp256" {
		t.Fatalf("public key type = %q, want ecdsa-sha2-nistp256", pub.Type())
	}
	ecPub, ok := pub.(ssh.CryptoPublicKey).CryptoPublicKey().(*ecdsa.PublicKey)
	if !ok {
		t.Fatalf("public key is not ecdsa")
	}
	k, err := ecPub.ECDH()
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// AC#3 — `krl-client keygen` produces a usable DEDICATED ECIES keypair: a 0600
// private key, a .pub to register, and (proving the whole point) a payload
// encrypted to that .pub decrypts locally with the generated private key.
func TestKeygenEndToEnd(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "sub", "ecies_key") // nested dir must be created
	pub := out + ".pub"

	var stdout bytes.Buffer
	if code, err := generate([]string{"--out", out}, &stdout, stubHost("")); code != exitcodes.OK || err != nil {
		t.Fatalf("keygen failed: code=%d err=%v", code, err)
	}

	// Private key is 0600; public key exists.
	fi, err := os.Stat(out)
	if err != nil {
		t.Fatalf("private key not written: %v", err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Errorf("private key perm = %o, want 0600", fi.Mode().Perm())
	}
	if _, err := os.Stat(pub); err != nil {
		t.Fatalf("public key not written: %v", err)
	}

	// The default comment derives from the (stubbed) hostname and appears in the
	// printed pubkey + the on-disk .pub.
	pubBytes, _ := os.ReadFile(pub)
	if !strings.Contains(string(pubBytes), "krl-client-ecies@host.example.com") {
		t.Errorf(".pub missing default comment; got: %s", pubBytes)
	}
	for _, want := range []string{out, pub, "Register this PUBLIC key", "--host-key " + out} {
		if !strings.Contains(stdout.String(), want) {
			t.Errorf("stdout missing %q; got:\n%s", want, stdout.String())
		}
	}

	// End-to-end: encrypt to the .pub (as pki-manager would) and decrypt with the
	// generated private key via the real client crypto path.
	recipient := ecdhPubFromFile(t, pub)
	priv, err := decrypt.LoadHostKey(out)
	if err != nil {
		t.Fatalf("LoadHostKey(generated): %v", err)
	}
	payload := []byte(`{"krl":"AAAA","host_id":"host.example.com"}`)
	pt, err := decrypt.Open(priv, sealV1(t, recipient, payload), out)
	if err != nil {
		t.Fatalf("Open(generated): %v", err)
	}
	if !bytes.Equal(pt, payload) {
		t.Fatalf("round-trip mismatch: %q", pt)
	}
}

// AC#3 — keygen never silently clobbers a key: a second run without --force is a
// usage error and leaves the original untouched; --force rotates it.
func TestKeygenRefusesOverwriteUnlessForced(t *testing.T) {
	out := filepath.Join(t.TempDir(), "ecies_key")

	var b bytes.Buffer
	if code, _ := generate([]string{"--out", out}, &b, stubHost("")); code != exitcodes.OK {
		t.Fatalf("first keygen exit = %d", code)
	}
	first, _ := os.ReadFile(out)

	code, err := generate([]string{"--out", out}, &b, stubHost(""))
	if code != exitcodes.Usage || err == nil {
		t.Fatalf("second keygen: code=%d err=%v, want Usage error", code, err)
	}
	if !strings.Contains(err.Error(), "--force") {
		t.Errorf("overwrite error should mention --force; got: %v", err)
	}
	if again, _ := os.ReadFile(out); !bytes.Equal(first, again) {
		t.Error("refused keygen must leave the original key untouched")
	}

	if code, err := generate([]string{"--out", out, "--force"}, &b, stubHost("")); code != exitcodes.OK || err != nil {
		t.Fatalf("--force keygen: code=%d err=%v", code, err)
	}
	if forced, _ := os.ReadFile(out); bytes.Equal(first, forced) {
		t.Error("--force must generate a new key")
	}
	if fi, _ := os.Stat(out); fi.Mode().Perm() != 0o600 {
		t.Errorf("--force private key perm = %o, want 0600", fi.Mode().Perm())
	}
}

// A custom --comment overrides the hostname default; a stray positional arg is
// rejected instead of silently ignored.
func TestKeygenCommentAndStrayArg(t *testing.T) {
	out := filepath.Join(t.TempDir(), "ecies_key")
	var b bytes.Buffer
	if code, err := generate([]string{"--out", out, "--comment", "custom-tag"}, &b, stubHost("")); code != exitcodes.OK || err != nil {
		t.Fatalf("keygen --comment: code=%d err=%v", code, err)
	}
	pubBytes, _ := os.ReadFile(out + ".pub")
	if !strings.HasSuffix(strings.TrimSpace(string(pubBytes)), " custom-tag") {
		t.Errorf(".pub should end with the custom comment; got: %s", pubBytes)
	}

	if code, err := generate([]string{"stray"}, &b, stubHost("")); code != exitcodes.Usage || err == nil {
		t.Fatalf("stray arg: code=%d err=%v, want Usage error", code, err)
	}
}
