// Package payload parses and validates the decrypted KRL envelope (KRLC-05):
// host-id binding, valid_until freshness, krl_version integrity (== X-KRL-Version
// AND == sha256 of the bare KRL), and monotonic anti-rollback on krl_number.
package payload

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

type wire struct {
	KRL        string  `json:"krl"`
	CASig      *string `json:"ca_signature"`
	KRLVersion string  `json:"krl_version"`
	KRLNumber  int64   `json:"krl_number"` // 0 when the server omits it
	ValidUntil int64   `json:"valid_until"`
	HostID     string  `json:"host_id"`
}

// Parsed is the decoded payload (base64 fields resolved to bytes).
type Parsed struct {
	KRL        []byte // bare OpenSSH KRL bytes
	CASig      []byte // detached CA signature, or nil when ca_signature was null
	Version    string // krl_version token ("sha256:<hex>")
	Number     int64  // monotonic krl_number (0 if absent)
	ValidUntil int64  // unix seconds
	HostID     string
}

// Parse decodes the JSON and base64 fields. Structural failures map to Decrypt
// (a garbled plaintext means the wrong key/corruption, not a policy failure).
func Parse(plaintext []byte) (*Parsed, error) {
	var w wire
	if err := json.Unmarshal(plaintext, &w); err != nil {
		return nil, exitcodes.New(exitcodes.Decrypt, "payload is not valid JSON: %v", err)
	}
	krl, err := base64.StdEncoding.DecodeString(w.KRL)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Version, "krl is not valid base64: %v", err)
	}
	var sig []byte
	if w.CASig != nil && *w.CASig != "" {
		sig, err = base64.StdEncoding.DecodeString(*w.CASig)
		if err != nil {
			return nil, exitcodes.New(exitcodes.Verify, "ca_signature is not valid base64: %v", err)
		}
	}
	return &Parsed{KRL: krl, CASig: sig, Version: w.KRLVersion, Number: w.KRLNumber, ValidUntil: w.ValidUntil, HostID: w.HostID}, nil
}

// Validate enforces host binding, freshness, version integrity, and anti-rollback.
// headerVersion is the X-KRL-Version response header; prevNumber is the installed
// krl_number (0 when nothing is installed); now/skew are injected for testing.
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
	if p.Number != 0 && prevNumber != 0 && p.Number <= prevNumber {
		return exitcodes.New(exitcodes.Version, "anti-rollback: krl_number %d is not newer than installed %d", p.Number, prevNumber)
	}
	return nil
}
