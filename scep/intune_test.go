package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"github.com/smallstep/scep"
	"io"
	"net/http"
	"strings"
	"testing"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func jsonResponse(status int, value any) *http.Response {
	data, _ := json.Marshal(value)
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data))}
}
func TestIntuneValidationAndNotificationContract(t *testing.T) {
	g, issuer, key, signer := fixture(t)
	msg := request(t, g, key, signer, "opaque-dynamic-intune-challenge", nil)
	scopes := map[string]int{}
	actions := []string{}
	client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Host {
		case "login.microsoftonline.com":
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if r.Form.Get("client_secret") != "test-only-client-secret" || r.Form.Get("grant_type") != "client_credentials" {
				t.Error("invalid OAuth request")
			}
			scope := r.Form.Get("scope")
			scopes[scope]++
			return jsonResponse(200, map[string]any{"access_token": scope, "token_type": "Bearer", "expires_in": 3600}), nil
		case "graph.microsoft.com":
			if r.Header.Get("Authorization") != "Bearer "+graphScope {
				t.Error("wrong Graph token")
			}
			if !strings.HasSuffix(r.URL.Path, "/servicePrincipals/appId=0000000a-0000-0000-c000-000000000000/endpoints") {
				t.Error("wrong discovery path")
			}
			return jsonResponse(200, map[string]any{"value": []any{map[string]string{"providerName": intuneService, "uri": "https://region.manage.microsoft.com/Scep"}}}), nil
		case "region.manage.microsoft.com":
			if r.Header.Get("Authorization") != "Bearer "+intuneScope || r.Header.Get("api-version") != intuneAPIVersion || r.Header.Get("client-request-id") == "" {
				t.Error("invalid Intune headers")
			}
			var payload map[string]map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			var item map[string]any
			if strings.HasSuffix(r.URL.Path, "validateRequest") {
				actions = append(actions, "validate")
				item = payload["request"]
			} else {
				actions = append(actions, "notify")
				item = payload["notification"]
				if item["certificateThumbprint"] == "" || item["certificateSerialNumber"] == "" {
					t.Error("missing certificate notification")
				}
			}
			encoded, _ := item["certificateRequest"].(string)
			raw, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil || !bytes.Equal(raw, msg.CSR.Raw) || item["transactionId"] != string(msg.TransactionID) {
				t.Error("Intune did not receive exact CSR and transaction")
			}
			return jsonResponse(200, map[string]string{"code": "Success"}), nil
		default:
			t.Errorf("unexpected destination %s", r.URL.Host)
			return jsonResponse(500, nil), nil
		}
	})}
	auth, err := newIntuneAuthorizer("test-tenant", "test-client", "test-only-client-secret", client)
	if err != nil {
		t.Fatal(err)
	}
	g.authorizer = auth
	for n := 0; n < 2; n++ {
		w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
		reply, err := scep.ParsePKIMessage(w.Body.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		if reply.PKIStatus != scep.SUCCESS {
			t.Fatal("managed enrollment failed")
		}
	}
	if len(issuer.issued) != 1 || len(actions) != 4 || scopes[graphScope] != 1 || scopes[intuneScope] != 1 {
		t.Fatal("invalid retry or token cache behavior")
	}
}
func TestIntuneFailsClosed(t *testing.T) {
	for _, scenario := range []string{"rejected", "missing code", "bad JSON", "HTTP error", "untrusted discovery", "notification failure"} {
		t.Run(scenario, func(t *testing.T) {
			g, issuer, key, signer := fixture(t)
			msg := request(t, g, key, signer, testChallenge, nil)
			client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host == "login.microsoftonline.com" {
					return jsonResponse(200, map[string]any{"access_token": "token", "token_type": "Bearer", "expires_in": 3600}), nil
				}
				if r.URL.Host == "graph.microsoft.com" {
					uri := "https://region.manage.microsoft.com/Scep"
					if scenario == "untrusted discovery" {
						uri = "https://attacker.example/Scep"
					}
					return jsonResponse(200, map[string]any{"value": []any{map[string]string{"serviceName": intuneService, "uri": uri}}}), nil
				}
				if strings.HasSuffix(r.URL.Path, "successNotification") && scenario == "notification failure" {
					return jsonResponse(503, nil), nil
				}
				if scenario == "HTTP error" {
					return jsonResponse(403, nil), nil
				}
				if scenario == "rejected" {
					return jsonResponse(200, map[string]string{"code": "SubjectAltNameMismatch"}), nil
				}
				if scenario == "missing code" {
					return jsonResponse(200, map[string]any{"approved": true}), nil
				}
				if scenario == "bad JSON" {
					return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("not JSON")), Header: make(http.Header)}, nil
				}
				return jsonResponse(200, map[string]string{"code": "Success"}), nil
			})}
			auth, err := newIntuneAuthorizer("tenant", "client", "secret", client)
			if err != nil {
				t.Fatal(err)
			}
			g.authorizer = auth
			w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
			reply, err := scep.ParsePKIMessage(w.Body.Bytes())
			if err != nil {
				t.Fatal(err)
			}
			if reply.PKIStatus != scep.FAILURE {
				t.Fatal("Intune error did not reject enrollment")
			}
			if scenario != "notification failure" && issuer.calls != 0 {
				t.Fatal("Intune validation failed but a certificate was issued")
			}
		})
	}
}
func TestIntuneEndpointTrust(t *testing.T) {
	for _, endpoint := range []string{"http://region.manage.microsoft.com", "https://manage.microsoft.com.attacker.example", "https://user:pass@region.manage.microsoft.com", "https://region.manage.microsoft.com:8443", "https://attacker.example"} {
		if validIntuneEndpoint(endpoint) {
			t.Errorf("accepted %s", endpoint)
		}
	}
	if !validIntuneEndpoint("https://region.manage.microsoft.com/Scep") {
		t.Fatal("trusted endpoint rejected")
	}
}
func TestIntuneConfigCannotFallBackToSharedChallenge(t *testing.T) {
	t.Setenv("SCEP_AUTH_MODE", "intune")
	t.Setenv("SCEP_CHALLENGE", testChallenge)
	t.Setenv("SCEP_INTUNE_CLIENT_ID", "")
	t.Setenv("SCEP_INTUNE_TENANT_ID", "")
	t.Setenv("SCEP_INTUNE_CLIENT_SECRET", "")
	if _, _, err := configuredAuthorization(http.DefaultClient); err == nil {
		t.Fatal("incomplete Intune configuration accepted")
	}
}

type fakeManaged struct {
	deny                       bool
	validations, notifications int
}

func (a *fakeManaged) Validate(context.Context, string, *x509.CertificateRequest) error {
	a.validations++
	if a.deny {
		return io.ErrUnexpectedEOF
	}
	return nil
}
func (a *fakeManaged) Success(context.Context, string, *x509.CertificateRequest, *x509.Certificate) error {
	a.notifications++
	return nil
}
func (*fakeManaged) Failure(context.Context, string, *x509.CertificateRequest) error { return nil }
func (f *fakeIssuer) Active(_ context.Context, cert *x509.Certificate) error {
	if f.ra != nil && bytes.Equal(f.ra.Raw, cert.Raw) {
		return nil
	}
	for _, stored := range f.issued {
		if bytes.Equal(stored.Raw, cert.Raw) {
			return nil
		}
	}
	return io.ErrUnexpectedEOF
}
func TestManagedRenewalRequiresOwnedActiveSignerAndFreshValidation(t *testing.T) {
	g, issuer, key, _ := fixture(t)
	auth := &fakeManaged{}
	g.authorizer = auth
	// Simulate an existing, backend-owned device certificate for the old key.
	oldCSR := newCSR(t, key, "old-challenge", nil)
	oldCert, err := issuer.Issue(context.Background(), oldCSR)
	if err != nil {
		t.Fatal(err)
	}
	newKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	eku, _ := asn1.Marshal([]asn1.ObjectIdentifier{{1, 3, 6, 1, 5, 5, 7, 3, 2}})
	csr := newCSR(t, newKey, "fresh-dynamic-challenge", []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 37}, Value: eku}})
	msg, err := scep.NewCSRRequest(csr, &scep.PKIMessage{MessageType: scep.RenewalReq, Recipients: []*x509.Certificate{g.ra}, SignerCert: oldCert, SignerKey: key})
	if err != nil {
		t.Fatal(err)
	}
	w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
	reply, err := scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if reply.PKIStatus != scep.SUCCESS || auth.validations != 1 {
		t.Fatal("renewal failed")
	}
	if err := reply.DecryptPKIEnvelope(oldCert, key); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(reply.Certificate.RawSubjectPublicKeyInfo, csr.RawSubjectPublicKeyInfo) {
		t.Fatal("renewal did not preserve the new CSR key")
	}

	// Removing the original certificate models revocation/unowned status.
	delete(issuer.issued, string(oldCSR.Raw))
	w = invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
	reply, err = scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if reply.PKIStatus != scep.FAILURE {
		t.Fatal("revoked signer renewed")
	}
	auth.deny = true
	w = invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
	reply, err = scep.ParsePKIMessage(w.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if reply.PKIStatus != scep.FAILURE {
		t.Fatal("renewal bypassed dynamic authorization")
	}
}

type unavailableSigner struct{ public crypto.PublicKey }

func (s unavailableSigner) Public() crypto.PublicKey { return s.public }
func (unavailableSigner) Sign(io.Reader, []byte, crypto.SignerOpts) ([]byte, error) {
	return nil, io.ErrUnexpectedEOF
}
func TestMDMDoesNotReportSuccessBeforeReplyCanBeSigned(t *testing.T) {
	g, _, key, signer := fixture(t)
	authority := &fakeManaged{}
	g.authorizer = authority
	msg := request(t, g, key, signer, "dynamic-challenge", nil)
	g.key = unavailableSigner{g.ra.PublicKey}
	w := invoke(g, "POST", "/scep?operation=PKIOperation", msg.Raw)
	if w.Code == 200 || authority.notifications != 0 {
		t.Fatal("MDM was notified of success despite a failed response signature")
	}
}
