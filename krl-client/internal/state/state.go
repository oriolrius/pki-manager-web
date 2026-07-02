// Package state persists the version/state cache in --state-dir (KRLC-07): the
// installed krl_version (sent as the next If-None-Match), krl_number (anti-
// rollback), the installed KRL sha256, and a success timestamp. Written
// atomically only after a successful install; read at startup.
package state

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/oriolrius/pki-manager-krl-client/internal/exitcodes"
)

const fileName = "state.json"

type State struct {
	Version   string `json:"krl_version"`
	Number    int64  `json:"krl_number"`
	SHA256    string `json:"installed_sha256"`
	UpdatedAt int64  `json:"updated_at"`
}

// Read loads the cached state. A missing file yields a zero State (no error); a
// corrupt file is treated as empty so a fresh KRL is fetched rather than failing.
func Read(dir string) (*State, error) {
	b, err := os.ReadFile(filepath.Join(dir, fileName))
	if err != nil {
		if os.IsNotExist(err) {
			return &State{}, nil
		}
		return nil, exitcodes.New(exitcodes.Usage, "read state: %v", err)
	}
	var s State
	if json.Unmarshal(b, &s) != nil {
		return &State{}, nil
	}
	return &s, nil
}

// Write atomically persists the state, creating the directory if needed.
func Write(dir string, s *State) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return exitcodes.New(exitcodes.Install, "create state-dir %s: %v", dir, err)
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	tmp := filepath.Join(dir, fileName+".tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return exitcodes.New(exitcodes.Install, "write state: %v", err)
	}
	if err := os.Rename(tmp, filepath.Join(dir, fileName)); err != nil {
		_ = os.Remove(tmp)
		return exitcodes.New(exitcodes.Install, "commit state: %v", err)
	}
	return nil
}
