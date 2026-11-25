package config

import (
	"strings"
	"testing"
)

// FuzzParseConfigFile feeds arbitrary bytes as the config file. An accepted file
// must hold only known keys, and no value may span a line.
func FuzzParseConfigFile(f *testing.F) {
	f.Add([]byte("server-url: https://pki.example.com\nhost-id: \"h1\" # comment\nretries: 3\n"))
	f.Add([]byte("# only a comment\n\n"))
	f.Add([]byte("zone: 'prod'\r\ninsecure: false\r\n"))
	f.Add([]byte("  nested: x\n"))
	f.Add([]byte("- item\n"))
	f.Add([]byte("unknown: 1\n"))
	f.Add([]byte("zone: a\nzone: b\n"))
	f.Add([]byte("zone: \"unterminated\n"))
	f.Add([]byte(": novalue\n"))
	f.Add([]byte("\x00\xff:\n"))

	f.Fuzz(func(t *testing.T, data []byte) {
		out, err := parseConfigFile(data)
		if err != nil {
			if out != nil {
				t.Fatal("parseConfigFile returned a map together with an error")
			}
			return
		}
		for k, v := range out {
			if !configKeys[k] {
				t.Fatalf("accepted unknown key %q", k)
			}
			if strings.ContainsAny(v, "\n") {
				t.Fatalf("value of %q spans a line: %q", k, v)
			}
		}
		if len(out) > len(configKeys) {
			t.Fatal("more keys than the closed set")
		}
	})
}
