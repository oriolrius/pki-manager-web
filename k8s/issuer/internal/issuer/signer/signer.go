package signer

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is a typed HTTP client for the PKI Manager external issuer API.
type Client struct {
	baseURL string
	token   string
	hc      *http.Client
}

type Option func(*Client)

func WithCABundle(pem []byte) Option {
	return func(c *Client) {
		if len(pem) == 0 {
			return
		}
		pool := x509.NewCertPool()
		pool.AppendCertsFromPEM(pem)
		c.hc.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{
				RootCAs:    pool,
				MinVersion: tls.VersionTLS12,
			},
		}
	}
}

func WithTimeout(d time.Duration) Option {
	return func(c *Client) {
		c.hc.Timeout = d
	}
}

func New(baseURL, token string, opts ...Option) *Client {
	c := &Client{
		baseURL: baseURL,
		token:   token,
		hc: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

type errBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		buf, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		var e errBody
		_ = json.Unmarshal(respBody, &e)
		return fmt.Errorf("pki-manager %s %s: %d %s: %s",
			method, path, resp.StatusCode, e.Error.Code, e.Error.Message)
	}
	if out != nil {
		return json.Unmarshal(respBody, out)
	}
	return nil
}

type HealthResponse struct {
	Status  string `json:"status"`
	Cluster struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		CAID string `json:"caId"`
	} `json:"cluster"`
}

func (c *Client) Health(ctx context.Context) (*HealthResponse, error) {
	var out HealthResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/external/health", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type CABundleResponse struct {
	CAID           string `json:"caId"`
	SubjectDN      string `json:"subjectDn"`
	CertificatePEM string `json:"certificatePem"`
	ChainPEM       string `json:"chainPem"`
}

func (c *Client) CABundle(ctx context.Context) (*CABundleResponse, error) {
	var out CABundleResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/external/ca-bundle", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type SignRequest struct {
	CSRPem          string   `json:"csrPem"`
	DurationDays    int      `json:"durationDays,omitempty"`
	RequestUID      string   `json:"requestUid"`
	CertificateType string   `json:"certificateType,omitempty"`
	K8sNamespace    string   `json:"k8sNamespace,omitempty"`
	K8sResource     string   `json:"k8sResource,omitempty"`
	SanDNS          []string `json:"sanDns,omitempty"`
	SanIP           []string `json:"sanIp,omitempty"`
}

type SignResponse struct {
	Idempotent     bool   `json:"idempotent"`
	ID             string `json:"id"`
	SerialNumber   string `json:"serialNumber"`
	CertificatePEM string `json:"certificatePem"`
	ChainPEM       string `json:"chainPem"`
	NotBefore      string `json:"notBefore"`
	NotAfter       string `json:"notAfter"`
}

func (c *Client) Sign(ctx context.Context, req *SignRequest) (*SignResponse, error) {
	var out SignResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/external/sign", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type RevokeRequest struct {
	SerialNumber string `json:"serialNumber"`
	Reason       string `json:"reason,omitempty"`
}

type RevokeResponse struct {
	ID             string `json:"id"`
	SerialNumber   string `json:"serialNumber"`
	Status         string `json:"status"`
	RevocationDate string `json:"revocationDate"`
}

func (c *Client) Revoke(ctx context.Context, req *RevokeRequest) (*RevokeResponse, error) {
	var out RevokeResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/external/revoke", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
