package verify

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

func codeOf(err error) exitcodes.Code {
	if e, ok := err.(*exitcodes.Error); ok {
		return e.Code
	}
	return -1
}

func writeOpenSSHPub(t *testing.T, pub crypto.PublicKey) string {
	t.Helper()
	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "ca.pub")
	if err := os.WriteFile(path, ssh.MarshalAuthorizedKey(sshPub), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func ecdsaSign(t *testing.T, priv *ecdsa.PrivateKey, krl []byte) []byte {
	t.Helper()
	sum := sha256.Sum256(krl)
	sig, err := ecdsa.SignASN1(rand.Reader, priv, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return sig
}

func TestVerifyEcdsaOpenSSHCAKey(t *testing.T) {
	priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	krl := []byte("bare-krl-bytes")
	sig := ecdsaSign(t, priv, krl)
	path := writeOpenSSHPub(t, &priv.PublicKey)

	if err := Check(path, krl, sig, false); err != nil {
		t.Fatalf("expected verify ok: %v", err)
	}
	if codeOf(Check(path, []byte("tampered"), sig, false)) != exitcodes.Verify {
		t.Fatal("expected Verify(4) on tampered KRL")
	}
}

func TestVerifyPEMSPKIEquivalent(t *testing.T) {
	priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	krl := []byte("krl")
	sig := ecdsaSign(t, priv, krl)
	der, _ := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	path := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Check(path, krl, sig, false); err != nil {
		t.Fatalf("PEM/SPKI form should verify identically: %v", err)
	}
}

func TestNullSignaturePolicy(t *testing.T) {
	priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	path := writeOpenSSHPub(t, &priv.PublicKey)
	if codeOf(Check(path, []byte("k"), nil, false)) != exitcodes.Verify {
		t.Fatal("expected Verify(4) for null signature without --allow-unsigned")
	}
	if err := Check(path, []byte("k"), nil, true); err != nil {
		t.Fatalf("null sig with --allow-unsigned should pass: %v", err)
	}
}

func TestVerifyMultipleCAKeysRotation(t *testing.T) {
	old, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	cur, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	krl := []byte("krl")
	sig := ecdsaSign(t, cur, krl) // signed by the CURRENT key

	oldPub, _ := ssh.NewPublicKey(&old.PublicKey)
	curPub, _ := ssh.NewPublicKey(&cur.PublicKey)
	path := filepath.Join(t.TempDir(), "trusted.pub")
	data := append(ssh.MarshalAuthorizedKey(oldPub), ssh.MarshalAuthorizedKey(curPub)...)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Check(path, krl, sig, false); err != nil {
		t.Fatalf("should verify against one of multiple CA keys: %v", err)
	}
}

func TestVerifyEd25519CAKey(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	krl := []byte("krl-bytes")
	sig := ed25519.Sign(priv, krl)
	path := writeOpenSSHPub(t, pub)

	if err := Check(path, krl, sig, false); err != nil {
		t.Fatalf("ed25519 CA verify failed: %v", err)
	}
	if codeOf(Check(path, []byte("other"), sig, false)) != exitcodes.Verify {
		t.Fatal("expected Verify(4) on wrong message")
	}
}

// TestHostCaTrustAnchorReconciliation (BLK-10, decision-016 pinned req #1):
// the composed per-host KRL is signed with the HOST-CA key and the shipped
// default --ca-pubkey is the Host-CA trust anchor (/etc/ssh/ssh-host-ca.pub,
// served by GET /ssh/host-ca-keys). A Host-CA-signed KRL must verify against
// that anchor — and must NOT verify against the User-CA file that was the
// pre-BLK-10 default (the exact misconfiguration that made blocks silently
// never land).
func TestHostCaTrustAnchorReconciliation(t *testing.T) {
	hostCA, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	userCA, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	krl := []byte("composed-per-host-krl-bytes")
	sig := ecdsaSign(t, hostCA, krl) // ECDSA-P256 / SHA-256 / DER — the backend signRaw scheme

	hostAnchor := writeOpenSSHPub(t, &hostCA.PublicKey) // what /ssh/host-ca-keys serves
	userAnchor := writeOpenSSHPub(t, &userCA.PublicKey) // TrustedUserCAKeys — the WRONG anchor

	if err := Check(hostAnchor, krl, sig, false); err != nil {
		t.Fatalf("Host-CA-signed KRL must verify against the Host-CA trust anchor: %v", err)
	}
	if codeOf(Check(userAnchor, krl, sig, false)) != exitcodes.Verify {
		t.Fatal("Host-CA-signed KRL must FAIL verification against the User-CA anchor (exit 4)")
	}
}
