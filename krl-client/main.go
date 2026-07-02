// Command krl-client keeps a host's /etc/ssh/revoked_keys (OpenSSH RevokedKeys /
// KRL) current: it POSTs the encrypted per-host endpoint, decrypts the payload
// LOCALLY with the host's own ecdsa host key, verifies the CA signature, and
// atomically installs the KRL. Normally run from crontab or a systemd timer.
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
)

// version is injected at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	cfg, err := config.Parse(os.Args[1:], version)
	switch {
	case errors.Is(err, config.ErrVersionRequested):
		fmt.Println(version)
		os.Exit(int(exitcodes.OK))
	case errors.Is(err, flag.ErrHelp):
		os.Exit(int(exitcodes.OK))
	case err != nil:
		fmt.Fprintln(os.Stderr, "krl-client:", err)
		os.Exit(int(exitcodes.Usage))
	}
	os.Exit(int(app.Run(cfg)))
}
