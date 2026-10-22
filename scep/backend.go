package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type issuer interface {
	Bundle(context.Context) ([]*x509.Certificate, error)
	Issue(context.Context, *x509.CertificateRequest) (*x509.Certificate, error)
}
type backend struct {
	url, token string
	days       int
	client     *http.Client
}

func (b *backend) call(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(b.url, "/")+"/api/v1/external/"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+b.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.client.Do(req)
	if err != nil {
		return errors.New("PKI backend unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return &backendStatusError{status: resp.StatusCode}
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(output)
}
func parsePEMCerts(data string) ([]*x509.Certificate, error) {
	var certs []*x509.Certificate
	for len(data) > 0 {
		block, rest := pem.Decode([]byte(data))
		if block == nil {
			break
		}
		data = string(rest)
		if block.Type != "CERTIFICATE" {
			return nil, errors.New("expected certificate PEM")
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, err
		}
		certs = append(certs, cert)
	}
	if len(certs) == 0 {
		return nil, errors.New("no certificates in bundle")
	}
	return certs, nil
}
func (b *backend) Bundle(ctx context.Context) ([]*x509.Certificate, error) {
	var response struct {
		ChainPEM string `json:"chainPem"`
	}
	if err := b.call(ctx, http.MethodGet, "ca-bundle", nil, &response); err != nil {
		return nil, err
	}
	return parsePEMCerts(response.ChainPEM)
}
func (b *backend) Issue(ctx context.Context, csr *x509.CertificateRequest) (*x509.Certificate, error) {
	hash := sha256.Sum256(csr.Raw)
	return b.issueWithUID(ctx, csr, "scep:"+hex.EncodeToString(hash[:]))
}

func (b *backend) issueWithUID(ctx context.Context, csr *x509.CertificateRequest, uid string) (*x509.Certificate, error) {
	input := map[string]any{"csrPem": string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr.Raw})), "requestUid": uid, "durationDays": b.days, "certificateType": "client"}
	var response struct {
		CertificatePEM string `json:"certificatePem"`
	}
	if err := b.call(ctx, http.MethodPost, "sign", input, &response); err != nil {
		return nil, err
	}
	certs, err := parsePEMCerts(response.CertificatePEM)
	if err != nil {
		return nil, err
	}
	return certs[0], nil
}

// certificateStatus is required before accepting a renewal authenticated by an
// existing certificate. The lookup is scoped to the gateway's backend identity.
type certificateStatus interface {
	Active(context.Context, *x509.Certificate) error
}

func (b *backend) Active(ctx context.Context, cert *x509.Certificate) error {
	var result struct {
		Active bool `json:"active"`
	}
	if err := b.call(ctx, http.MethodGet, "certificate-status/"+cert.SerialNumber.Text(16), nil, &result); err != nil {
		return err
	}
	if !result.Active {
		return errors.New("renewal signer is revoked, expired or not owned by this service")
	}
	return nil
}

type backendStatusError struct{ status int }

func (e *backendStatusError) Error() string {
	return fmt.Sprintf("PKI backend failed (HTTP %d)", e.status)
}
func (b *backend) Revoke(ctx context.Context, serial string) error {
	var result struct {
		Status string `json:"status"`
	}
	if err := b.call(ctx, http.MethodPost, "revoke", map[string]string{"serialNumber": serial, "reason": "cessationOfOperation"}, &result); err != nil {
		return err
	}
	if result.Status != "revoked" {
		return errors.New("backend did not confirm revocation")
	}
	return nil
}
