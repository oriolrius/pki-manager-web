package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1" // Intune's certificateThumbprint is the certificate's SHA-1 identifier, not a signing algorithm.
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Contract reference: Microsoft's MIT-licensed Intune-Resource-Access SCEP SDK.
// See NOTICE.intune and docs/intune.md. This implements its public HTTP contract
// with OAuth client credentials, Microsoft Graph discovery and explicit code=Success.
const intuneService = "ScepRequestValidationFEService"
const intuneAPIVersion = "2018-02-20"
const intuneScope = "https://api.manage.microsoft.com//.default"
const graphScope = "https://graph.microsoft.com/.default"

type cachedToken struct {
	value   string
	expires time.Time
}
type intuneAuthorizer struct {
	authorityID                      string
	tenant, clientID, secret, caller string
	client                           *http.Client
	mu                               sync.Mutex
	tokens                           map[string]cachedToken
	endpoint                         string
	endpointExpires                  time.Time
}

func newIntuneAuthorizer(tenant, clientID, secret string, client *http.Client) (*intuneAuthorizer, error) {
	if tenant == "" || clientID == "" || secret == "" || strings.ContainsAny(tenant+clientID, "/?#:@%\\ \t\r\n") {
		return nil, errors.New("Intune tenant, client ID and client secret are required")
	}
	return &intuneAuthorizer{tenant: tenant, clientID: clientID, secret: secret, caller: "pki-manager-scep/1", client: client, tokens: make(map[string]cachedToken)}, nil
}
func (a *intuneAuthorizer) token(ctx context.Context, scope string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cached := a.tokens[scope]; time.Now().Add(time.Minute).Before(cached.expires) {
		return cached.value, nil
	}
	form := url.Values{"client_id": {a.clientID}, "client_secret": {a.secret}, "grant_type": {"client_credentials"}, "scope": {scope}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://login.microsoftonline.com/"+a.tenant+"/oauth2/v2.0/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := a.client.Do(req)
	if err != nil {
		return "", errors.New("Intune authentication unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", errors.New("Intune authentication failed; check app permissions and consent")
	}
	var result struct {
		Token   string `json:"access_token"`
		Expires int    `json:"expires_in"`
		Type    string `json:"token_type"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil || result.Token == "" || !strings.EqualFold(result.Type, "Bearer") || result.Expires < 60 || result.Expires > 86400 {
		return "", errors.New("invalid Intune token response")
	}
	a.tokens[scope] = cachedToken{result.Token, time.Now().Add(time.Duration(result.Expires) * time.Second)}
	return result.Token, nil
}
func validIntuneEndpoint(raw string) bool {
	if !secureEndpoint(raw) {
		return false
	}
	u, _ := url.Parse(raw)
	host := strings.ToLower(u.Hostname())
	return (host == "manage.microsoft.com" || strings.HasSuffix(host, ".manage.microsoft.com")) && (u.Port() == "" || u.Port() == "443")
}
func (a *intuneAuthorizer) discover(ctx context.Context) (string, error) {
	return a.discoverService(ctx, intuneService)
}
func (a *intuneAuthorizer) discoverService(ctx context.Context, serviceName string) (string, error) {
	a.mu.Lock()
	cached, expiry := a.endpoint, a.endpointExpires
	a.mu.Unlock()
	if serviceName == intuneService && cached != "" && time.Now().Before(expiry) {
		return cached, nil
	}
	token, err := a.token(ctx, graphScope)
	if err != nil {
		return "", err
	}
	// The service-principal endpoint follows Microsoft's current SDK discovery contract.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://graph.microsoft.com/v1.0/servicePrincipals/appId=0000000a-0000-0000-c000-000000000000/endpoints", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	response, err := a.client.Do(req)
	if err != nil {
		return "", errors.New("Intune service discovery unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", errors.New("Intune service discovery failed; check Graph permissions")
	}
	var result struct {
		Values []struct {
			Provider string `json:"providerName"`
			Name     string `json:"serviceName"`
			URI      string `json:"uri"`
		} `json:"value"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		return "", errors.New("invalid Intune discovery response")
	}
	for _, service := range result.Values {
		name := service.Provider
		if name == "" {
			name = service.Name
		}
		if strings.EqualFold(name, serviceName) && validIntuneEndpoint(service.URI) {
			if serviceName != intuneService {
				return strings.TrimRight(service.URI, "/"), nil
			}
			a.mu.Lock()
			a.endpoint = strings.TrimRight(service.URI, "/")
			a.endpointExpires = time.Now().Add(time.Hour)
			cached = a.endpoint
			a.mu.Unlock()
			return cached, nil
		}
	}
	return "", errors.New("trusted Intune SCEP validation service not found")
}
func (a *intuneAuthorizer) postRaw(ctx context.Context, service, path, version string, payload any) (json.RawMessage, error) {
	endpoint, err := a.discoverService(ctx, service)
	if err != nil {
		return nil, err
	}
	token, err := a.token(ctx, intuneScope)
	if err != nil {
		return nil, err
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/"+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	id := make([]byte, 16)
	if _, err = rand.Read(id); err != nil {
		return nil, err
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	activity := fmt.Sprintf("%x-%x-%x-%x-%x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16])
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-version", version)
	req.Header.Set("client-request-id", activity)
	response, err := a.client.Do(req)
	if err != nil {
		return nil, errors.New("Intune service unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		a.mu.Lock()
		a.endpoint = ""
		delete(a.tokens, intuneScope)
		a.mu.Unlock()
		return nil, errors.New("Intune service rejected the operation")
	}
	var result json.RawMessage
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		return nil, errors.New("invalid Intune response")
	}
	return result, nil
}
func (a *intuneAuthorizer) post(ctx context.Context, action string, payload any) error {
	raw, err := a.postRaw(ctx, intuneService, "ScepActions/"+action, intuneAPIVersion, payload)
	if err != nil {
		return err
	}
	var result struct {
		Code string `json:"code"`
	}
	if err = json.Unmarshal(raw, &result); err != nil || result.Code != "Success" {
		return errors.New("Intune did not approve the operation")
	}
	return nil
}
func (a *intuneAuthorizer) Validate(ctx context.Context, transaction string, csr *x509.CertificateRequest) error {
	return a.post(ctx, "validateRequest", map[string]any{"request": map[string]string{"transactionId": transaction, "certificateRequest": base64.StdEncoding.EncodeToString(csr.Raw), "callerInfo": a.caller}})
}
func (a *intuneAuthorizer) Success(ctx context.Context, transaction string, csr *x509.CertificateRequest, cert *x509.Certificate) error {
	thumb := sha1.Sum(cert.Raw)
	return a.post(ctx, "successNotification", map[string]any{"notification": map[string]string{
		"transactionId": transaction, "certificateRequest": base64.StdEncoding.EncodeToString(csr.Raw), "callerInfo": a.caller,
		"certificateThumbprint": strings.ToUpper(hex.EncodeToString(thumb[:])), "certificateSerialNumber": strings.ToUpper(cert.SerialNumber.Text(16)),
		"certificateExpirationDateUtc": cert.NotAfter.UTC().Format("2006-01-02T15:04:05.000Z"), "issuingCertificateAuthority": cert.Issuer.String(), "caConfiguration": "PKI Manager KMS", "certificateAuthority": cert.Issuer.String(),
	}})
}
func (a *intuneAuthorizer) Failure(ctx context.Context, transaction string, csr *x509.CertificateRequest) error {
	return a.post(ctx, "failureNotification", map[string]any{"notification": map[string]any{"transactionId": transaction, "certificateRequest": base64.StdEncoding.EncodeToString(csr.Raw), "callerInfo": a.caller, "hResult": int64(-2147467259), "errorDescription": "PKI Manager could not complete certificate issuance"}})
}
