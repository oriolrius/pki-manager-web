package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
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
	KeyID          string `json:"keyId"`
	CertificatePEM string `json:"certificatePem"`
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
	token, err := secret("SCEP_BACKEND_TOKEN")
	if err != nil {
		return err
	}
	if token == "" {
		return errors.New("SCEP_BACKEND_TOKEN or _FILE is required")
	}
	kmsToken, err := secret("SCEP_KMS_API_KEY")
	if err != nil {
		return err
	}
	days, err := strconv.Atoi(setting("SCEP_VALIDITY_DAYS", "90"))
	if err != nil || days < 1 || days > 365 {
		return errors.New("SCEP_VALIDITY_DAYS must be 1..365")
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirects are refused") }}
	b := &backend{url: setting("SCEP_BACKEND_URL", "http://127.0.0.1:52081"), token: token, days: days, client: client}
	chain, err := b.Bundle(context.Background())
	if err != nil {
		return err
	}
	if !chain[0].IsCA || time.Now().Before(chain[0].NotBefore) || !time.Now().Before(chain[0].NotAfter) {
		return errors.New("issuing CA is invalid or expired")
	}
	key := &kmsKey{url: setting("SCEP_KMS_URL", "http://127.0.0.1:42998"), token: kmsToken, client: client}
	path := setting("SCEP_STATE_FILE", "./data/ra.json")
	if mode == "provision" {
		err := provision(b, key, chain[0], path)
		if err != nil {
			slog.Error("scep.provision", "status", "failure")
		}
		return err
	}
	encoded, err := os.ReadFile(path)
	if err != nil {
		return errors.New("RA state missing; run provision first")
	}
	var saved state
	if err = json.Unmarshal(encoded, &saved); err != nil {
		return errors.New("invalid RA state")
	}
	certs, err := parsePEMCerts(saved.CertificatePEM)
	if err != nil {
		return err
	}
	ra := certs[0]
	key.id = saved.KeyID
	pub, ok := ra.PublicKey.(*rsa.PublicKey)
	if !ok {
		return errors.New("RA key is not RSA")
	}
	key.public = pub
	if err = validateRA(ra, chain[0], key.Public()); err != nil {
		return err
	}
	if err = keyCheck(key); err != nil {
		return err
	}
	if err = b.Active(context.Background(), ra); err != nil {
		return errors.New("RA is not active or is not owned by this backend service identity")
	}
	authorizer, challenge, err := configuredAuthorization(client)
	if err != nil {
		return err
	}
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
	pkcs7.ContentEncryptionAlgorithm = pkcs7.EncryptionAlgorithmAES256CBC
	g := newGateway(b, ra, key, key, chain, challenge)
	g.authorizer = authorizer
	server := &http.Server{Addr: setting("SCEP_LISTEN", ":8085"), Handler: g, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 180 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
	slog.Info("scep listening", "address", server.Addr)
	return server.ListenAndServe()
}
func keyCheck(k *kmsKey) error {
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
		return errors.New("KMS signing self-test failed")
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
		return errors.New("KMS decryption self-test failed")
	}
	return nil
}
func provision(b *backend, k *kmsKey, ca *x509.Certificate, path string) error {
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		return errors.New("refusing to overwrite RA state")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	if err := k.create(); err != nil {
		return err
	}
	if err := keyCheck(k); err != nil {
		return err
	}
	// These are public RA extensions. The private key stays Sensitive in the KMS.
	ku, err := asn1.Marshal(asn1.BitString{Bytes: []byte{0xa0}, BitLength: 3})
	if err != nil {
		return err
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: "SCEP Registration Authority"}, SignatureAlgorithm: x509.SHA256WithRSA, ExtraExtensions: []pkix.Extension{{Id: asn1.ObjectIdentifier{2, 5, 29, 15}, Critical: true, Value: ku}}}, k)
	if err != nil {
		return err
	}
	csr, err := x509.ParseCertificateRequest(csrDER)
	if err != nil {
		return err
	}
	cert, err := b.Issue(context.Background(), csr)
	if err != nil {
		return err
	}
	if err = validateRA(cert, ca, k.Public()); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state{KeyID: k.id, CertificatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw}))}, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	slog.Info("scep.provision", "status", "success", "stateFile", path)
	return nil
}
