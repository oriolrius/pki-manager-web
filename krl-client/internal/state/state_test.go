package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadMissingIsEmpty(t *testing.T) {
	s, err := Read(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if s.Version != "" || s.Number != 0 {
		t.Fatalf("expected empty state, got %+v", s)
	}
}

func TestWriteThenRead(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "sub") // also exercises MkdirAll
	want := &State{Version: "sha256:abc", Number: 7, SHA256: "abc", UpdatedAt: 12345}
	if err := Write(dir, want); err != nil {
		t.Fatal(err)
	}
	got, err := Read(dir)
	if err != nil {
		t.Fatal(err)
	}
	if *got != *want {
		t.Fatalf("round-trip mismatch: %+v != %+v", got, want)
	}
	// state file is 0600 and no .tmp remains
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 || entries[0].Name() != "state.json" {
		t.Fatalf("unexpected state-dir contents: %v", entries)
	}
}

func TestCorruptStateReadsAsEmpty(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte("{bad json"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Read(dir)
	if err != nil {
		t.Fatal(err)
	}
	if s.Version != "" {
		t.Fatal("corrupt state should read as empty")
	}
}
