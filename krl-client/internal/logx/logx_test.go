package logx

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

// AC#2 — --quiet => warn+, --verbose => debug, default => info.
func TestLevelSelection(t *testing.T) {
	cases := []struct {
		name string
		opts Options
		want slog.Level
	}{
		{"default", Options{}, slog.LevelInfo},
		{"quiet", Options{Quiet: true}, slog.LevelWarn},
		{"verbose", Options{Verbose: true}, slog.LevelDebug},
		{"quiet wins over verbose", Options{Quiet: true, Verbose: true}, slog.LevelWarn},
	}
	for _, c := range cases {
		if got := c.opts.Level(); got != c.want {
			t.Errorf("%s: Level() = %v, want %v", c.name, got, c.want)
		}
	}
}

// AC#2 — a quiet logger drops info+debug but keeps warn/error.
func TestQuietSuppressesInfoAndDebug(t *testing.T) {
	var buf bytes.Buffer
	log := New(Options{Format: "json", Quiet: true, Writer: &buf})
	log.Debug("dbg")
	log.Info("nfo")
	log.Warn("wrn")
	log.Error("err")

	out := buf.String()
	if strings.Contains(out, "dbg") || strings.Contains(out, "nfo") {
		t.Errorf("quiet must suppress debug/info, got:\n%s", out)
	}
	if !strings.Contains(out, "wrn") || !strings.Contains(out, "err") {
		t.Errorf("quiet must keep warn/error, got:\n%s", out)
	}
}

// AC#2 — verbose surfaces debug-level per-step events.
func TestVerboseEmitsDebug(t *testing.T) {
	var buf bytes.Buffer
	log := New(Options{Format: "json", Verbose: true, Writer: &buf})
	log.Debug("step", "krl_bytes", 42)
	if !strings.Contains(buf.String(), "step") {
		t.Errorf("verbose must emit debug, got:\n%s", buf.String())
	}
}

// AC#1 — json format: every emitted line is a single valid JSON object.
func TestJSONFormatIsParseable(t *testing.T) {
	var buf bytes.Buffer
	log := New(Options{Format: "json", Verbose: true, Writer: &buf})
	log.Debug("a", "k", 1)
	log.Info("b", "k", 2)
	log.Error("c", "k", 3)

	for i, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		var obj map[string]any
		if err := json.Unmarshal([]byte(line), &obj); err != nil {
			t.Fatalf("line %d is not a valid JSON object: %v\n%s", i, err, line)
		}
	}
}

// AC#2 — neither handler emits ANSI escapes (the --systemd no-ANSI guarantee).
func TestNoANSIEscapes(t *testing.T) {
	for _, format := range []string{"text", "json"} {
		var buf bytes.Buffer
		log := New(Options{Format: format, Writer: &buf})
		log.Info("hello", "level", "info", "colour", "none")
		if strings.ContainsRune(buf.String(), '\x1b') {
			t.Errorf("%s handler emitted an ANSI escape: %q", format, buf.String())
		}
	}
}

// An unknown/empty format falls back to the human text handler (key=value).
func TestDefaultFormatIsText(t *testing.T) {
	var buf bytes.Buffer
	log := New(Options{Writer: &buf})
	log.Info("hi", "n", 7)
	out := buf.String()
	if !strings.Contains(out, "n=7") {
		t.Errorf("text handler should render key=value, got: %s", out)
	}
	if json.Valid([]byte(strings.TrimSpace(out))) {
		t.Errorf("default format should be text, not json: %s", out)
	}
}
