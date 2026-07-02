// Package app orchestrates the run. This is the KRLC-01/03/04 slice: fetch (with
// If-None-Match) -> local decrypt. Payload validation (KRLC-05), CA-signature
// verification (KRLC-06), atomic install + state cache (KRLC-07), the full CLI
// (KRLC-08) and structured logging (KRLC-09) extend this pipeline.
package app

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/oriolrius/pki-manager-krl-client/internal/config"
	"github.com/oriolrius/pki-manager-krl-client/internal/decrypt"
	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
	"github.com/oriolrius/pki-manager-krl-client/internal/krlclient"
	"github.com/oriolrius/pki-manager-krl-client/internal/payload"
)

func Run(cfg *config.Config) exitcodes.Code {
	ctx, cancel := context.WithTimeout(context.Background(), cfg.Timeout)
	defer cancel()

	client, err := krlclient.New(cfg.ServerURL, cfg.CABundle, cfg.Insecure, cfg.Timeout, cfg.Retries)
	if err != nil {
		return report(err)
	}

	// TODO(KRLC-07): read the cached krl_version from --state-dir to send as If-None-Match.
	res, err := client.FetchKRL(ctx, cfg.HostID, "")
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
	// TODO(KRLC-07): read the installed krl_number from --state-dir for anti-rollback.
	if err := p.Validate(cfg.HostID, res.Version, 0, time.Now(), cfg.ClockSkew); err != nil {
		return report(err)
	}

	// TODO(KRLC-06/07): verify the detached CA signature over p.KRL, then atomically
	// install p.KRL to --krl-file (0444 root:root) and persist state.
	fmt.Fprintf(os.Stderr, "krl-client: validated KRL version=%s number=%d (%d bytes)\n", p.Version, p.Number, len(p.KRL))
	if cfg.DryRun {
		_, _ = os.Stdout.Write(p.KRL)
	}
	return exitcodes.OK
}

func report(err error) exitcodes.Code {
	var ce *exitcodes.Error
	if e, ok := err.(*exitcodes.Error); ok {
		ce = e
	}
	if ce != nil {
		fmt.Fprintln(os.Stderr, "krl-client:", ce.Msg)
		return ce.Code
	}
	fmt.Fprintln(os.Stderr, "krl-client:", err)
	return exitcodes.Usage
}
