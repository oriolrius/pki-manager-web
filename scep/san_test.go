package main

import (
	"context"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func sanDER(names ...asn1.RawValue) []byte { der, _ := asn1.Marshal(names); return der }
func generalName(tag int, value string) asn1.RawValue {
	return asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: tag, Bytes: []byte(value)}
}
func TestManagedSANIdentities(t *testing.T) {
	upn, _ := asn1.MarshalWithParams("device@tenant.example", "utf8")
	other, _ := asn1.MarshalWithParams(struct {
		OID   asn1.ObjectIdentifier
		Value asn1.RawValue
	}{asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 311, 20, 2, 3}, asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 0, IsCompound: true, Bytes: upn}}, "tag:0")
	cases := [][]byte{
		sanDER(generalName(2, "device-001.example.com")),
		sanDER(generalName(6, "urn:uuid:12345678-1234-1234-1234-123456789abc")),
		sanDER(generalName(6, "tag:microsoft.com,2022-09-14:sid:S-1-5-21-100-200-300-400")),
		sanDER(generalName(1, "device@tenant.example")),
		sanDER(asn1.RawValue{FullBytes: other}),
		sanDER(asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 7, Bytes: []byte{192, 0, 2, 1}}),
	}
	for n, der := range cases {
		if err := validateSAN(der); err != nil {
			t.Fatalf("valid SAN %d: %v", n, err)
		}
	}
	for _, der := range [][]byte{sanDER(generalName(2, "*.example.com")), sanDER(generalName(2, "bad name")), sanDER(generalName(6, "javascript:alert(1)")), sanDER(generalName(7, "bad-ip")), sanDER(), []byte("invalid")} {
		if validateSAN(der) == nil {
			t.Fatal("malformed/unsupported SAN accepted")
		}
	}
	g, _, key, signer := fixture(t)
	msg := request(t, g, key, signer, "fresh-mdm-challenge", []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 17}, Value: cases[0]}})
	if validateCSR(msg.CSR, signer) == nil {
		t.Fatal("shared challenge authorized managed SANs")
	}
	if err := validateCSRPolicy(msg.CSR, signer, true, false); err != nil {
		t.Fatal(err)
	}
}
func TestWebhookBindsApprovalToExactCSR(t *testing.T) {
	g, _, key, signer := fixture(t)
	msg := request(t, g, key, signer, testChallenge, nil)
	for _, scenario := range []string{"approved", "rejected", "wrong hash", "server error"} {
		t.Run(scenario, func(t *testing.T) {
			a := &webhookAuthorizer{endpoint: "https://mdm.example/validate", token: testChallenge, client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				if r.Header.Get("Authorization") != "Bearer "+testChallenge {
					t.Fatal("missing validator authentication")
				}
				var body map[string]string
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				hash := body["csrSha256"]
				if _, err := hex.DecodeString(hash); err != nil {
					t.Fatal(err)
				}
				if scenario == "server error" {
					return jsonResponse(503, nil), nil
				}
				if scenario == "wrong hash" {
					hash = strings.Repeat("0", 64)
				}
				return jsonResponse(200, map[string]any{"approved": scenario != "rejected", "csrSha256": hash}), nil
			})}}
			err := a.Validate(context.Background(), string(msg.TransactionID), msg.CSR)
			if (err == nil) != (scenario == "approved") {
				t.Fatalf("unexpected approval: %v", err)
			}
		})
	}
}
func TestMissingClientEKUIsRejected(t *testing.T) {
	_, _, key, signer := fixture(t)
	csr := newCSR(t, key, "challenge", nil)
	if validateCSRPolicy(csr, signer, true, false) == nil {
		t.Fatal("missing client EKU accepted")
	}
}
