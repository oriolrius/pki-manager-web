package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAutoProvisionOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "ra.json")
	calls := 0
	create := func() error {
		calls++
		return os.WriteFile(path, []byte(`{"keyId":"existing"}`), 0600)
	}
	for range 2 {
		data, err := loadRAState(path, true, create)
		if err != nil || string(data) != `{"keyId":"existing"}` {
			t.Fatalf("load state: %s, %v", data, err)
		}
	}
	if calls != 1 {
		t.Fatalf("provision called %d times", calls)
	}
	if _, err := os.Stat(path + ".provisioning"); !os.IsNotExist(err) {
		t.Fatalf("marker remains after success: %v", err)
	}
}

func TestAutoProvisionRequiresOptIn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ra.json")
	_, err := loadRAState(path, false, func() error {
		t.Fatal("must not provision without opt-in")
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "RA state missing") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestAutoProvisionFailureBlocksRestartRetries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ra.json")
	calls := 0
	create := func() error {
		calls++
		return errors.New("KMS unavailable after creating key")
	}
	for range 2 {
		if _, err := loadRAState(path, true, create); err == nil {
			t.Fatal("expected failure")
		}
	}
	if calls != 1 {
		t.Fatalf("unsafe automatic retry: %d calls", calls)
	}
}

func TestAutoProvisionDoesNotReplaceUnreadableOrInvalidState(t *testing.T) {
	for _, directory := range []bool{false, true} {
		t.Run(map[bool]string{false: "invalid JSON", true: "directory"}[directory], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "ra.json")
			var err error
			if directory {
				err = os.Mkdir(path, 0700)
			} else {
				err = os.WriteFile(path, []byte("broken"), 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			data, err := loadRAState(path, true, func() error {
				t.Fatal("must not replace existing state")
				return nil
			})
			if directory && err == nil || !directory && (err != nil || string(data) != "broken") {
				t.Fatalf("unexpected read result: %s, %v", data, err)
			}
		})
	}
}
