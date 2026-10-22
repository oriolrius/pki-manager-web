package main

import (
	"errors"
	"net"
	"net/url"
	"strings"
)

// HTTPS protects service tokens even when an HTTP(S)_PROXY is configured.
// Plain HTTP is permitted only for literal loopback addresses or localhost.
func validateBackendURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("invalid SCEP_BACKEND_URL")
	}
	if u.Scheme == "https" {
		return nil
	}
	if u.Scheme == "http" {
		host := strings.ToLower(u.Hostname())
		ip := net.ParseIP(host)
		if host == "localhost" || (ip != nil && ip.IsLoopback()) {
			return nil
		}
	}
	return errors.New("SCEP_BACKEND_URL requires HTTPS unless the host is loopback")
}
