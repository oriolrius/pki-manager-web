package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestKMSKeyUsesRemoteOperations(t *testing.T) {
	private, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	operations := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-only-token" || r.URL.Path != "/kmip/2_1" {
			t.Error("missing KMS authentication")
		}
		var node ttlv
		if err := json.NewDecoder(r.Body).Decode(&node); err != nil {
			t.Error(err)
			return
		}
		operations = append(operations, node.Tag)
		id, _ := stringField(node, "UniqueIdentifier")
		if id != "private-key-id" {
			t.Error("wrong KMS key")
		}
		var result []byte
		var err error
		tag := ""
		switch node.Tag {
		case "Sign":
			digest, _ := binaryField(node, "DigestedData")
			result, err = rsa.SignPKCS1v15(rand.Reader, private, crypto.SHA256, digest)
			tag = "SignatureData"
		case "Decrypt":
			data, _ := binaryField(node, "Data")
			result, err = rsa.DecryptPKCS1v15(rand.Reader, private, data)
			tag = "Data"
		default:
			t.Error("unexpected KMS operation")
		}
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		_ = json.NewEncoder(w).Encode(ttlv{Tag: node.Tag + "Response", Value: []ttlv{bytesField(tag, result)}})
	}))
	defer server.Close()
	key := &kmsKey{id: "private-key-id", public: &private.PublicKey, url: server.URL, token: "test-only-token", client: server.Client()}
	if err = keyCheck(key); err != nil {
		t.Fatal(err)
	}
	if len(operations) != 2 || operations[0] != "Sign" || operations[1] != "Decrypt" {
		t.Fatalf("unexpected operations %v", operations)
	}
	_, err = key.Sign(rand.Reader, make([]byte, 32), &rsa.PSSOptions{Hash: crypto.SHA256})
	if err == nil {
		t.Fatal("PSS accepted")
	}
	_, err = key.Sign(rand.Reader, make([]byte, 20), crypto.SHA1)
	if err == nil {
		t.Fatal("SHA1 accepted")
	}
}
func TestKMSFailuresDoNotExposeResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret-looking-response-do-not-log", 403) }))
	defer server.Close()
	key := &kmsKey{url: server.URL, client: server.Client()}
	digest := sha256.Sum256([]byte("test"))
	_, err := key.Sign(rand.Reader, digest[:], crypto.SHA256)
	if err == nil || strings.Contains(err.Error(), "secret-looking") {
		t.Fatal("unsafe KMS error")
	}
}
func TestLiveKMS(t *testing.T) {
	endpoint := os.Getenv("SCEP_TEST_KMS_URL")
	if endpoint == "" {
		t.Skip("SCEP_TEST_KMS_URL is not set")
	}
	k := &kmsKey{url: endpoint, client: &http.Client{Timeout: 30 * time.Second}}
	if err := k.create(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, id := range []string{k.id, k.publicID} {
			_, _ = k.call("Revoke", text("UniqueIdentifier", id), ttlv{Tag: "RevocationReason", Value: []ttlv{enum("RevocationReasonCode", "CessationOfOperation")}})
			_, _ = k.call("Destroy", text("UniqueIdentifier", id))
		}
	})
	if err := keyCheck(k); err != nil {
		t.Fatal(err)
	}
	// A Sensitive private key must never be exportable as plaintext.
	node, err := k.call("Get", text("UniqueIdentifier", k.id), enum("KeyFormatType", "PKCS8"))
	if err == nil {
		if value, ok := findField(node, "KeyMaterial"); ok {
			t.Fatal("KMS exported a Sensitive private key", fmt.Sprintf("type=%T", value))
		}
	}
	pubDER, err := x509.MarshalPKIXPublicKey(k.Public())
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("verified remote RSA signing/decryption with public-key fingerprint %s", hex.EncodeToString(cryptoSHA256(pubDER)))
}
