// Package app orchestrates the full run (KRLC-01..07): read state -> fetch (with
// If-None-Match from the cached version) -> 304 short-circuit -> local decrypt ->
// parse + validate (host/expiry/version/anti-rollback) -> verify CA signature ->
// atomic install -> persist state. KRLC-08 adds the env/config surface and KRLC-09
// structured logging on top of this pipeline.
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/config"
	"github.com/oriolrius/pki-manager-krl-client/internal/decrypt"
	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
	"github.com/oriolrius/pki-manager-krl-client/internal/installer"
	"github.com/oriolrius/pki-manager-krl-client/internal/krlclient"
	"github.com/oriolrius/pki-manager-krl-client/internal/payload"
	"github.com/oriolrius/pki-manager-krl-client/internal/state"
	"github.com/oriolrius/pki-manager-krl-client/internal/verify"
)

func Run(cfg *config.Config) exitcodes.Code {
	ctx, cancel := context.WithTimeout(context.Background(), cfg.Timeout)
	defer cancel()

	client, err := krlclient.New(cfg.ServerURL, cfg.CABundle, cfg.Insecure, cfg.Timeout, cfg.Retries)
	if err != nil {
		return report(err)
	}

	st, err := state.Read(cfg.StateDir)
	if err != nil {
		return report(err)
	}

	// Conditional fetch: the cached krl_version is the If-None-Match token.
	res, err := client.FetchKRL(ctx, cfg.HostID, st.Version)
	if err != nil {
		return report(err)
	}
	if res.NotModified {
		fmt.Fprintf(os.Stderr, "krl-client: up-to-date (304), version=%s\n", res.Version)
		return exitcodes.OK
	}

	priv, err := decrypt.LoadHostKey(cfg.HostKey)
	if err != nil {
		return report(err)
	}
	plaintext, err := decrypt.Open(priv, res.Body)
	if err != nil {
		return report(err)
	}

	p, err := payload.Parse(plaintext)
	if err != nil {
		return report(err)
	}
	if err := p.Validate(cfg.HostID, res.Version, st.Number, time.Now(), cfg.ClockSkew); err != nil {
		return report(err)
	}
	if err := verify.Check(cfg.CAPubkey, p.KRL, p.CASig, cfg.AllowUnsigned); err != nil {
		return report(err)
	}

	if cfg.DryRun {
		fmt.Fprintf(os.Stderr, "krl-client: dry-run — would install KRL version=%s number=%d (%d bytes) -> %s\n",
			p.Version, p.Number, len(p.KRL), cfg.KRLFile)
		return exitcodes.OK
	}

	if err := installer.Install(cfg.KRLFile, p.KRL); err != nil {
		return report(err)
	}
	sum := sha256.Sum256(p.KRL)
	if err := state.Write(cfg.StateDir, &state.State{
		Version:   p.Version,
		Number:    p.Number,
		SHA256:    hex.EncodeToString(sum[:]),
		UpdatedAt: time.Now().Unix(),
	}); err != nil {
		return report(err)
	}
	fmt.Fprintf(os.Stderr, "krl-client: installed KRL version=%s number=%d (%d bytes) -> %s\n",
		p.Version, p.Number, len(p.KRL), cfg.KRLFile)
	return exitcodes.OK
}

func report(err error) exitcodes.Code {
	if ce, ok := err.(*exitcodes.Error); ok {
		fmt.Fprintln(os.Stderr, "krl-client:", ce.Msg)
		return ce.Code
	}
	fmt.Fprintln(os.Stderr, "krl-client:", err)
	return exitcodes.Usage
}
