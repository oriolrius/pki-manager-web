package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRevoker struct {
	serials []string
	status  int
}

func (b *fakeRevoker) Revoke(_ context.Context, serial string) error {
	b.serials = append(b.serials, serial)
	if b.status != 0 {
		return &backendStatusError{b.status}
	}
	return nil
}
func TestIntuneRevocationJournalSurvivesFailedAcknowledgment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "revocations.json")
	downloads := 0
	uploads := 0
	backend := &fakeRevoker{}
	client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "login.microsoftonline.com" {
			return jsonResponse(200, map[string]any{"access_token": "token", "token_type": "Bearer", "expires_in": 3600}), nil
		}
		if r.URL.Host == "graph.microsoft.com" {
			return jsonResponse(200, map[string]any{"value": []any{map[string]string{"serviceName": revocationService, "uri": "https://region.manage.microsoft.com/Pki"}}}), nil
		}
		if r.Header.Get("api-version") != revocationAPIVersion {
			t.Fatal("wrong revocation API version")
		}
		if strings.HasSuffix(r.URL.Path, "downloadRevocationRequests") {
			downloads++
			return jsonResponse(200, map[string]any{"value": []any{map[string]string{"requestContext": "opaque-context", "serialNumber": "00ABCD", "issuerName": "CN=CA"}}}), nil
		}
		uploads++
		var body struct {
			Results []revocationResult `json:"results"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Results) != 1 || !body.Results[0].Succeeded || body.Results[0].Context != "opaque-context" {
			t.Fatal("invalid revocation result")
		}
		if uploads == 1 {
			return jsonResponse(200, map[string]bool{"value": false}), nil
		}
		return jsonResponse(200, map[string]string{"value": "True"}), nil
	})}
	a, err := newIntuneAuthorizer("tenant", "client", "secret", client)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.pollRevocations(context.Background(), backend, "CN=CA", path); err == nil {
		t.Fatal("unacknowledged batch discarded")
	}
	if _, err = os.Stat(path); err != nil {
		t.Fatal("batch was not persisted")
	}
	// Simulate restarting the gateway with no in-memory state.
	a, _ = newIntuneAuthorizer("tenant", "client", "secret", client)
	if err = a.pollRevocations(context.Background(), backend, "CN=CA", path); err != nil {
		t.Fatal(err)
	}
	if downloads != 1 || uploads != 2 || len(backend.serials) != 2 || backend.serials[0] != "abcd" {
		t.Fatal("did not safely replay the pending batch")
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("acknowledged journal was not removed")
	}
}
func TestRevocationCannotCrossTenantOrCA(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pending.json")
	if err := saveJournal(path, revocationJournal{Tenant: "other-tenant", ClientID: "client", Issuer: "CN=CA"}); err != nil {
		t.Fatal(err)
	}
	a, _ := newIntuneAuthorizer("tenant", "client", "secret", http.DefaultClient)
	if a.pollRevocations(context.Background(), &fakeRevoker{}, "CN=CA", path) == nil {
		t.Fatal("foreign journal processed")
	}
}
func TestRevocationReportsOwnershipErrorsWithoutRevokingAnotherCA(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pending.json")
	journal := revocationJournal{Tenant: "tenant", ClientID: "client", Issuer: "CN=CA", Requests: []revocationRequest{{Context: "a", Serial: "01", Issuer: "CN=Other"}, {Context: "b", Serial: "02", Issuer: "CN=CA"}}}
	if err := saveJournal(path, journal); err != nil {
		t.Fatal(err)
	}
	backend := &fakeRevoker{status: 403}
	client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "login.microsoftonline.com" {
			return jsonResponse(200, map[string]any{"access_token": "token", "token_type": "Bearer", "expires_in": 3600}), nil
		}
		if r.URL.Host == "graph.microsoft.com" {
			return jsonResponse(200, map[string]any{"value": []any{map[string]string{"serviceName": revocationService, "uri": "https://region.manage.microsoft.com/Pki"}}}), nil
		}
		var payload struct {
			Results []revocationResult `json:"results"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		for _, result := range payload.Results {
			if result.Succeeded || result.Code != "CertificateNotFoundError" {
				t.Fatal("ownership failure was not reported")
			}
		}
		return jsonResponse(200, map[string]bool{"value": true}), nil
	})}
	a, _ := newIntuneAuthorizer("tenant", "client", "secret", client)
	if err := a.pollRevocations(context.Background(), backend, "CN=CA", path); err != nil {
		t.Fatal(err)
	}
	if len(backend.serials) != 1 || backend.serials[0] != "02" {
		t.Fatal("a foreign issuer was passed to revocation")
	}
}

func TestRevocationJournalBindsActualAuthorityNotJustSubjectName(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pending.json")
	if err := saveJournal(path, revocationJournal{AuthorityID: "old-ca-token-binding", Tenant: "tenant", ClientID: "client", Issuer: "CN=Same Name"}); err != nil {
		t.Fatal(err)
	}
	a, _ := newIntuneAuthorizer("tenant", "client", "secret", http.DefaultClient)
	a.authorityID = "different-ca-token-binding"
	if a.pollRevocations(context.Background(), &fakeRevoker{}, "CN=Same Name", path) == nil {
		t.Fatal("same-subject foreign authority journal accepted")
	}
}
