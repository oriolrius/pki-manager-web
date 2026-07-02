package payload

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

func codeOf(err error) exitcodes.Code {
	if e, ok := err.(*exitcodes.Error); ok {
		return e.Code
	}
	return -1
}

func buildPayload(t *testing.T, krl []byte, hostID string, validUntil, number int64) []byte {
	t.Helper()
	sum := sha256.Sum256(krl)
	b, err := json.Marshal(map[string]any{
		"krl":          base64.StdEncoding.EncodeToString(krl),
		"ca_signature": nil,
		"krl_version":  "sha256:" + hex.EncodeToString(sum[:]),
		"krl_number":   number,
		"valid_until":  validUntil,
		"host_id":      hostID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestValidateHappyPath(t *testing.T) {
	now := time.Now()
	p, err := Parse(buildPayload(t, []byte("krl-bytes"), "h.example.com", now.Add(30*time.Minute).Unix(), 5))
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Validate("h.example.com", p.Version, 4, now, 300*time.Second); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
}

func TestHostMismatch(t *testing.T) {
	now := time.Now()
	p, _ := Parse(buildPayload(t, []byte("k"), "other.example.com", now.Add(time.Hour).Unix(), 1))
	if codeOf(p.Validate("me.example.com", p.Version, 0, now, 0)) != exitcodes.HostMismatch {
		t.Fatal("expected HostMismatch (6)")
	}
}

func TestExpiredBeyondSkew(t *testing.T) {
	now := time.Now()
	p, _ := Parse(buildPayload(t, []byte("k"), "h", now.Add(-time.Hour).Unix(), 1))
	if codeOf(p.Validate("h", p.Version, 0, now, 300*time.Second)) != exitcodes.Expired {
		t.Fatal("expected Expired (5)")
	}
}

func TestValidUntilSecondsSemantics(t *testing.T) {
	now := time.Now()
	// A seconds value now+1800 validates.
	pOk, _ := Parse(buildPayload(t, []byte("k"), "h", now.Add(1800*time.Second).Unix(), 1))
	if err := pOk.Validate("h", pOk.Version, 0, now, 300*time.Second); err != nil {
		t.Fatalf("now+1800s should validate: %v", err)
	}
	// A seconds value 2h in the past is expired (proves we treat it as seconds, not ms).
	pOld, _ := Parse(buildPayload(t, []byte("k"), "h", now.Add(-2*time.Hour).Unix(), 1))
	if codeOf(pOld.Validate("h", pOld.Version, 0, now, 300*time.Second)) != exitcodes.Expired {
		t.Fatal("a 2h-past seconds value must be expired")
	}
}

func TestVersionHeaderMismatch(t *testing.T) {
	now := time.Now()
	p, _ := Parse(buildPayload(t, []byte("k"), "h", now.Add(time.Hour).Unix(), 1))
	if codeOf(p.Validate("h", "sha256:deadbeef", 0, now, 300*time.Second)) != exitcodes.Version {
		t.Fatal("expected Version (8) on X-KRL-Version mismatch")
	}
}

func TestVersionSha256Mismatch(t *testing.T) {
	now := time.Now()
	p, _ := Parse(buildPayload(t, []byte("k"), "h", now.Add(time.Hour).Unix(), 1))
	p.KRL = []byte("tampered") // krl bytes no longer hash to Version
	if codeOf(p.Validate("h", p.Version, 0, now, 300*time.Second)) != exitcodes.Version {
		t.Fatal("expected Version (8) on sha256(krl) mismatch")
	}
}

func TestAntiRollback(t *testing.T) {
	now := time.Now()
	// installed=3; an equal krl_number (3) is not strictly newer -> reject.
	pEq, _ := Parse(buildPayload(t, []byte("k"), "h", now.Add(time.Hour).Unix(), 3))
	if codeOf(pEq.Validate("h", pEq.Version, 3, now, 300*time.Second)) != exitcodes.Version {
		t.Fatal("expected Version (8) on anti-rollback (equal number)")
	}
	// a strictly newer number passes.
	pNew, _ := Parse(buildPayload(t, []byte("k"), "h", now.Add(time.Hour).Unix(), 4))
	if err := pNew.Validate("h", pNew.Version, 3, now, 300*time.Second); err != nil {
		t.Fatalf("newer krl_number should pass: %v", err)
	}
}

func TestParseRejectsGarbage(t *testing.T) {
	if _, err := Parse([]byte("not-json")); codeOf(err) != exitcodes.Decrypt {
		t.Fatalf("expected Decrypt (3) on non-JSON plaintext, got %v", err)
	}
}
