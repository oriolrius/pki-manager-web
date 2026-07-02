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
	got, err := Open(priv, env)
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
	_, err := Open(priv, env)
	assertDecryptCode(t, err)
}

func TestOpenRejectsWrongKey(t *testing.T) {
	_, kA := writeHostKey(t)
	pathB, _ := writeHostKey(t)
	privB, _ := LoadHostKey(pathB)
	env := sealV1(t, kA.PublicKey(), []byte("x"))
	_, err := Open(privB, env)
	assertDecryptCode(t, err)
}

func TestOpenRejectsShortEnvelope(t *testing.T) {
	path, _ := writeHostKey(t)
	priv, _ := LoadHostKey(path)
	_, err := Open(priv, []byte("too short"))
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
}
