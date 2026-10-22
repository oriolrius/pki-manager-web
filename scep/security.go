package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"errors"
	"strings"
)

var subjectOIDs = map[string]string{"2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.6": "C", "2.5.4.8": "ST", "2.5.4.7": "L"}

func sharedSubjectConfig(raw string) (map[string]string, error) {
	fields := map[string]string{}
	if raw == "" {
		return fields, nil
	}
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return nil, errors.New("SCEP_SHARED_SUBJECT must be a JSON string map")
	}
	for key, value := range fields {
		if !strings.Contains("|O|OU|C|ST|L|", "|"+key+"|") || value == "" {
			return nil, errors.New("SCEP_SHARED_SUBJECT allows nonempty O, OU, C, ST, L only")
		}
	}
	return fields, nil
}

func validSharedSubject(csr *x509.CertificateRequest, fixed map[string]string) bool {
	if csr == nil {
		return false
	}
	seen := map[string]bool{}
	for _, attr := range csr.Subject.Names {
		oid := attr.Type.String()
		if seen[oid] {
			return false
		}
		seen[oid] = true
		value, ok := attr.Value.(string)
		if !ok {
			return false
		}
		if oid == "2.5.4.3" {
			if value == "" {
				return false
			}
			continue
		}
		key, ok := subjectOIDs[oid]
		if !ok || fixed[key] == "" || value != fixed[key] {
			return false
		}
	}
	if !seen["2.5.4.3"] {
		return false
	}
	for oid, key := range subjectOIDs {
		if fixed[key] != "" && !seen[oid] {
			return false
		}
	}
	return true
}

func sameRenewalIdentity(csr *x509.CertificateRequest, old *x509.Certificate) bool {
	if !bytes.Equal(csr.RawSubject, old.RawSubject) {
		return false
	}
	var requested, previous []byte
	for _, ext := range csr.Extensions {
		if ext.Id.String() == "2.5.29.17" {
			requested = ext.Value
		}
	}
	for _, ext := range old.Extensions {
		if ext.Id.String() == "2.5.29.17" {
			previous = ext.Value
		}
	}
	return bytes.Equal(requested, previous)
}

// Only protect the in-flight map with the mutex; network operations execute
// outside it. Identical CSRs serialize so the backend's retry path can be used.
func (g *gateway) acquireCSR(ctx context.Context, der []byte) (func(), error) {
	id := sha256.Sum256(der)
	for {
		g.mu.Lock()
		if g.inflight == nil {
			g.inflight = make(map[[32]byte]chan struct{})
		}
		pending := g.inflight[id]
		if pending == nil {
			pending = make(chan struct{})
			g.inflight[id] = pending
			g.mu.Unlock()
			return func() { g.mu.Lock(); delete(g.inflight, id); close(pending); g.mu.Unlock() }, nil
		}
		g.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-pending:
		}
	}
}

func (g *gateway) isRASerial(serial string) bool {
	g.raMu.RLock()
	defer g.raMu.RUnlock()
	normalize := func(s string) string { return strings.TrimLeft(strings.ToLower(s), "0") }
	serial = normalize(serial)
	if serial == normalize(g.ra.SerialNumber.Text(16)) {
		return true
	}
	for _, cert := range g.previousRA {
		if serial == normalize(cert.SerialNumber.Text(16)) {
			return true
		}
	}
	return false
}
