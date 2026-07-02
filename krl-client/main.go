// Command krl-client keeps a host's /etc/ssh/revoked_keys (OpenSSH RevokedKeys /
// KRL) current: it POSTs the encrypted per-host endpoint, decrypts the payload
// LOCALLY with the host's own ecdsa host key, verifies the CA signature, and
// atomically installs the KRL. Normally run from crontab or a systemd timer.
//
// The optional `keygen` subcommand generates a DEDICATED ECIES key for operators
// who prefer not to reuse the SSH host key (see internal/keygen).
//
// This is the flat-layout module root (mirrors k8s/issuer/main.go): flags/config
// live in internal/config, the orchestrated flow in internal/app.
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/oriolrius/pki-manager-krl-client/internal/app"
	"github.com/oriolrius/pki-manager-krl-client/internal/config"
	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
	"github.com/oriolrius/pki-manager-krl-client/internal/keygen"
)

// version is injected at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	// Subcommand dispatch: `keygen` is a self-contained tool, not a KRL run.
	if len(os.Args) > 1 && os.Args[1] == "keygen" {
		os.Exit(int(keygen.Run(os.Args[2:], os.Stdout)))
	}

	cfg, err := config.Parse(os.Args[1:], version)
	switch {
	case errors.Is(err, config.ErrVersionRequested):
		fmt.Println(version)
		os.Exit(int(exitcodes.OK))
	case errors.Is(err, flag.ErrHelp):
		os.Exit(int(exitcodes.OK))
	case err != nil:
		var ce *exitcodes.Error
		if errors.As(err, &ce) {
			fmt.Fprintln(os.Stderr, "krl-client:", ce.Msg)
			os.Exit(int(ce.Code))
		}
		fmt.Fprintln(os.Stderr, "krl-client:", err)
		os.Exit(int(exitcodes.Usage))
	}
	os.Exit(int(app.Run(cfg)))
}
