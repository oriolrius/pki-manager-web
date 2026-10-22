package main

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

// Backend owns renewal, key binding and replica coordination. Network calls run
// outside the RA lock; handlers continue using the previous public certificate.
func (g *gateway) renewRA(ctx context.Context, path string, renew func(context.Context) (state, error)) error {
	g.renewMu.Lock()
	defer g.renewMu.Unlock()
	saved, err := renew(ctx)
	if err != nil {
		return err
	}
	certs, err := parsePEMCerts(saved.CertificatePEM)
	if err != nil {
		return err
	}
	next := certs[0]
	if err := validateRA(next, g.chain[0], g.key.Public()); err != nil {
		return err
	}
	previous := []*x509.Certificate{}
	for _, encoded := range saved.PreviousCertificatesPEM {
		certs, err := parsePEMCerts(encoded)
		if err != nil {
			return err
		}
		if time.Now().Before(certs[0].NotAfter) {
			if err := validateRA(certs[0], g.chain[0], g.key.Public()); err != nil {
				return err
			}
			previous = append(previous, certs[0])
		}
	}
	current := g.snapshot(ctx)
	if next.NotAfter.Before(current.ra.NotAfter) {
		return errors.New("backend RA state would roll back validity")
	}
	if err := replaceRAState(path, saved); err != nil {
		return err
	}
	g.raMu.Lock()
	g.ra, g.previousRA = next, previous
	g.raMu.Unlock()
	return nil
}

func replaceRAState(path string, saved state) error {
	data, err := json.MarshalIndent(saved, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".ra-renew-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
