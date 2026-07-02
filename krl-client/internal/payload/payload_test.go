package payload

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
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

// testKRL wraps trailer in a minimal but structurally-valid OpenSSH KRL header
// (PROTOCOL.krl) carrying `number` as the krl_version. The client reads the
// anti-rollback number from these signed bytes, never from the JSON.
func testKRL(number int64, trailer []byte) []byte {
	b := []byte{0x53, 0x53, 0x48, 0x4b, 0x52, 0x4c, 0x0a, 0x00} // "SSHKRL\n\0"
	b = binary.BigEndian.AppendUint32(b, 1)                     // format_version
	b = binary.BigEndian.AppendUint64(b, uint64(number))        // krl_version
	b = binary.BigEndian.AppendUint64(b, 0)                     // generated_date
	b = binary.BigEndian.AppendUint64(b, 0)                     // flags
	b = binary.BigEndian.AppendUint32(b, 0)                     // reserved (empty string)
	b = binary.BigEndian.AppendUint32(b, 0)                     // comment (empty string)
	return append(b, trailer...)
}

func buildPayload(t *testing.T, krlBody []byte, hostID string, validUntil, number int64) []byte {
	t.Helper()
	krl := testKRL(number, krlBody)
	sum := sha256.Sum256(krl)
	b, err := json.Marshal(map[string]any{
		"krl":          base64.StdEncoding.EncodeToString(krl),
		"ca_signature": nil,
		"krl_version":  "sha256:" + hex.EncodeToString(sum[:]),
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
	// installed=3; an equal header number (3) is not strictly newer -> reject.
	pEq, _ := Parse(buildPayload(t, []byte("k"), "h", now.Add(time.Hour).Unix(), 3))
	if codeOf(pEq.Validate("h", pEq.Version, 3, now, 300*time.Second)) != exitcodes.Version {
		t.Fatal("expected Version (8) on anti-rollback (equal number)")
	}
	// a strictly newer header number passes.
	pNew, _ := Parse(buildPayload(t, []byte("k"), "h", now.Add(time.Hour).Unix(), 4))
	if err := pNew.Validate("h", pNew.Version, 3, now, 300*time.Second); err != nil {
		t.Fatalf("newer header number should pass: %v", err)
	}
}

// TASK-175 — anti-rollback trusts the SIGNED KRL header number, not any unsigned
// JSON field. A payload with an OLD header number but an inflated "krl_number" in
// the JSON must still be rejected as a rollback (the JSON field is ignored).
func TestAntiRollbackUsesSignedHeaderNotJSON(t *testing.T) {
	now := time.Now()
	krl := testKRL(2, []byte("k")) // the signed header says version 2
	sum := sha256.Sum256(krl)
	pt, err := json.Marshal(map[string]any{
		"krl":          base64.StdEncoding.EncodeToString(krl),
		"ca_signature": nil,
		"krl_version":  "sha256:" + hex.EncodeToString(sum[:]),
		"krl_number":   9999, // attacker-inflated UNSIGNED field — must be ignored
		"valid_until":  now.Add(time.Hour).Unix(),
		"host_id":      "h",
	})
	if err != nil {
		t.Fatal(err)
	}
	p, err := Parse(pt)
	if err != nil {
		t.Fatal(err)
	}
	if p.Number != 2 {
		t.Fatalf("number must come from the signed header (2), got %d", p.Number)
	}
	// installed=5; header number 2 is older -> reject despite JSON krl_number=9999.
	if codeOf(p.Validate("h", p.Version, 5, now, 300*time.Second)) != exitcodes.Version {
		t.Fatal("expected anti-rollback rejection using the signed header number")
	}
}

// A payload whose `krl` is not a well-formed OpenSSH KRL is rejected at Parse —
// exercising all three header guards (too-short, bad magic, unsupported version)
// so a weakened guard can never silently read the anti-rollback number from a
// non-KRL blob.
func TestParseRejectsNonKRL(t *testing.T) {
	badMagic := make([]byte, 24) // >= 20 bytes, but the first 8 aren't the magic

	badVersion := []byte{0x53, 0x53, 0x48, 0x4b, 0x52, 0x4c, 0x0a, 0x00} // "SSHKRL\n\0"
	badVersion = binary.BigEndian.AppendUint32(badVersion, 2)            // format_version=2 (unsupported)
	badVersion = append(badVersion, make([]byte, 8)...)                  // pad through the number field (len 20)

	overflow := []byte{0x53, 0x53, 0x48, 0x4b, 0x52, 0x4c, 0x0a, 0x00} // "SSHKRL\n\0"
	overflow = binary.BigEndian.AppendUint32(overflow, 1)              // format_version=1
	overflow = binary.BigEndian.AppendUint64(overflow, 1<<63)          // krl_version > math.MaxInt64

	cases := map[string][]byte{
		"too_short":           []byte("not-a-krl"), // < 20 bytes
		"bad_magic":           badMagic,
		"unsupported_version": badVersion,
		"overflow_number":     overflow,
	}
	for name, krl := range cases {
		t.Run(name, func(t *testing.T) {
			b, _ := json.Marshal(map[string]any{
				"krl":         base64.StdEncoding.EncodeToString(krl),
				"krl_version": "sha256:00",
				"host_id":     "h",
			})
			if _, err := Parse(b); codeOf(err) != exitcodes.Version {
				t.Fatalf("expected Version (8) for %s, got %v", name, err)
			}
		})
	}
}

func TestParseRejectsGarbage(t *testing.T) {
	if _, err := Parse([]byte("not-json")); codeOf(err) != exitcodes.Decrypt {
		t.Fatalf("expected Decrypt (3) on non-JSON plaintext, got %v", err)
	}
}
