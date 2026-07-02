// Package payload parses and validates the decrypted KRL envelope (KRLC-05):
// host-id binding, valid_until freshness, krl_version integrity (== X-KRL-Version
// AND == sha256 of the bare KRL), and monotonic anti-rollback.
//
// Anti-rollback compares the KRL's monotonic version number taken from the OpenSSH
// KRL HEADER inside the bare `krl` bytes (PROTOCOL.krl: magic | uint32
// format_version | uint64 krl_version | ...). Because that number lives in the
// signed bytes it is covered by the detached CA signature over sha256(krl): a
// replayed old-but-signed KRL carries its own low header number and cannot be
// forged to look newer. The previously-trusted UNSIGNED JSON `krl_number` field is
// no longer read (TASK-175 — it let a compromised server defeat anti-rollback).
package payload

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"math"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// OpenSSH KRL header framing (PROTOCOL.krl), enough to read the version number:
//
//	magic[8] "SSHKRL\n\0" | uint32 format_version | uint64 krl_version | ...
var krlMagic = []byte{0x53, 0x53, 0x48, 0x4b, 0x52, 0x4c, 0x0a, 0x00} // "SSHKRL\n\0"

const (
	krlFormatVersion = 1
	krlHeaderMinLen  = 8 + 4 + 8 // magic + format_version + krl_version
)

type wire struct {
	KRL        string  `json:"krl"`
	CASig      *string `json:"ca_signature"`
	KRLVersion string  `json:"krl_version"`
	ValidUntil int64   `json:"valid_until"`
	HostID     string  `json:"host_id"`
}

// Parsed is the decoded payload (base64 fields resolved to bytes).
type Parsed struct {
	KRL        []byte // bare OpenSSH KRL bytes
	CASig      []byte // detached CA signature, or nil when ca_signature was null
	Version    string // krl_version token ("sha256:<hex>")
	Number     int64  // monotonic version number read from the signed KRL header
	ValidUntil int64  // unix seconds
	HostID     string
}

// Parse decodes the JSON and base64 fields and extracts the KRL header's version
// number. A garbled plaintext (wrong key / corruption) maps to Decrypt; a decoded
// but malformed KRL maps to Version.
func Parse(plaintext []byte) (*Parsed, error) {
	var w wire
	if err := json.Unmarshal(plaintext, &w); err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt, "payload is not valid JSON: %v", err)
	}
	krl, err := base64.StdEncoding.DecodeString(w.KRL)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Version, "krl is not valid base64: %v", err)
	}
	number, err := krlHeaderNumber(krl)
	if err != nil {
		return nil, err
	}
	var sig []byte
	if w.CASig != nil && *w.CASig != "" {
		sig, err = base64.StdEncoding.DecodeString(*w.CASig)
		if err != nil {
			return nil, exitcodes.New(exitcodes.Verify, "ca_signature is not valid base64: %v", err)
		}
	}
	return &Parsed{KRL: krl, CASig: sig, Version: w.KRLVersion, Number: number, ValidUntil: w.ValidUntil, HostID: w.HostID}, nil
}

// krlHeaderNumber reads the monotonic krl_version (uint64, big-endian) from the
// OpenSSH KRL header. Because the number lives in the bare KRL bytes it is
// authenticated by the detached CA signature over sha256(krl) — unlike the former
// unsigned JSON field, which a compromised server could inflate at will.
func krlHeaderNumber(krl []byte) (int64, error) {
	if len(krl) < krlHeaderMinLen {
		return 0, exitcodes.New(exitcodes.Version, "krl is too short (%d bytes) to contain an OpenSSH KRL header", len(krl))
	}
	if !bytes.Equal(krl[:8], krlMagic) {
		return 0, exitcodes.New(exitcodes.Version, "krl is not an OpenSSH KRL (bad magic)")
	}
	if v := binary.BigEndian.Uint32(krl[8:12]); v != krlFormatVersion {
		return 0, exitcodes.New(exitcodes.Version, "unsupported KRL format_version %d (want %d)", v, krlFormatVersion)
	}
	n := binary.BigEndian.Uint64(krl[12:20])
	if n > math.MaxInt64 {
		return 0, exitcodes.New(exitcodes.Version, "KRL version number %d exceeds int64", n)
	}
	return int64(n), nil
}

// Validate enforces host binding, freshness, version integrity, and anti-rollback.
// headerVersion is the X-KRL-Version response header; prevNumber is the installed
// KRL header number (0 when nothing is installed); now/skew are injected for testing.
func (p *Parsed) Validate(expectHostID, headerVersion string, prevNumber int64, now time.Time, skew time.Duration) error {
	if p.HostID != expectHostID {
		return exitcodes.New(exitcodes.HostMismatch, "payload host_id %q != our host-id %q", p.HostID, expectHostID)
	}
	if p.ValidUntil > 0 && time.Unix(p.ValidUntil, 0).Before(now.Add(-skew)) {
		return exitcodes.New(exitcodes.Expired, "payload expired: valid_until=%d is in the past (skew %s)", p.ValidUntil, skew)
	}
	if headerVersion != "" && p.Version != headerVersion {
		return exitcodes.New(exitcodes.Version, "krl_version %q != X-KRL-Version %q", p.Version, headerVersion)
	}
	sum := sha256.Sum256(p.KRL)
	want := "sha256:" + hex.EncodeToString(sum[:])
	if p.Version != want {
		return exitcodes.New(exitcodes.Version, "krl_version %q does not match sha256(krl) %q", p.Version, want)
	}
	// Anti-rollback on the SIGNED header number: reject anything not strictly newer
	// than what is installed. prevNumber==0 means nothing is installed yet.
	if prevNumber != 0 && p.Number <= prevNumber {
		return exitcodes.New(exitcodes.Version, "anti-rollback: KRL number %d is not newer than installed %d", p.Number, prevNumber)
	}
	return nil
}
