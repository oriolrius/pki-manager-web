// Package verify checks the detached CA signature over the bare KRL (KRLC-06).
// The signing key is loaded from --ca-pubkey, whose default is the HOST CA
// trust anchor pki-manager deploys at /etc/ssh/ssh-host-ca.pub (BLK-10:
// composed per-host KRLs are signed with the Host-CA key, decision-016 pinned
// req #1). The file may hold several CA keys (rotation) — any one that
// verifies is accepted.
//
// ecdsa CA keys: ECDSA-P256 DER signature over sha256(krl) (the pinned scheme).
// ed25519 CA keys: ed25519 over the raw krl bytes. Verification precedes install.
package verify

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/pem"
	"os"

	"golang.org/x/crypto/ssh"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// LoadCAKeys reads --ca-pubkey. It accepts one or more OpenSSH authorized-keys
// lines (ecdsa-sha2-nistp256 / ssh-ed25519), or a single PEM/SPKI public key.
func LoadCAKeys(path string) ([]crypto.PublicKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Usage, "read ca-pubkey %q: %v", path, err)
	}
	var keys []crypto.PublicKey

	rest := data
	for len(rest) > 0 {
		pk, _, _, r, perr := ssh.ParseAuthorizedKey(rest)
		if perr != nil {
			break
		}
		rest = r
		if cpk, ok := pk.(ssh.CryptoPublicKey); ok {
			keys = append(keys, cpk.CryptoPublicKey())
		}
	}

	if len(keys) == 0 {
		if blk, _ := pem.Decode(data); blk != nil {
			if pub, perr := x509.ParsePKIXPublicKey(blk.Bytes); perr == nil {
				keys = append(keys, pub)
			}
		}
	}
	if len(keys) == 0 {
		return nil, exitcodes.New(exitcodes.Usage, "no usable CA public key found in %q", path)
	}
	return keys, nil
}

// verifyOne reports whether the signature verifies under a single key.
func verifyOne(key crypto.PublicKey, krl, sig []byte) bool {
	switch pub := key.(type) {
	case *ecdsa.PublicKey:
		sum := sha256.Sum256(krl)
		return ecdsa.VerifyASN1(pub, sum[:], sig)
	case ed25519.PublicKey:
		return ed25519.Verify(pub, krl, sig)
	default:
		return false
	}
}

// Verify reports whether sig verifies under any of the given keys.
func Verify(krl, sig []byte, keys []crypto.PublicKey) bool {
	for _, k := range keys {
		if verifyOne(k, krl, sig) {
			return true
		}
	}
	return false
}

// Check applies the signature policy before install: a null signature installs
// only under allowUnsigned; a present signature must verify against --ca-pubkey.
func Check(caPubkeyPath string, krl, sig []byte, allowUnsigned bool) error {
	if sig == nil {
		if allowUnsigned {
			return nil
		}
		return exitcodes.New(exitcodes.Verify, "payload ca_signature is null and --allow-unsigned is not set")
	}
	keys, err := LoadCAKeys(caPubkeyPath)
	if err != nil {
		return err
	}
	if !Verify(krl, sig, keys) {
		return exitcodes.New(exitcodes.Verify, "CA signature does not verify against any key in %q", caPubkeyPath)
	}
	return nil
}
