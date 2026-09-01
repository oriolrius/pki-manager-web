package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

// configKeys is the closed set of keys accepted in the config file. They mirror
// the flag names (kebab-case); --config and --version are CLI-only and rejected.
var configKeys = map[string]bool{
	"server-url": true, "host-id": true, "zone": true, "host-key": true, "krl-file": true,
	"ca-pubkey": true, "state-dir": true, "ca-bundle": true, "insecure": true,
	"allow-unsigned": true, "timeout": true, "retries": true, "clock-skew": true,
	"max-response-bytes": true, "dry-run": true, "quiet": true, "verbose": true,
	"log-format": true, "systemd": true, "oneshot": true,
}

// loadConfigFile reads and parses the config file into a key->raw-scalar map.
// A missing DEFAULT file is not an error (returns an empty map); a missing file
// that was explicitly requested (--config / KRL_CLIENT_CONFIG) is.
func loadConfigFile(readFile func(string) ([]byte, error), path string, explicit bool) (map[string]string, error) {
	data, err := readFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) && !explicit {
			return map[string]string{}, nil
		}
		return nil, fmt.Errorf("read config file %q: %v", path, err)
	}
	return parseConfigFile(data)
}

// parseConfigFile parses a deliberately small, flat subset of YAML: one
// `key: value` per line, `#` line/inline comments, and single/double-quoted
// scalars. Nested mappings, sequences, unknown keys, and duplicates are rejected
// so a typo fails loudly instead of being silently ignored.
func parseConfigFile(data []byte) (map[string]string, error) {
	out := map[string]string{}
	for i, rawLine := range strings.Split(string(data), "\n") {
		lineno := i + 1
		line := strings.TrimRight(rawLine, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if line[0] == ' ' || line[0] == '\t' {
			return nil, fmt.Errorf("config line %d: unexpected indentation (nested mappings are not supported; use flat key: value)", lineno)
		}
		if strings.HasPrefix(trimmed, "- ") || trimmed == "-" {
			return nil, fmt.Errorf("config line %d: YAML sequences are not supported", lineno)
		}
		idx := strings.IndexByte(trimmed, ':')
		if idx < 0 {
			return nil, fmt.Errorf("config line %d: missing ':' in %q", lineno, trimmed)
		}
		key := strings.TrimSpace(trimmed[:idx])
		if key == "" {
			return nil, fmt.Errorf("config line %d: empty key", lineno)
		}
		if !configKeys[key] {
			return nil, fmt.Errorf("config line %d: unknown key %q", lineno, key)
		}
		if _, dup := out[key]; dup {
			return nil, fmt.Errorf("config line %d: duplicate key %q", lineno, key)
		}
		val, err := unquoteScalar(strings.TrimSpace(trimmed[idx+1:]))
		if err != nil {
			return nil, fmt.Errorf("config line %d: %v", lineno, err)
		}
		out[key] = val
	}
	return out, nil
}

// unquoteScalar returns a config value: quoted values are taken verbatim between
// the quotes; unquoted values have any ` #`/`\t#` inline comment stripped.
func unquoteScalar(v string) (string, error) {
	if v == "" {
		return "", nil
	}
	switch v[0] {
	case '"':
		if end := strings.IndexByte(v[1:], '"'); end >= 0 {
			return v[1 : 1+end], nil
		}
		return "", errors.New("unterminated double-quoted value")
	case '\'':
		if end := strings.IndexByte(v[1:], '\''); end >= 0 {
			return v[1 : 1+end], nil
		}
		return "", errors.New("unterminated single-quoted value")
	default:
		if idx := strings.Index(v, " #"); idx >= 0 {
			v = v[:idx]
		}
		if idx := strings.Index(v, "\t#"); idx >= 0 {
			v = v[:idx]
		}
		return strings.TrimSpace(v), nil
	}
}
