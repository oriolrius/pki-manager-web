// Package installer atomically installs the KRL to the sshd RevokedKeys path
// (KRLC-07): write a same-directory temp file (0600), fsync, chmod 0444, chown
// root:root, rename over the target, then fsync the directory — so sshd never
// reads a partial or world-writable file.
package installer

import (
	"os"
	"path/filepath"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

// Install writes data to krlFile atomically as 0444 root:root. chown to root:root
// is required in production (the client runs as root); when NOT running as root
// (e.g. tests) a chown failure is tolerated so the file keeps the caller's owner.
func Install(krlFile string, data []byte) error {
	dir := filepath.Dir(krlFile)
	tmp, err := os.CreateTemp(dir, ".krl-*.tmp")
	if err != nil {
		return exitcodes.New(exitcodes.Install, "create temp in %s: %v", dir, err)
	}
	tmpName := tmp.Name()
	remove := func() { _ = os.Remove(tmpName) }

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		remove()
		return exitcodes.New(exitcodes.Install, "write temp: %v", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		remove()
		return exitcodes.New(exitcodes.Install, "fsync temp: %v", err)
	}
	if err := tmp.Close(); err != nil {
		remove()
		return exitcodes.New(exitcodes.Install, "close temp: %v", err)
	}
	if err := os.Chmod(tmpName, 0o444); err != nil {
		remove()
		return exitcodes.New(exitcodes.Install, "chmod 0444: %v", err)
	}
	if err := os.Chown(tmpName, 0, 0); err != nil && os.Geteuid() == 0 {
		remove()
		return exitcodes.New(exitcodes.Install, "chown root:root: %v", err)
	}
	if err := os.Rename(tmpName, krlFile); err != nil {
		remove()
		return exitcodes.New(exitcodes.Install, "atomic rename onto %s: %v", krlFile, err)
	}
	fsyncDir(dir)
	return nil
}

// fsyncDir best-effort fsyncs the directory so the rename is durable.
func fsyncDir(dir string) {
	d, err := os.Open(dir)
	if err != nil {
		return
	}
	defer d.Close()
	_ = d.Sync()
}
