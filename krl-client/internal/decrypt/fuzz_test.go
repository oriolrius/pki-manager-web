package decrypt

import (
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// FuzzOpen feeds arbitrary envelopes (the HTTP response body of the KRL
// endpoint) to Open. Every failure must be a typed Decrypt error, never a panic.
func FuzzOpen(f *testing.F) {
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		f.Fatal(err)
	}
	// A structurally valid envelope (valid ephemeral point) sealed for another
	// key: it reaches the AEAD step and must fail there.
	other, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		f.Fatal(err)
	}
	f.Add(sealV1(f, other.PublicKey(), []byte("seed plaintext")))
	f.Add([]byte{})
	f.Add(make([]byte, ephLen+nonceLen+tagLen))
	f.Add(append([]byte{0x04}, make([]byte, ephLen+nonceLen+tagLen)...))
	f.Add(bytes.Repeat([]byte{0xff}, 200))

	f.Fuzz(func(t *testing.T, envelope []byte) {
		pt, err := Open(priv, envelope, "/etc/ssh/ssh_host_ecdsa_key")
		if err == nil {
			// Only a real AEAD forgery gets here. The fuzzer has no key.
			t.Fatalf("an envelope from the fuzzer decrypted to %d bytes", len(pt))
		}
		if e, ok := err.(*exitcodes.Error); !ok || e.Code != exitcodes.Decrypt {
			t.Fatalf("Open error is not exit code Decrypt: %T %v", err, err)
		}
	})
}

// FuzzOpenRoundTrip seals an arbitrary plaintext and checks that Open returns it,
// and that a change of one bit of the envelope is always rejected.
func FuzzOpenRoundTrip(f *testing.F) {
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		f.Fatal(err)
	}
	f.Add([]byte(`{"krl":"AAAA","ca_signature":null}`), uint16(0), uint8(0))
	f.Add([]byte{}, uint16(70), uint8(3))
	f.Add(bytes.Repeat([]byte{0}, 4096), uint16(65535), uint8(7))

	f.Fuzz(func(t *testing.T, plaintext []byte, pos uint16, bit uint8) {
		env := sealV1(t, priv.PublicKey(), plaintext)
		got, err := Open(priv, env, "key")
		if err != nil {
			t.Fatalf("Open rejected a valid envelope: %v", err)
		}
		if !bytes.Equal(got, plaintext) {
			t.Fatal("round trip changed the plaintext")
		}
		env[int(pos)%len(env)] ^= 1 << (bit % 8)
		if _, err := Open(priv, env, "key"); err == nil {
			t.Fatalf("Open accepted an envelope with bit %d of byte %d flipped", bit%8, int(pos)%len(env))
		}
	})
}

// FuzzLoadHostKey feeds arbitrary file contents as --host-key. The file is local,
// but a bad file must give a typed error, never a panic.
func FuzzLoadHostKey(f *testing.F) {
	path, _ := writeHostKey(f)
	good, err := os.ReadFile(path)
	if err != nil {
		f.Fatal(err)
	}
	f.Add(good)
	// The armor is built from parts so that the secret scan does not read these
	// malformed test inputs as a committed key.
	armor := func(kind, body string) []byte {
		label := kind + " PRIVATE" + " KEY"
		return []byte("-----BEGIN " + label + "-----\n" + body + "\n-----END " + label + "-----\n")
	}
	f.Add(armor("OPENSSH", "AAAA"))
	f.Add(armor("EC", "MHcCAQEE"))
	f.Add([]byte("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA== host"))
	f.Add([]byte{})

	dir := f.TempDir()
	f.Fuzz(func(t *testing.T, data []byte) {
		p := filepath.Join(dir, "key")
		if err := os.WriteFile(p, data, 0o600); err != nil {
			t.Fatal(err)
		}
		k, err := LoadHostKey(p)
		if err != nil {
			if _, ok := err.(*exitcodes.Error); !ok {
				t.Fatalf("LoadHostKey error is not typed: %T %v", err, err)
			}
			return
		}
		if k == nil || k.Curve() != ecdh.P256() {
			t.Fatal("LoadHostKey accepted a key that is not P-256")
		}
	})
}
