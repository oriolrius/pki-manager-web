package payload

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"testing"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// FuzzParse feeds arbitrary bytes to Parse. The plaintext comes from the server
// (after ECIES decryption), so Parse must reject every malformed input with a
// typed exit-code error, and an accepted payload must agree with its own bytes.
func FuzzParse(f *testing.F) {
	krl := testKRL(7, []byte("body"))
	valid, _ := json.Marshal(map[string]any{
		"krl": base64.StdEncoding.EncodeToString(krl), "ca_signature": base64.StdEncoding.EncodeToString([]byte("sig")),
		"krl_version": "sha256:00", "valid_until": 9999999999, "host_id": "h.example.com",
	})
	f.Add(valid)
	f.Add([]byte(`{"krl":"AAAA","ca_signature":null,"krl_version":"sha256:x","valid_until":0,"host_id":"h"}`))
	f.Add([]byte(`{"krl":"!!!not-base64"}`))
	f.Add([]byte(`{"krl":"U1NIS1JMCgAAAAABf/////////8=","ca_signature":"***"}`))
	f.Add([]byte(`{"krl":"U1NIS1JMCgAAAAAC//////////8="}`))
	f.Add([]byte(`{"krl":123}`))
	f.Add([]byte(`[]`))
	f.Add([]byte(`null`))
	f.Add([]byte(``))
	f.Add([]byte(`{"krl":"U1NIS1JMCgA="}`))

	f.Fuzz(func(t *testing.T, data []byte) {
		p, err := Parse(data)
		if err != nil {
			if p != nil {
				t.Fatalf("Parse returned a payload together with an error: %v", err)
			}
			e, ok := err.(*exitcodes.Error)
			if !ok {
				t.Fatalf("Parse error is not a typed exit-code error: %T %v", err, err)
			}
			if e.Code != exitcodes.Decrypt && e.Code != exitcodes.Version && e.Code != exitcodes.Verify {
				t.Fatalf("unexpected exit code %d: %v", e.Code, err)
			}
			return
		}
		if p == nil {
			t.Fatal("Parse returned nil without an error")
		}
		// An accepted KRL always carries the OpenSSH header, and Number is the
		// big-endian uint64 at offset 12 of those same bytes.
		if len(p.KRL) < krlHeaderMinLen || !bytes.Equal(p.KRL[:8], krlMagic) {
			t.Fatalf("accepted a KRL without the OpenSSH header: %x", p.KRL)
		}
		if p.Number < 0 || uint64(p.Number) != binary.BigEndian.Uint64(p.KRL[12:20]) {
			t.Fatalf("Number %d does not match the KRL header", p.Number)
		}
		// Round trip: the canonical re-encoding parses to the same payload.
		w := wire{KRL: base64.StdEncoding.EncodeToString(p.KRL), KRLVersion: p.Version, ValidUntil: p.ValidUntil, HostID: p.HostID}
		if p.CASig != nil {
			s := base64.StdEncoding.EncodeToString(p.CASig)
			w.CASig = &s
		}
		again, err := json.Marshal(w)
		if err != nil {
			t.Fatalf("re-encode: %v", err)
		}
		q, err := Parse(again)
		if err != nil {
			t.Fatalf("re-encoded payload is rejected: %v", err)
		}
		if !bytes.Equal(q.KRL, p.KRL) || !bytes.Equal(q.CASig, p.CASig) || q.Number != p.Number || q.ValidUntil != p.ValidUntil {
			t.Fatal("round trip changed the payload")
		}
	})
}
