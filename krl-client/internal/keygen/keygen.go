// Package keygen implements the OPTIONAL `krl-client keygen` subcommand: it
// generates a DEDICATED ecdsa-sha2-nistp256 ECIES keypair for operators who
// prefer NOT to reuse the host's SSH host key for KRL decryption (the trade-off
// is documented in decision-015 — a dedicated key is one more secret to manage,
// but decouples KRL decryption from host-key rotation).
//
// The private key is written 0600 and NEVER transmitted; only the printed public
// key is registered with pki-manager. The output path deliberately defaults away
// from /etc/ssh/ssh_host_ecdsa_key so keygen can never clobber the real SSH host
// key, and it refuses to overwrite an existing key unless --force is given.
package keygen

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/ssh"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// DefaultKeyPath is the dedicated-ECIES-key location. It is intentionally NOT the
// SSH host key path, so `krl-client keygen` can never overwrite the host key.
const DefaultKeyPath = "/etc/krl-client/ecies_key"

// Run is the keygen subcommand entry point. out receives the human-readable
// success report (the public key + registration instructions); errors go to
// stderr and map to a process exit code.
func Run(args []string, out io.Writer) exitcodes.Code {
	code, err := generate(args, out, os.Hostname)
	if err != nil {
		fmt.Fprintln(os.Stderr, "krl-client keygen:", err.Error())
	}
	return code
}

// generate is the injectable core (hostname is stubbed in tests). It returns a
// coded exit and, on failure, the error to print.
func generate(args []string, out io.Writer, hostname func() (string, error)) (exitcodes.Code, error) {
	fs := flag.NewFlagSet("krl-client keygen", flag.ContinueOnError)
	var outPath, comment string
	var force bool
	fs.StringVar(&outPath, "out", DefaultKeyPath, "path to write the dedicated ECIES private key (0600); the public key goes to <out>.pub")
	fs.StringVar(&comment, "comment", "", "OpenSSH public-key comment (default: krl-client-ecies@<hostname>)")
	fs.BoolVar(&force, "force", false, "overwrite an existing key at --out")
	fs.Usage = func() {
		w := fs.Output()
		fmt.Fprintln(w, "usage: krl-client keygen [--out PATH] [--comment C] [--force]")
		fmt.Fprintln(w, "")
		fmt.Fprintln(w, "Generate a DEDICATED ecdsa-sha2-nistp256 ECIES keypair — an alternative to reusing")
		fmt.Fprintln(w, "the SSH host key. The private key is written 0600 and never transmitted; register the")
		fmt.Fprintln(w, "printed public key with pki-manager and run: krl-client --host-key PATH")
		fmt.Fprintln(w, "")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return exitcodes.OK, nil
		}
		return exitcodes.Usage, nil // flag already printed the parse error to stderr
	}
	if fs.NArg() > 0 {
		return exitcodes.Usage, fmt.Errorf("unexpected argument %q (see `krl-client keygen -h`)", fs.Arg(0))
	}

	pubPath := outPath + ".pub"
	if !force {
		if _, err := os.Stat(outPath); err == nil {
			return exitcodes.Usage, fmt.Errorf("refusing to overwrite existing key %q (use --force)", outPath)
		}
	}

	if comment == "" {
		h, _ := hostname()
		if strings.TrimSpace(h) == "" {
			h = "localhost"
		}
		comment = "krl-client-ecies@" + h
	}

	ec, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return exitcodes.Usage, fmt.Errorf("generate P-256 key: %v", err)
	}
	blk, err := ssh.MarshalPrivateKey(ec, comment)
	if err != nil {
		return exitcodes.Usage, fmt.Errorf("marshal private key: %v", err)
	}
	sshPub, err := ssh.NewPublicKey(&ec.PublicKey)
	if err != nil {
		return exitcodes.Usage, fmt.Errorf("derive public key: %v", err)
	}
	pubLine := strings.TrimRight(string(ssh.MarshalAuthorizedKey(sshPub)), "\n") + " " + comment

	if dir := filepath.Dir(outPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return exitcodes.Usage, fmt.Errorf("create directory %q: %v", dir, err)
		}
	}
	// Truncate+create at 0600 so a --force overwrite of a wider-mode file never
	// leaves the private key world-readable, even momentarily.
	f, err := os.OpenFile(outPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return exitcodes.Usage, fmt.Errorf("write private key %q: %v", outPath, err)
	}
	if _, err := f.Write(pem.EncodeToMemory(blk)); err != nil {
		f.Close()
		return exitcodes.Usage, fmt.Errorf("write private key %q: %v", outPath, err)
	}
	if err := f.Close(); err != nil {
		return exitcodes.Usage, fmt.Errorf("write private key %q: %v", outPath, err)
	}
	if err := os.WriteFile(pubPath, []byte(pubLine+"\n"), 0o644); err != nil {
		return exitcodes.Usage, fmt.Errorf("write public key %q: %v", pubPath, err)
	}

	fmt.Fprintf(out, `Generated a dedicated ECIES keypair (ecdsa-sha2-nistp256):
  private key: %s  (0600 — keep on this host, never transmit)
  public key:  %s

Register this PUBLIC key with pki-manager so it can encrypt this host's KRL to it:

%s

Then run the client against the dedicated key:
  krl-client --server-url https://pki.example.com --host-key %s
`, outPath, pubPath, pubLine, outPath)

	return exitcodes.OK, nil
}
