package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/smallstep/pkcs7"
)

type state struct {
	CertificatePEM          string   `json:"certificatePem"`
	PreviousCertificatesPEM []string `json:"previousCertificatesPem,omitempty"`
}

func secret(name string) (string, error) {
	if path := os.Getenv(name + "_FILE"); path != "" {
		if os.Getenv(name) != "" {
			return "", fmt.Errorf("set only %s or %s_FILE", name, name)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(b)), nil
	}
	return os.Getenv(name), nil
}
func setting(name, defaultValue string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return defaultValue
}
func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	if err := run(); err != nil {
		slog.Error("scep stopped", "error", err.Error())
		os.Exit(1)
	}
}
func run() error {
	mode := "serve"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	if mode != "serve" && mode != "provision" {
		return errors.New("usage: scep-server [serve|provision]")
	}
	autoProvision, err := strconv.ParseBool(setting("SCEP_AUTO_PROVISION", "false"))
	if err != nil {
		return errors.New("SCEP_AUTO_PROVISION must be a boolean")
	}
	autoRenew, err := strconv.ParseBool(setting("SCEP_RA_AUTO_RENEW", "true"))
	if err != nil {
		return errors.New("SCEP_RA_AUTO_RENEW must be a boolean")
	}
	token, err := secret("SCEP_BACKEND_TOKEN")
	if err != nil {
		return err
	}
	if token == "" {
		return errors.New("SCEP_BACKEND_TOKEN or _FILE is required")
	}
	days, err := strconv.Atoi(setting("SCEP_VALIDITY_DAYS", "90"))
	if err != nil || days < 1 || days > 90 {
		return errors.New("SCEP_VALIDITY_DAYS must be 1..90")
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirects are refused") }}
	backendURL := setting("SCEP_BACKEND_URL", "http://127.0.0.1:52081")
	if err := validateBackendURL(backendURL); err != nil {
		return err
	}
	b := &backend{url: backendURL, token: token, days: days, client: client}
	chain, err := b.Bundle(context.Background())
	if err != nil {
		return err
	}
	if !chain[0].IsCA || time.Now().Before(chain[0].NotBefore) || !time.Now().Before(chain[0].NotAfter) {
		return errors.New("issuing CA is invalid or expired")
	}
	path := setting("SCEP_STATE_FILE", "./data/ra.json")
	var saved state
	// Provision is idempotent and resumes an expired incomplete lease. Do not
	// gate it on RAState=404: interrupted state deliberately returns 409.
	if autoProvision || mode == "provision" {
		saved, err = b.RAProvision(context.Background())
	} else {
		saved, err = b.RAState(context.Background())
	}
	if err != nil {
		return err
	}
	if autoRenew && mode != "provision" {
		saved, err = startupRARenew(context.Background(), saved, chain[0], b.RARenew)
		if err != nil {
			return err
		}
	}
	certs, err := parsePEMCerts(saved.CertificatePEM)
	if err != nil {
		return err
	}
	ra := certs[0]
	pub, ok := ra.PublicKey.(*rsa.PublicKey)
	if !ok {
		return errors.New("RA key is not RSA")
	}
	key := &backendKey{backend: b, public: pub}
	if err = validateRA(ra, chain[0], key.Public()); err != nil {
		return err
	}
	if err = keyCheck(key); err != nil {
		return err
	}
	if err = b.Active(context.Background(), ra); err != nil {
		return errors.New("RA is not active or is not owned by this backend service identity")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	if err := replaceRAState(path, saved); err != nil {
		return err
	}
	if mode == "provision" {
		return nil
	}
	authorizer, challenge, err := configuredAuthorization(client)
	if err != nil {
		return err
	}
	var startRevocationPolling func()
	if intune, ok := authorizer.(*intuneAuthorizer); ok {
		binding := sha256.New()
		_, _ = binding.Write(chain[0].Raw)
		_, _ = binding.Write([]byte(token))
		intune.authorityID = hex.EncodeToString(binding.Sum(nil))
		if _, err := intune.discover(context.Background()); err != nil {
			return err
		}
		if _, err := intune.token(context.Background(), intuneScope); err != nil {
			return err
		}
		interval, err := strconv.Atoi(setting("SCEP_INTUNE_REVOCATION_POLL_SECONDS", "60"))
		if err != nil || (interval != 0 && (interval < 30 || interval > 86400)) {
			return errors.New("Intune revocation poll interval must be 0 or 30..86400 seconds")
		}
		if interval > 0 {
			if _, err := intune.discoverService(context.Background(), revocationService); err != nil {
				return err
			}
			journal := setting("SCEP_INTUNE_REVOCATION_STATE_FILE", filepath.Join(filepath.Dir(path), "intune-revocations.json"))
			startRevocationPolling = func() {
				go func() {
					ticker := time.NewTicker(time.Duration(interval) * time.Second)
					defer ticker.Stop()
					for {
						ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
						pollErr := intune.pollRevocations(ctx, b, chain[0].Subject.String(), journal)
						cancel()
						if pollErr != nil {
							slog.Error("scep.intune.revocations", "status", "failure", "error", pollErr.Error())
						}
						<-ticker.C
					}
				}()
			}
		}
	}
	pkcs7.ContentEncryptionAlgorithm = pkcs7.EncryptionAlgorithmAES256CBC
	g := newGateway(b, ra, key, key, chain, challenge)
	g.authorizer = authorizer
	g.sharedSubject, err = sharedSubjectConfig(os.Getenv("SCEP_SHARED_SUBJECT"))
	if err != nil {
		return err
	}
	b.protectedRA = g.isRASerial
	for _, encoded := range saved.PreviousCertificatesPEM {
		previous, err := parsePEMCerts(encoded)
		if err != nil {
			return errors.New("invalid previous RA state")
		}
		if time.Now().Before(previous[0].NotAfter) {
			if err := validateRA(previous[0], chain[0], key.Public()); err != nil {
				return err
			}
			g.previousRA = append(g.previousRA, previous[0])
		}
	}
	if autoRenew {
		renew := func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			if err := g.renewRA(ctx, path, b.RARenew); err != nil {
				slog.Error("scep.ra.renew", "status", "failure", "error", err.Error())
			}
		}
		renew()
		go func() {
			ticker := time.NewTicker(time.Hour)
			defer ticker.Stop()
			for range ticker.C {
				renew()
			}
		}()
	}
	if startRevocationPolling != nil {
		startRevocationPolling()
	}
	server := &http.Server{Addr: setting("SCEP_LISTEN", ":8085"), Handler: g, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 180 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
	slog.Info("scep listening", "address", server.Addr)
	return server.ListenAndServe()
}

func keyCheck(k *backendKey) error {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return err
	}
	hash := sha256.Sum256(data)
	sig, err := k.Sign(rand.Reader, hash[:], crypto.SHA256)
	if err != nil {
		return err
	}
	if err = rsa.VerifyPKCS1v15(k.public, crypto.SHA256, hash[:], sig); err != nil {
		return errors.New("backend RA signing self-test failed")
	}
	encrypted, err := rsa.EncryptPKCS1v15(rand.Reader, k.public, data)
	if err != nil {
		return err
	}
	plain, err := k.Decrypt(rand.Reader, encrypted, nil)
	if err != nil {
		return err
	}
	if string(plain) != string(data) {
		return errors.New("backend RA decryption self-test failed")
	}
	return nil
}

// A temporary renewal outage must not crash a gateway with a valid current RA.
func startupRARenew(ctx context.Context, saved state, ca *x509.Certificate, renew func(context.Context) (state, error)) (state, error) {
	next, err := renew(ctx)
	if err == nil {
		return next, nil
	}
	certs, parseErr := parsePEMCerts(saved.CertificatePEM)
	if parseErr != nil || validateRA(certs[0], ca, certs[0].PublicKey) != nil {
		return state{}, err
	}
	slog.Warn("scep.ra.renew", "status", "deferred", "error", err.Error())
	return saved, nil
}
