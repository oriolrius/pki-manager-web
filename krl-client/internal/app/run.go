// Package app orchestrates the full run (KRLC-01..07): read state -> fetch (with
// If-None-Match from the cached version) -> 304 short-circuit -> local decrypt ->
// parse + validate (host/expiry/version/anti-rollback) -> verify CA signature ->
// atomic install -> persist state. KRLC-08 adds the env/config surface and KRLC-09
// the structured logging + run observability on top of this pipeline.
//
// OBSERVABILITY CONTRACT (KRLC-09): every run emits exactly ONE structured
// "run_summary" event carrying outcome (up_to_date|updated|error), http_status,
// krl_version, host_id, and exit_code — at Info level on success (suppressed by
// --quiet) or at Error level on failure (always surfaces). Per-step progress is
// logged at Debug (only under --verbose). Secret material — the host key, the
// ECIES ciphertext, and the decrypted payload — is NEVER logged; step events
// carry only redacted metadata (byte lengths, versions, counts).
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/config"
	"github.com/oriolrius/pki-manager-krl-client/internal/decrypt"
	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
	"github.com/oriolrius/pki-manager-krl-client/internal/installer"
	"github.com/oriolrius/pki-manager-krl-client/internal/krlclient"
	"github.com/oriolrius/pki-manager-krl-client/internal/logx"
	"github.com/oriolrius/pki-manager-krl-client/internal/payload"
	"github.com/oriolrius/pki-manager-krl-client/internal/state"
	"github.com/oriolrius/pki-manager-krl-client/internal/verify"
)

// Run outcomes (the closed set carried by the run_summary event).
const (
	outcomeUpToDate = "up_to_date" // 304 — the host already holds the current KRL
	outcomeUpdated  = "updated"    // a newer KRL was verified and installed (or dry-run validated)
	outcomeError    = "error"      // any terminal failure
)

// Run executes one KRL refresh cycle and returns the process exit code, emitting
// the run_summary event and per-step debug events described in the package doc.
func Run(cfg *config.Config) exitcodes.Code {
	log := logx.New(logx.Options{Format: cfg.LogFormat, Quiet: cfg.Quiet, Verbose: cfg.Verbose})
	return run(cfg, log)
}

// run is the injectable core: tests pass a logger writing to a buffer so the
// emitted events can be scanned (including for the absence of secrets).
func run(cfg *config.Config, log *slog.Logger) exitcodes.Code {
	s := &summary{outcome: outcomeError, hostID: cfg.HostID, dryRun: cfg.DryRun}
	s.code = s.execute(cfg, log)
	s.emit(log)
	return s.code
}

// summary accumulates the fields of the single run_summary event as the pipeline
// progresses; emit() writes it once at the end of the run.
type summary struct {
	outcome    string
	httpStatus int
	krlVersion string
	krlNumber  int64
	hostID     string
	dryRun     bool
	code       exitcodes.Code
	err        error
}

// fail records a terminal error and derives the exit code from it.
func (s *summary) fail(err error) exitcodes.Code {
	s.outcome = outcomeError
	s.err = err
	if ce, ok := err.(*exitcodes.Error); ok {
		return ce.Code
	}
	return exitcodes.Usage
}

// execute runs the pipeline, mutating s along the way and returning the exit code.
func (s *summary) execute(cfg *config.Config, log *slog.Logger) exitcodes.Code {
	ctx, cancel := context.WithTimeout(context.Background(), cfg.Timeout)
	defer cancel()

	// Surface a disabled-TLS run on EVERY cycle. Warn level so it appears even
	// under --quiet (which keeps warnings and errors) — an operator must never
	// silently run without verifying the server's identity.
	if cfg.Insecure {
		log.Warn("TLS certificate verification is DISABLED (--insecure) — the server's identity is not verified; use only in development",
			"event", "insecure_tls", "insecure", true)
	}

	log.Debug("run starting", "host_id", cfg.HostID, "server_url", cfg.ServerURL,
		"krl_file", cfg.KRLFile, "dry_run", cfg.DryRun)

	client, err := krlclient.New(cfg.ServerURL, cfg.CABundle, cfg.Insecure, cfg.Timeout, cfg.Retries)
	if err != nil {
		return s.fail(err)
	}
	client.SetMaxResponseBytes(int64(cfg.MaxResponseBytes))

	st, err := state.Read(cfg.StateDir)
	if err != nil {
		return s.fail(err)
	}
	// Seed the summary with the last-known installed number so EVERY terminal
	// path (304 up_to_date, error) reports what is actually on the host, not 0.
	// The 200 install path overwrites this with p.Number below. 0 now means
	// "nothing installed" iff state.json has no number — matching the README.
	s.krlNumber = st.Number
	log.Debug("state loaded", "installed_version", st.Version, "installed_number", st.Number)

	// Conditional fetch: the cached krl_version is the If-None-Match token.
	res, err := client.FetchKRL(ctx, cfg.HostID, st.Version)
	if err != nil {
		return s.fail(err)
	}
	s.httpStatus = res.Status
	s.krlVersion = res.Version
	log.Debug("fetch complete", "http_status", res.Status,
		"not_modified", res.NotModified, "krl_version", res.Version)

	if res.NotModified {
		s.outcome = outcomeUpToDate
		return exitcodes.OK
	}

	priv, err := decrypt.LoadHostKey(cfg.HostKey)
	if err != nil {
		return s.fail(err)
	}
	plaintext, err := decrypt.Open(priv, res.Body, cfg.HostKey)
	if err != nil {
		return s.fail(err)
	}
	log.Debug("payload decrypted", "plaintext_bytes", len(plaintext)) // length only — never the plaintext

	p, err := payload.Parse(plaintext)
	if err != nil {
		return s.fail(err)
	}
	if err := p.Validate(cfg.HostID, res.Version, st.Number, time.Now(), cfg.ClockSkew); err != nil {
		return s.fail(err)
	}
	if s.krlVersion == "" {
		s.krlVersion = p.Version
	}
	s.krlNumber = p.Number
	log.Debug("payload validated", "krl_version", p.Version, "krl_number", p.Number, "krl_bytes", len(p.KRL))

	if err := verify.Check(cfg.CAPubkey, p.KRL, p.CASig, cfg.AllowUnsigned); err != nil {
		return s.fail(err)
	}
	log.Debug("signature verified", "signed", p.CASig != nil, "allow_unsigned", cfg.AllowUnsigned)

	if cfg.DryRun {
		s.outcome = outcomeUpdated
		log.Debug("dry-run — install skipped", "krl_file", cfg.KRLFile, "krl_bytes", len(p.KRL))
		return exitcodes.OK
	}

	if err := installer.Install(cfg.KRLFile, p.KRL); err != nil {
		return s.fail(err)
	}
	sum := sha256.Sum256(p.KRL)
	if err := state.Write(cfg.StateDir, &state.State{
		Version:   p.Version,
		Number:    p.Number,
		SHA256:    hex.EncodeToString(sum[:]),
		UpdatedAt: time.Now().Unix(),
	}); err != nil {
		return s.fail(err)
	}
	s.outcome = outcomeUpdated
	log.Debug("krl installed", "krl_file", cfg.KRLFile, "krl_version", p.Version, "krl_bytes", len(p.KRL))
	return exitcodes.OK
}

// emit writes the single run_summary event: Error level on failure (surfaces
// even under --quiet), Info otherwise (suppressed by --quiet, cron-friendly).
func (s *summary) emit(log *slog.Logger) {
	attrs := []any{
		"event", "run_summary",
		"outcome", s.outcome,
		"http_status", s.httpStatus,
		"krl_version", s.krlVersion,
		"krl_number", s.krlNumber,
		"host_id", s.hostID,
		"dry_run", s.dryRun,
		"exit_code", int(s.code),
	}
	if s.outcome == outcomeError {
		if s.err != nil {
			attrs = append(attrs, "error", s.err.Error())
		}
		log.Error("run complete", attrs...)
		return
	}
	log.Info("run complete", attrs...)
}
