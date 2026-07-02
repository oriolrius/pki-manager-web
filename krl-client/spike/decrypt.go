// KRLC-02a spike — HOST side (Go, mirrors the future krl-client). Decrypts an
// ECIES v1 envelope LOCALLY using the OpenSSH ecdsa host private key
// (/etc/ssh/ssh_host_ecdsa_key). No KMS, no network — proves the local-decrypt
// model of decision-015 / KRLC-02.
//
// Uses stdlib crypto/hkdf (Go 1.24+); the only external dep is x/crypto/ssh for
// the OpenSSH private-key parse.
//
// Usage: go run . <openssh_private_key_file> <envelope_file> > plaintext.bin
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/hkdf"
	"crypto/sha256"
	"fmt"
	"os"

	"golang.org/x/crypto/ssh"
)

var salt = []byte("pki-manager-krl-ecies-v1")

const (
	ephLen   = 65
	nonceLen = 12
	tagLen   = 16
)

func die(code int, format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(code)
}

func main() {
	if len(os.Args) != 3 {
		die(1, "usage: decrypt <openssh_private_key> <envelope>")
	}

	// 1. Load the OpenSSH-format ecdsa host key -> *ecdsa.PrivateKey -> ecdh.
	keyPem, err := os.ReadFile(os.Args[1])
	if err != nil {
		die(1, "read key: %v", err)
	}
	raw, err := ssh.ParseRawPrivateKey(keyPem)
	if err != nil {
		die(3, "parse openssh key: %v", err)
	}
	ecKey, ok := raw.(*ecdsa.PrivateKey)
	if !ok {
		die(3, "not an ecdsa key: %T (ECIES needs nistp256)", raw)
	}
	priv, err := ecKey.ECDH()
	if err != nil {
		die(3, "ecdsa->ecdh: %v", err)
	}

	// 2. Parse the envelope: ephemeralPub(65) || nonce(12) || ciphertext || tag(16).
	env, err := os.ReadFile(os.Args[2])
	if err != nil {
		die(1, "read envelope: %v", err)
	}
	if len(env) < ephLen+nonceLen+tagLen {
		die(3, "envelope too short: %d bytes", len(env))
	}
	ephBytes := env[:ephLen]
	nonce := env[ephLen : ephLen+nonceLen]
	ctAndTag := env[ephLen+nonceLen:]

	// 3. ECDH -> HKDF-SHA256 (stdlib) -> AES-256-GCM open (authenticated).
	ephPub, err := ecdh.P256().NewPublicKey(ephBytes)
	if err != nil {
		die(3, "ephemeral pubkey: %v", err)
	}
	shared, err := priv.ECDH(ephPub)
	if err != nil {
		die(3, "ecdh compute: %v", err)
	}
	key, err := hkdf.Key(sha256.New, shared, salt, string(ephBytes), 32)
	if err != nil {
		die(3, "hkdf: %v", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		die(3, "aes: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		die(3, "gcm: %v", err)
	}
	pt, err := gcm.Open(nil, nonce, ctAndTag, nil)
	if err != nil {
		die(4, "gcm open (authentication failed): %v", err)
	}
	fmt.Fprintf(os.Stderr, "[decrypt] shared=%dB key=%dB plaintext=%dB\n", len(shared), len(key), len(pt))
	os.Stdout.Write(pt)
}
