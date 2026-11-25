package krlclient

import (
	"bytes"
	"io"
	"net/http"
	"testing"
)

// FuzzHandle feeds an arbitrary server response (status, header, body) to the
// response classifier. It must never return more than maxBytes of body, and it
// must return a result or an error, never both and never neither.
func FuzzHandle(f *testing.F) {
	f.Add(200, "sha256:abc", []byte("ciphertext"), uint16(1024))
	f.Add(200, "", bytes.Repeat([]byte{1}, 300), uint16(10))
	f.Add(304, "sha256:abc", []byte{}, uint16(10))
	f.Add(404, "", []byte(`{"error":{"code":"HOST_NOT_FOUND","message":"no such host"}}`), uint16(10))
	f.Add(400, "", []byte(`{"error":`), uint16(10))
	f.Add(429, "", []byte{}, uint16(0))
	f.Add(503, "", []byte("\xff\xfe upstream"), uint16(10))
	f.Add(-1, "", []byte{}, uint16(10))

	f.Fuzz(func(t *testing.T, status int, version string, body []byte, max uint16) {
		resp := &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(body))}
		resp.Header.Set("X-KRL-Version", version)
		res, retry, err := handle(resp, int64(max))
		if (res == nil) == (err == nil) {
			t.Fatalf("status %d: result=%v err=%v", status, res, err)
		}
		if res != nil {
			if retry {
				t.Fatal("a result must not ask for a retry")
			}
			if status != http.StatusOK && status != http.StatusNotModified {
				t.Fatalf("status %d gave a result", status)
			}
			if len(res.Body) > int(max) {
				t.Fatalf("body of %d bytes exceeds the %d-byte limit", len(res.Body), max)
			}
			if status == http.StatusOK && !bytes.Equal(res.Body, body) {
				t.Fatal("body was changed")
			}
		}
	})
}
