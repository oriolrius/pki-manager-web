// Package config resolves the krl-client runtime configuration from three
// layered sources with the precedence:
//
//	flag  >  env KRL_CLIENT_*  >  config file  >  built-in default
//
// The ON-HOST PATH DEFAULTS are the canonical pki-manager locations defined in
// backend/src/services/ssh-config.ts (the single source of truth for on-host
// paths). Keeping them identical means the client, the generated 60-ssh-ca.conf
// sshd drop-in, and the Ansible role can never disagree — a host provisioned
// from that drop-in runs with only --server-url.
//
// Decryption is ALWAYS local (the host's own ecdsa key); there is no KMS mode.
package config

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// Canonical on-host defaults. These MUST stay in sync with the constants in
// backend/src/services/ssh-config.ts:
//
//	DefaultHostKey  = hostKeyPathFor('ecdsa-sha2-nistp256')  (ECIES decrypt key)
//	DefaultCAPubkey = HOST_CA_PATH                            (KRL signature trust anchor)
//	DefaultKRLFile  = REVOKED_KEYS_PATH                       (sshd RevokedKeys)
//
// A defaults test asserts these exact strings so a drift is caught in CI.
const (
	DefaultHostKey    = "/etc/ssh/ssh_host_ecdsa_key" // hostKeyPathFor('ecdsa-sha2-nistp256')
	DefaultCAPubkey   = "/etc/ssh/ssh-host-ca.pub"    // HOST_CA_PATH (BLK-10: composed KRLs are HOST-CA-signed)
	DefaultKRLFile    = "/etc/ssh/revoked_keys"       // REVOKED_KEYS_PATH
	DefaultStateDir   = "/var/lib/krl-client"
	DefaultConfigPath = "/etc/krl-client/config.yaml"
	DefaultTimeout    = 30 * time.Second
	DefaultRetries    = 3
	DefaultClockSkew  = 300 * time.Second
	DefaultLogFormat  = "text"
	// DefaultMaxResponseBytes caps the encrypted KRL response body. A per-host
	// ECIES-wrapped KRL is orders of magnitude smaller; the ceiling only exists to
	// stop a hostile/compromised endpoint from streaming an unbounded body into
	// memory (krl-client runs as root from cron/systemd).
	DefaultMaxResponseBytes = 8 << 20 // 8 MiB
)

// envPrefix is prepended to the UPPER_SNAKE_CASE of each flag name to form the
// environment-variable key, e.g. --server-url -> KRL_CLIENT_SERVER_URL.
const envPrefix = "KRL_CLIENT_"

type Config struct {
	ServerURL        string        // PKI-Manager base URL (required)
	HostID           string        // host FQDN sent in the body (default: `hostname -f`)
	Zone             string        // zone id/slug in the body; required only for an ambiguous FQDN across zones (decision-017 A2)
	HostKey          string        // host's ecdsa ECIES private key (local decrypt)
	KRLFile          string        // install target (sshd RevokedKeys)
	CAPubkey         string        // CA public key for detached-signature verify
	StateDir         string        // version/state cache
	CABundle         string        // TLS roots (PEM); empty = system roots
	Insecure         bool          // disable TLS verification (dev only)
	AllowUnsigned    bool          // install even when ca_signature is null
	Timeout          time.Duration // per-request timeout
	Retries          int           // network/5xx retries
	MaxResponseBytes int           // max accepted size (bytes) of the encrypted KRL response body
	ClockSkew        time.Duration // leeway when checking valid_until
	DryRun           bool          // fetch/decrypt but do not install

	// Observability + run-mode surface (behaviour wired in KRLC-09).
	Quiet     bool   // warnings+errors only (cron-friendly)
	Verbose   bool   // per-step debug detail
	LogFormat string // "text" | "json"
	Systemd   bool   // systemd integration (implies json, no ANSI)
	Oneshot   bool   // run one cycle and exit (current default behaviour)

	ConfigPath string // the config-file path that was consulted (informational)
}

// ErrVersionRequested is returned by Parse when --version is passed.
var ErrVersionRequested = errors.New("version requested")

// Parse resolves the configuration from args, the process environment, and the
// config file, applying the documented precedence. Validation failures return a
// coded *exitcodes.Error (exitcodes.Usage).
func Parse(args []string, version string) (*Config, error) {
	return parse(args, version, os.Getenv, os.ReadFile)
}

// parse is the injectable core: getenv and readFile are stubbed in tests so the
// precedence and file handling can be exercised hermetically.
func parse(args []string, version string, getenv func(string) string, readFile func(string) ([]byte, error)) (*Config, error) {
	fs := flag.NewFlagSet("krl-client", flag.ContinueOnError)
	raw := &Config{}
	var showVersion bool
	var configFlag string

	fs.StringVar(&raw.ServerURL, "server-url", "", "PKI-Manager base URL (required)")
	fs.StringVar(&raw.HostID, "host-id", "", "host FQDN in the request body (default: `hostname -f`)")
	fs.StringVar(&raw.Zone, "zone", "", "zone id or slug in the request body; needed only when this FQDN exists in more than one zone (decision-017)")
	fs.StringVar(&raw.HostKey, "host-key", DefaultHostKey, "host ecdsa ECIES private key (local decrypt)")
	fs.StringVar(&raw.KRLFile, "krl-file", DefaultKRLFile, "install target (sshd RevokedKeys)")
	fs.StringVar(&raw.CAPubkey, "ca-pubkey", DefaultCAPubkey, "CA public key for detached-signature verification")
	fs.StringVar(&raw.StateDir, "state-dir", DefaultStateDir, "version/state cache directory")
	fs.StringVar(&raw.CABundle, "ca-bundle", "", "TLS CA bundle (PEM); empty uses system roots")
	fs.BoolVar(&raw.Insecure, "insecure", false, "disable TLS certificate verification (DANGEROUS; dev only)")
	fs.BoolVar(&raw.AllowUnsigned, "allow-unsigned", false, "install even when the payload ca_signature is null")
	fs.DurationVar(&raw.Timeout, "timeout", DefaultTimeout, "per-request timeout")
	fs.IntVar(&raw.Retries, "retries", DefaultRetries, "retries on network errors / 5xx")
	fs.IntVar(&raw.MaxResponseBytes, "max-response-bytes", DefaultMaxResponseBytes, "maximum accepted size in bytes of the encrypted KRL response body")
	fs.DurationVar(&raw.ClockSkew, "clock-skew", DefaultClockSkew, "leeway when checking payload valid_until")
	fs.BoolVar(&raw.DryRun, "dry-run", false, "fetch/decrypt but do not write the KRL file")
	fs.BoolVar(&raw.Quiet, "quiet", false, "log warnings and errors only (cron-friendly)")
	fs.BoolVar(&raw.Verbose, "verbose", false, "log per-step debug detail")
	fs.StringVar(&raw.LogFormat, "log-format", DefaultLogFormat, "log format: text|json")
	fs.BoolVar(&raw.Systemd, "systemd", false, "systemd integration (implies --log-format=json, no ANSI)")
	fs.BoolVar(&raw.Oneshot, "oneshot", false, "run one cycle and exit (current default behaviour)")
	fs.StringVar(&configFlag, "config", DefaultConfigPath, "config file path (flat YAML)")
	fs.BoolVar(&showVersion, "version", false, "print version and exit")

	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if showVersion {
		return nil, ErrVersionRequested
	}

	// Which flags did the user set explicitly? Only those override lower layers.
	set := map[string]bool{}
	fs.Visit(func(f *flag.Flag) { set[f.Name] = true })

	// Resolve the config-file path first (flag > env > default), then load it.
	configPath := DefaultConfigPath
	explicit := false
	if v := getenv(envPrefix + "CONFIG"); v != "" {
		configPath, explicit = v, true
	}
	if set["config"] {
		configPath, explicit = configFlag, true
	}
	file, err := loadConfigFile(readFile, configPath, explicit)
	if err != nil {
		return nil, exitcodes.New(exitcodes.Usage, "%v", err)
	}

	var errs []string
	addErr := func(format string, a ...any) { errs = append(errs, fmt.Sprintf(format, a...)) }

	// Layered resolvers: flag (if set) > env > config file > default.
	str := func(name, key, flagVal, def string) string {
		if set[name] {
			return flagVal
		}
		if v := getenv(envKey(name)); v != "" {
			return v
		}
		if v, ok := file[key]; ok {
			return v
		}
		return def
	}
	boolean := func(name, key string, flagVal, def bool) bool {
		if set[name] {
			return flagVal
		}
		if v := getenv(envKey(name)); v != "" {
			return parseBool(v, "env "+envKey(name), def, addErr)
		}
		if v, ok := file[key]; ok {
			return parseBool(v, "config "+key, def, addErr)
		}
		return def
	}
	dur := func(name, key string, flagVal, def time.Duration) time.Duration {
		if set[name] {
			return flagVal
		}
		if v := getenv(envKey(name)); v != "" {
			return parseDur(v, "env "+envKey(name), def, addErr)
		}
		if v, ok := file[key]; ok {
			return parseDur(v, "config "+key, def, addErr)
		}
		return def
	}
	integer := func(name, key string, flagVal, def int) int {
		if set[name] {
			return flagVal
		}
		if v := getenv(envKey(name)); v != "" {
			return parseInt(v, "env "+envKey(name), def, addErr)
		}
		if v, ok := file[key]; ok {
			return parseInt(v, "config "+key, def, addErr)
		}
		return def
	}
	provided := func(name, key string) bool {
		if set[name] || getenv(envKey(name)) != "" {
			return true
		}
		_, ok := file[key]
		return ok
	}

	cfg := &Config{
		ConfigPath:       configPath,
		ServerURL:        str("server-url", "server-url", raw.ServerURL, ""),
		HostID:           str("host-id", "host-id", raw.HostID, ""),
		Zone:             str("zone", "zone", raw.Zone, ""),
		HostKey:          str("host-key", "host-key", raw.HostKey, DefaultHostKey),
		KRLFile:          str("krl-file", "krl-file", raw.KRLFile, DefaultKRLFile),
		CAPubkey:         str("ca-pubkey", "ca-pubkey", raw.CAPubkey, DefaultCAPubkey),
		StateDir:         str("state-dir", "state-dir", raw.StateDir, DefaultStateDir),
		CABundle:         str("ca-bundle", "ca-bundle", raw.CABundle, ""),
		Insecure:         boolean("insecure", "insecure", raw.Insecure, false),
		AllowUnsigned:    boolean("allow-unsigned", "allow-unsigned", raw.AllowUnsigned, false),
		Timeout:          dur("timeout", "timeout", raw.Timeout, DefaultTimeout),
		Retries:          integer("retries", "retries", raw.Retries, DefaultRetries),
		MaxResponseBytes: integer("max-response-bytes", "max-response-bytes", raw.MaxResponseBytes, DefaultMaxResponseBytes),
		ClockSkew:        dur("clock-skew", "clock-skew", raw.ClockSkew, DefaultClockSkew),
		DryRun:           boolean("dry-run", "dry-run", raw.DryRun, false),
		Quiet:            boolean("quiet", "quiet", raw.Quiet, false),
		Verbose:          boolean("verbose", "verbose", raw.Verbose, false),
		LogFormat:        str("log-format", "log-format", raw.LogFormat, DefaultLogFormat),
		Systemd:          boolean("systemd", "systemd", raw.Systemd, false),
		Oneshot:          boolean("oneshot", "oneshot", raw.Oneshot, false),
	}

	// host-id defaults to the machine FQDN (`hostname -f`) only when no source set it.
	if cfg.HostID == "" {
		cfg.HostID = defaultHostID()
	}

	// --systemd forces json logging (KRLC-09); a conflicting explicit format is an error.
	if cfg.Systemd {
		if provided("log-format", "log-format") && cfg.LogFormat != "json" {
			addErr("--systemd forces json logs but --log-format=%s was requested", cfg.LogFormat)
		} else {
			cfg.LogFormat = "json"
		}
	}

	// Required fields + mutually-exclusive flags.
	if strings.TrimSpace(cfg.ServerURL) == "" {
		addErr("--server-url is required (or set %sSERVER_URL, or server-url: in the config file)", envPrefix)
	}
	if strings.TrimSpace(cfg.HostID) == "" {
		addErr("--host-id is empty and could not be derived from `hostname -f`; set --host-id or %sHOST_ID", envPrefix)
	}
	if cfg.LogFormat != "text" && cfg.LogFormat != "json" {
		addErr("--log-format %q is invalid (want text|json)", cfg.LogFormat)
	}
	if cfg.Quiet && cfg.Verbose {
		addErr("--quiet and --verbose are mutually exclusive")
	}
	if cfg.Insecure && cfg.CABundle != "" {
		addErr("--insecure and --ca-bundle are mutually exclusive (--insecure disables all TLS verification)")
	}
	if cfg.Retries < 0 {
		addErr("--retries must be >= 0 (got %d)", cfg.Retries)
	}
	if cfg.MaxResponseBytes <= 0 {
		addErr("--max-response-bytes must be > 0 (got %d)", cfg.MaxResponseBytes)
	}
	if cfg.Timeout <= 0 {
		addErr("--timeout must be > 0 (got %s)", cfg.Timeout)
	}
	if cfg.ClockSkew < 0 {
		addErr("--clock-skew must be >= 0 (got %s)", cfg.ClockSkew)
	}

	if len(errs) > 0 {
		return nil, exitcodes.New(exitcodes.Usage, "invalid configuration: %s", strings.Join(errs, "; "))
	}
	return cfg, nil
}

// envKey maps a kebab-case flag name to its KRL_CLIENT_ env var, e.g.
// "server-url" -> "KRL_CLIENT_SERVER_URL".
func envKey(flagName string) string {
	return envPrefix + strings.ToUpper(strings.ReplaceAll(flagName, "-", "_"))
}

func parseBool(v, src string, def bool, addErr func(string, ...any)) bool {
	b, err := strconv.ParseBool(strings.TrimSpace(v))
	if err != nil {
		addErr("%s=%q is not a boolean", src, v)
		return def
	}
	return b
}

func parseInt(v, src string, def int, addErr func(string, ...any)) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		addErr("%s=%q is not an integer", src, v)
		return def
	}
	return n
}

func parseDur(v, src string, def time.Duration, addErr func(string, ...any)) time.Duration {
	d, err := time.ParseDuration(strings.TrimSpace(v))
	if err != nil {
		addErr("%s=%q is not a duration (e.g. 30s, 5m)", src, v)
		return def
	}
	return d
}

// defaultHostID mirrors `hostname -f`: the canonical FQDN the operator expects
// to appear in the request body. Falls back to os.Hostname() (short name) when
// the command is unavailable or fails.
func defaultHostID() string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "hostname", "-f").Output(); err == nil {
		if fqdn := strings.TrimSpace(string(out)); fqdn != "" {
			return fqdn
		}
	}
	if h, err := os.Hostname(); err == nil {
		return h
	}
	return ""
}
