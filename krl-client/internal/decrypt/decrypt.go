// Package decrypt performs the LOCAL ECIES v1 decryption (KRLC-04): it loads the
// host's own OpenSSH ecdsa host key and opens the envelope entirely in-process —
// no KMS, no network. The envelope + KDF are the contract pinned by the KRLC-02a
// spike (krl-client/spike/README.md) and produced by the backend's eciesEncryptV1.
package decrypt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/hkdf"
	"crypto/sha256"
	"errors"
	"os"

	"golang.org/x/crypto/ssh"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// salt must match the backend + spike verbatim.
var salt = []byte("pki-manager-krl-ecies-v1")

const (
	ephLen   = 65 // SEC1 uncompressed P-256 point
	nonceLen = 12 // AES-GCM IV
	tagLen   = 16 // AES-GCM tag
)

// LoadHostKey parses an OpenSSH ecdsa-sha2-nistp256 private key file (e.g.
// /etc/ssh/ssh_host_ecdsa_key) into an ECDH private key. A missing file or an
// ed25519/RSA host key (the "ed25519-only host" case) yields an ACTIONABLE
// onboarding error naming the exact fix, not a cryptic parse/decrypt failure.
func LoadHostKey(path string) (*ecdh.PrivateKey, error) {
	pem, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, exitcodes.New(exitcodes.Usage,
				"no ecdsa-sha2-nistp256 host key at %q — this host may have only an ed25519 host key. "+
					"Generate an ecdsa host key (`ssh-keygen -q -N '' -t ecdsa -b 256 -f %s`) and register %s.pub with pki-manager, "+
					"or create a dedicated ECIES key with `krl-client keygen` and point --host-key at it",
				path, path, path)
		}
		return nil, exitcodes.New(exitcodes.Usage, "read host key %q: %v", path, err)
	}
	raw, err := ssh.ParseRawPrivateKey(pem)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt, "parse host key %q: %v", path, err)
	}
	ec, ok := raw.(*ecdsa.PrivateKey)
	if !ok {
		return nil, exitcodes.New(exitcodes.Decrypt,
			"host key %q is %T, but ECIES needs an ecdsa-sha2-nistp256 key — register this host's ecdsa host key (%s.pub) "+
				"with pki-manager, or use `krl-client keygen` for a dedicated ECIES key",
			path, raw, path)
	}
	k, err := ec.ECDH()
	if err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt, "host key is not a usable P-256 key: %v", err)
	}
	return k, nil
}

// Open decrypts an ECIES v1 envelope with the host's private key. Any failure
// (short envelope, bad ephemeral point, AEAD authentication) maps to exit 3.
// keyPath is used only to make an AEAD-authentication failure actionable (it
// almost always means the public key registered with pki-manager is not the one
// that matches this private key).
func Open(priv *ecdh.PrivateKey, envelope []byte, keyPath string) ([]byte, error) {
	if len(envelope) < ephLen+nonceLen+tagLen {
		return nil, exitcodes.New(exitcodes.Decrypt, "envelope too short: %d bytes", len(envelope))
	}
	ephBytes := envelope[:ephLen]
	nonce := envelope[ephLen : ephLen+nonceLen]
	ctAndTag := envelope[ephLen+nonceLen:]

	ephPub, err := ecdh.P256().NewPublicKey(ephBytes)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt, "ephemeral public key: %v", err)
	}
	shared, err := priv.ECDH(ephPub)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt, "ecdh: %v", err)
	}
	key, err := hkdf.Key(sha256.New, shared, salt, string(ephBytes), 32)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt, "hkdf: %v", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt, "aes: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt, "gcm: %v", err)
	}
	pt, err := gcm.Open(nil, nonce, ctAndTag, nil)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt,
			"KRL decryption failed (AEAD authentication) — the payload was encrypted to a public key that does not match %q; "+
				"ensure the public key registered with pki-manager is this host's (register %s.pub): %v",
			keyPath, keyPath, err)
	}
	return pt, nil
}
