package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// Managed enrollment authorizes the exact DER CSR (including its challenge and
// requested identities). There is deliberately no fallback to a static challenge.
type enrollmentAuthorizer interface {
	Validate(context.Context, string, *x509.CertificateRequest) error
	Success(context.Context, string, *x509.CertificateRequest, *x509.Certificate) error
	Failure(context.Context, string, *x509.CertificateRequest) error
}

// webhookAuthorizer supports other MDMs via an explicit, authenticated validator.
// The validator must return approved:true AND the hash of the exact CSR it checked.
type webhookAuthorizer struct {
	endpoint, token string
	client          *http.Client
}

func secureEndpoint(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && u.Fragment == ""
}
func (a *webhookAuthorizer) Validate(ctx context.Context, transaction string, csr *x509.CertificateRequest) error {
	digest := sha256.Sum256(csr.Raw)
	hash := hex.EncodeToString(digest[:])
	data, _ := json.Marshal(map[string]string{"transactionId": transaction, "certificateRequest": base64.StdEncoding.EncodeToString(csr.Raw), "csrSha256": hash})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.token)
	response, err := a.client.Do(req)
	if err != nil {
		return errors.New("MDM validation unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return errors.New("MDM rejected enrollment")
	}
	var result struct {
		Approved bool   `json:"approved"`
		Hash     string `json:"csrSha256"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil || !result.Approved || !strings.EqualFold(result.Hash, hash) {
		return errors.New("MDM did not approve this CSR")
	}
	return nil
}
func (*webhookAuthorizer) Success(context.Context, string, *x509.CertificateRequest, *x509.Certificate) error {
	return nil
}
func (*webhookAuthorizer) Failure(context.Context, string, *x509.CertificateRequest) error {
	return nil
}

func configuredAuthorization(client *http.Client) (enrollmentAuthorizer, string, error) {
	switch setting("SCEP_AUTH_MODE", "shared") {
	case "shared":
		challenge, err := secret("SCEP_CHALLENGE")
		if err != nil {
			return nil, "", err
		}
		if len(challenge) < 32 || len(challenge) > 256 {
			return nil, "", errors.New("SCEP_CHALLENGE must be 32..256 bytes")
		}
		return nil, challenge, nil
	case "intune":
		value, err := secret("SCEP_INTUNE_CLIENT_SECRET")
		if err != nil {
			return nil, "", err
		}
		authorizer, err := newIntuneAuthorizer(os.Getenv("SCEP_INTUNE_TENANT_ID"), os.Getenv("SCEP_INTUNE_CLIENT_ID"), value, client)
		return authorizer, "", err
	case "webhook":
		endpoint := os.Getenv("SCEP_MDM_VALIDATION_URL")
		token, err := secret("SCEP_MDM_VALIDATION_TOKEN")
		if err != nil {
			return nil, "", err
		}
		if !secureEndpoint(endpoint) || len(token) < 32 {
			return nil, "", errors.New("webhook mode requires an HTTPS validation URL and a 32-byte validation token")
		}
		return &webhookAuthorizer{endpoint: endpoint, token: token, client: client}, "", nil
	default:
		return nil, "", errors.New("SCEP_AUTH_MODE must be shared, intune or webhook")
	}
}
