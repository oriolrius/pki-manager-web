package installer

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

func codeOf(err error) exitcodes.Code {
	if e, ok := err.(*exitcodes.Error); ok {
		return e.Code
	}
	return -1
}

func TestInstallAtomic0444(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "revoked_keys")
	data := []byte("KRL-BYTES")

	if err := Install(target, data); err != nil {
		t.Fatalf("Install: %v", err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(data) {
		t.Fatalf("content = %q", got)
	}
	fi, _ := os.Stat(target)
	if fi.Mode().Perm() != 0o444 {
		t.Fatalf("mode = %v, want 0444", fi.Mode().Perm())
	}
	// No leftover temp files (created via temp+rename).
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 || entries[0].Name() != "revoked_keys" {
		t.Fatalf("unexpected directory contents: %v", entries)
	}
}

func TestInstallOverwrites(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "revoked_keys")
	if err := Install(target, []byte("old")); err != nil {
		t.Fatal(err)
	}
	if err := Install(target, []byte("newer-content")); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(target)
	if string(got) != "newer-content" {
		t.Fatalf("content = %q", got)
	}
}

func TestInstallFailsOnMissingDir(t *testing.T) {
	err := Install(filepath.Join(t.TempDir(), "no-such-subdir", "revoked_keys"), []byte("x"))
	if codeOf(err) != exitcodes.Install {
		t.Fatalf("expected Install(7) error for missing dir, got %v", err)
	}
}
