package verify

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// FuzzLoadCAKeys feeds arbitrary --ca-pubkey file contents. A file with no usable
// key must give a Usage error; an accepted file must give at least one key.
func FuzzLoadCAKeys(f *testing.F) {
	ec, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		f.Fatal(err)
	}
	sshPub, err := ssh.NewPublicKey(&ec.PublicKey)
	if err != nil {
		f.Fatal(err)
	}
	line := ssh.MarshalAuthorizedKey(sshPub)
	f.Add(line)
	f.Add(append(append([]byte("# comment\n"), line...), line...))
	f.Add([]byte("ecdsa-sha2-nistp256 AAAA\n"))
	f.Add([]byte("-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----\n"))
	f.Add([]byte{})

	dir := f.TempDir()
	f.Fuzz(func(t *testing.T, data []byte) {
		p := filepath.Join(dir, "ca.pub")
		if err := os.WriteFile(p, data, 0o600); err != nil {
			t.Fatal(err)
		}
		keys, err := LoadCAKeys(p)
		if err != nil {
			if e, ok := err.(*exitcodes.Error); !ok || e.Code != exitcodes.Usage {
				t.Fatalf("LoadCAKeys error is not exit code Usage: %T %v", err, err)
			}
			return
		}
		if len(keys) == 0 {
			t.Fatal("LoadCAKeys accepted a file with no key")
		}
		for _, k := range keys {
			if k == nil {
				t.Fatal("LoadCAKeys returned a nil key")
			}
		}
		// The keys it returns must be safe to use: Verify must not panic on them.
		_ = Verify([]byte("krl"), []byte("sig"), keys)
	})
}

// FuzzVerify feeds an arbitrary KRL and signature (both come from the server).
// The fuzzer has no CA key, so nothing it makes may verify.
func FuzzVerify(f *testing.F) {
	ec, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		f.Fatal(err)
	}
	edPub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		f.Fatal(err)
	}
	keys := []crypto.PublicKey{&ec.PublicKey, edPub}
	f.Add([]byte("krl"), []byte{})
	f.Add([]byte("krl"), []byte{0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01})
	f.Add([]byte{}, make([]byte, ed25519.SignatureSize))
	f.Add([]byte("krl"), []byte{0x30, 0x80, 0x02, 0x01, 0x00})

	f.Fuzz(func(t *testing.T, krl, sig []byte) {
		if Verify(krl, sig, keys) {
			t.Fatalf("a signature from the fuzzer verified: krl=%x sig=%x", krl, sig)
		}
	})
}
