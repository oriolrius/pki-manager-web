package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// Renew the certificate, retaining the Sensitive KMS key and still-valid recipient
// certificates so clients using a cached RA can finish enrollment during overlap.
func (g *gateway) renewRA(ctx context.Context, path, keyID string, issue func(context.Context, *x509.CertificateRequest, string) (*x509.Certificate, error), now time.Time) error {
	g.raMu.Lock()
	defer g.raMu.Unlock()
	if now.Before(g.ra.NotAfter.Add(-g.ra.NotAfter.Sub(g.ra.NotBefore) / 3)) {
		return nil
	}
	if err := validateRA(g.ra, g.chain[0], g.key.Public()); err != nil {
		return err
	}
	checker, ok := g.issuer.(certificateStatus)
	if !ok || checker.Active(ctx, g.ra) != nil {
		return errors.New("RA renewal requires an active service-owned certificate")
	}
	chain, err := g.issuer.Bundle(ctx)
	if err != nil {
		return err
	}
	if len(chain) == 0 || !bytes.Equal(chain[0].Raw, g.chain[0].Raw) || !now.Before(chain[0].NotAfter) {
		return errors.New("issuing CA changed or expired")
	}
	ku, err := asn1.Marshal(asn1.BitString{Bytes: []byte{0xa0}, BitLength: 3})
	if err != nil {
		return err
	}
	der, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject: g.ra.Subject, SignatureAlgorithm: x509.SHA256WithRSA,
		ExtraExtensions: []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 15}, Critical: true, Value: ku}},
	}, g.key)
	if err != nil {
		return err
	}
	csr, err := x509.ParseCertificateRequest(der)
	if err != nil {
		return err
	}
	// Distinct from initial issuance and stable across retries after write failures.
	hash := sha256.Sum256(g.ra.Raw)
	next, err := issue(ctx, csr, "scep:ra-renew:"+hex.EncodeToString(hash[:]))
	if err != nil {
		return err
	}
	if err := validateRA(next, chain[0], g.key.Public()); err != nil {
		return err
	}
	if !next.NotAfter.After(g.ra.NotAfter) {
		return errors.New("renewed RA certificate does not extend validity")
	}
	if err := checker.Active(ctx, next); err != nil {
		return err
	}
	previous := []*x509.Certificate{g.ra}
	for _, cert := range g.previousRA {
		if now.Before(cert.NotAfter) {
			previous = append(previous, cert)
		}
	}
	saved := state{KeyID: keyID, CertificatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: next.Raw}))}
	for _, cert := range previous {
		saved.PreviousCertificatesPEM = append(saved.PreviousCertificatesPEM, string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})))
	}
	if err := replaceRAState(path, saved); err != nil {
		return err
	}
	g.ra, g.previousRA = next, previous
	slog.Info("scep.ra.renew", "status", "success", "notAfter", next.NotAfter)
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
