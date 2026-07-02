// Package krlclient is the HTTP layer (KRLC-03): POST the encrypted per-host KRL
// endpoint with If-None-Match caching, bounded retries, timeouts, and TLS
// verification, mapping HTTP statuses to typed exit codes.
package krlclient

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

const krlPath = "/api/v1/external/ssh/krl"

// defaultMaxResponseBytes bounds the 200-response body when the caller does not
// override it (see SetMaxResponseBytes). A per-host ECIES-wrapped KRL is far
// smaller; the cap only stops a hostile/compromised endpoint from streaming an
// unbounded body into memory.
const defaultMaxResponseBytes int64 = 8 << 20 // 8 MiB

type Client struct {
	serverURL string
	http      *http.Client
	retries   int
	maxBytes  int64 // ceiling on the accepted response-body size
}

// Result is the outcome of a KRL fetch.
type Result struct {
	NotModified bool   // 304: the host already holds Version
	Body        []byte // 200: the raw ECIES ciphertext
	Version     string // X-KRL-Version response header
	Status      int    // HTTP status of the terminal response (200 or 304)
}

// New builds a Client. TLS is verified by default; --ca-bundle pins the roots and
// --insecure disables verification (mutually exclusive — enforced by the caller).
func New(serverURL, caBundle string, insecure bool, timeout time.Duration, retries int) (*Client, error) {
	if strings.TrimSpace(serverURL) == "" {
		return nil, exitcodes.New(exitcodes.Usage, "--server-url is required")
	}
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	switch {
	case insecure:
		tlsCfg.InsecureSkipVerify = true
	case caBundle != "":
		pem, err := os.ReadFile(caBundle)
		if err != nil {
			return nil, exitcodes.New(exitcodes.Usage, "read ca-bundle: %v", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, exitcodes.New(exitcodes.Usage, "ca-bundle %q contained no certificates", caBundle)
		}
		tlsCfg.RootCAs = pool
	}
	return &Client{
		serverURL: strings.TrimRight(serverURL, "/"),
		retries:   retries,
		maxBytes:  defaultMaxResponseBytes,
		http:      &http.Client{Timeout: timeout, Transport: &http.Transport{TLSClientConfig: tlsCfg}},
	}, nil
}

// SetMaxResponseBytes overrides the accepted response-body ceiling (in bytes).
// A value <= 0 keeps the default (defaultMaxResponseBytes).
func (c *Client) SetMaxResponseBytes(n int64) {
	if n > 0 {
		c.maxBytes = n
	}
}

// FetchKRL POSTs {"host_id":hostID} to the encrypted KRL endpoint. When
// ifNoneMatch is non-empty it is sent verbatim (the cached krl_version token, NOT
// a hash of the local file) so an unchanged KRL returns 304.
func (c *Client) FetchKRL(ctx context.Context, hostID, ifNoneMatch string) (*Result, error) {
	body, _ := json.Marshal(map[string]string{"host_id": hostID})
	url := c.serverURL + krlPath

	var lastErr error
	for attempt := 0; attempt <= c.retries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, exitcodes.New(exitcodes.Network, "request cancelled: %v", ctx.Err())
			case <-time.After(backoff(attempt)):
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return nil, exitcodes.New(exitcodes.Usage, "build request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}

		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = err // transport error — retry
			continue
		}
		res, retry, herr := handle(resp, c.maxBytes)
		if retry {
			lastErr = herr
			continue
		}
		return res, herr
	}
	return nil, exitcodes.New(exitcodes.Network, "request failed after %d attempt(s): %v", c.retries+1, lastErr)
}

// handle classifies a response. retry=true means the caller should try again.
// The 200 body is read through a bounded reader (maxBytes) so a hostile or
// compromised endpoint cannot stream an unbounded body into memory; exceeding
// the ceiling fails closed (no retry) rather than being silently truncated.
func handle(resp *http.Response, maxBytes int64) (res *Result, retry bool, err error) {
	defer resp.Body.Close()
	version := resp.Header.Get("X-KRL-Version")
	switch resp.StatusCode {
	case http.StatusOK:
		// Read at most maxBytes+1: a full maxBytes+1 read means the body exceeds
		// the ceiling. The reader stops at the limit, so we never buffer more.
		b, e := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
		if e != nil {
			return nil, true, e // truncated read — retry
		}
		if int64(len(b)) > maxBytes {
			return nil, false, exitcodes.New(exitcodes.Network,
				"response body exceeds the %d-byte limit — raise --max-response-bytes if this host's KRL is legitimately larger", maxBytes)
		}
		return &Result{Body: b, Version: version, Status: resp.StatusCode}, false, nil
	case http.StatusNotModified:
		return &Result{NotModified: true, Version: version, Status: resp.StatusCode}, false, nil
	case http.StatusBadRequest, http.StatusNotFound, http.StatusNotImplemented:
		hint := ""
		if resp.StatusCode == http.StatusNotFound {
			// 404 here means the host is unknown or has no P-256 key on file:
			// point the operator at the exact onboarding step.
			hint = " — register this host's ecdsa public key (/etc/ssh/ssh_host_ecdsa_key.pub) with pki-manager so it can encrypt this host's KRL"
		}
		return nil, false, exitcodes.New(exitcodes.NotProvisioned, "server %d — %s%s", resp.StatusCode, serverMsg(resp), hint)
	case http.StatusTooManyRequests:
		return nil, false, exitcodes.New(exitcodes.RateLimited, "rate limited (429) — back off and retry later")
	default:
		if resp.StatusCode >= 500 {
			return nil, true, fmt.Errorf("server %d — %s", resp.StatusCode, serverMsg(resp)) // 5xx — retry
		}
		return nil, false, exitcodes.New(exitcodes.Network, "unexpected status %d", resp.StatusCode)
	}
}

// serverMsg extracts the {"error":{"code","message"}} body PKI-Manager returns.
func serverMsg(resp *http.Response) string {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	var e struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(b, &e) == nil && e.Error.Message != "" {
		return e.Error.Code + ": " + e.Error.Message
	}
	return strings.TrimSpace(string(b))
}

// backoff is exponential, capped at 5s (attempt is 1-based here).
func backoff(attempt int) time.Duration {
	d := (200 * time.Millisecond) << uint(attempt-1)
	if d > 5*time.Second {
		d = 5 * time.Second
	}
	return d
}
