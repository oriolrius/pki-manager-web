package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPKIOperationPostContentTypes(t *testing.T) {
	g, _, _, _ := fixture(t)
	post := func(ct string) int {
		r := httptest.NewRequest(http.MethodPost, "/scep?operation=PKIOperation", bytes.NewReader([]byte("not a pkcs7 message")))
		if ct != "" {
			r.Header.Set("Content-Type", ct)
		}
		w := httptest.NewRecorder()
		g.ServeHTTP(w, r)
		return w.Code
	}
	for _, ct := range []string{"application/x-pki-message", "application/octet-stream", "Application/Octet-Stream; charset=binary"} {
		if code := post(ct); code == 415 {
			t.Fatalf("Content-Type %q rejected with 415", ct)
		}
	}
	for _, ct := range []string{"", "text/plain", "application/json"} {
		if code := post(ct); code != 415 {
			t.Fatalf("Content-Type %q: got %d, want 415", ct, code)
		}
	}
}
