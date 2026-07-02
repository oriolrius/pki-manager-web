// Package config parses krl-client flags into a Config. On-host path defaults are
// the canonical pki-manager locations (backend ssh-config.ts): a host provisioned
// from the generated 60-ssh-ca.conf drop-in runs with only --server-url.
//
// NOTE: this is the KRLC-01/03/04 subset (flags only). KRLC-08 adds env
// (KRL_CLIENT_*) + config-file precedence, the remaining flags, and full
// validation; KRLC-09 adds the --log-format/--quiet/--verbose surface.
package config

import (
	"errors"
	"flag"
	"os"
	"time"
)

type Config struct {
	ServerURL     string        // PKI-Manager base URL (required)
	HostID        string        // host FQDN sent in the body (default: hostname)
	HostKey       string        // host's ecdsa ECIES private key (local decrypt)
	KRLFile       string        // install target (sshd RevokedKeys)
	CAPubkey      string        // CA public key for detached-signature verify
	StateDir      string        // version/state cache
	CABundle      string        // TLS roots (PEM); empty = system roots
	Insecure      bool          // disable TLS verification (dev only)
	AllowUnsigned bool          // install even when ca_signature is null
	Timeout       time.Duration // per-request timeout
	Retries       int           // network/5xx retries
	ClockSkew     time.Duration // leeway when checking valid_until
	DryRun        bool          // fetch/decrypt but do not install
}

// ErrVersionRequested is returned by Parse when --version is passed.
var ErrVersionRequested = errors.New("version requested")

func Parse(args []string, version string) (*Config, error) {
	fs := flag.NewFlagSet("krl-client", flag.ContinueOnError)
	cfg := &Config{}
	var showVersion bool

	fs.StringVar(&cfg.ServerURL, "server-url", "", "PKI-Manager base URL (required)")
	fs.StringVar(&cfg.HostID, "host-id", "", "host FQDN in the request body (default: hostname)")
	fs.StringVar(&cfg.HostKey, "host-key", "/etc/ssh/ssh_host_ecdsa_key", "host ecdsa ECIES private key (local decrypt)")
	fs.StringVar(&cfg.KRLFile, "krl-file", "/etc/ssh/revoked_keys", "install target (sshd RevokedKeys)")
	fs.StringVar(&cfg.CAPubkey, "ca-pubkey", "/etc/ssh/ssh-user-ca.pub", "CA public key for detached-signature verification")
	fs.StringVar(&cfg.StateDir, "state-dir", "/var/lib/krl-client", "version/state cache directory")
	fs.StringVar(&cfg.CABundle, "ca-bundle", "", "TLS CA bundle (PEM); empty uses system roots")
	fs.BoolVar(&cfg.Insecure, "insecure", false, "disable TLS certificate verification (DANGEROUS; dev only)")
	fs.BoolVar(&cfg.AllowUnsigned, "allow-unsigned", false, "install even when the payload ca_signature is null")
	fs.DurationVar(&cfg.Timeout, "timeout", 30*time.Second, "per-request timeout")
	fs.IntVar(&cfg.Retries, "retries", 3, "retries on network errors / 5xx")
	fs.DurationVar(&cfg.ClockSkew, "clock-skew", 300*time.Second, "leeway when checking payload valid_until")
	fs.BoolVar(&cfg.DryRun, "dry-run", false, "fetch/decrypt but do not write the KRL file")
	fs.BoolVar(&showVersion, "version", false, "print version and exit")

	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if showVersion {
		return nil, ErrVersionRequested
	}
	if cfg.HostID == "" {
		cfg.HostID = defaultHostID()
	}
	return cfg, nil
}

// defaultHostID resolves the host FQDN, best-effort (KRLC-08 hardens FQDN lookup).
func defaultHostID() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	return h
}
