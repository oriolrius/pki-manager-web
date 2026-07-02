// Package logx builds the krl-client structured logger over log/slog (KRLC-09).
// It centralises the single place that decides log FORMAT and VERBOSITY so the
// app layer only emits events:
//
//   - format:  "text" (human default) | "json" (machine / systemd-journal)
//   - level:   --quiet -> warn+ (cron-friendly) · default -> info · --verbose -> debug
//
// slog's TextHandler and JSONHandler never emit ANSI colour codes, so the
// "--systemd => no ANSI escapes" requirement holds inherently (and --systemd
// additionally forces the json format at the config layer).
//
// This package deliberately knows NOTHING about secrets: callers must only ever
// pass redacted attributes (lengths, versions, counts) — never key material,
// the ECIES ciphertext, or the decrypted payload.
package logx

import (
	"io"
	"log/slog"
	"os"
)

// Options selects the handler format and verbosity.
type Options struct {
	Format  string    // "text" (default) | "json"
	Quiet   bool      // warnings + errors only
	Verbose bool      // add per-step debug detail
	Writer  io.Writer // sink; defaults to os.Stderr
}

// Level maps the quiet/verbose/default triad to an slog level. --quiet and
// --verbose are mutually exclusive at the config layer; should both arrive here
// anyway, quiet wins (fail safe toward LESS output).
func (o Options) Level() slog.Level {
	switch {
	case o.Quiet:
		return slog.LevelWarn
	case o.Verbose:
		return slog.LevelDebug
	default:
		return slog.LevelInfo
	}
}

// New builds a *slog.Logger for the given options. Output always goes to stderr
// (or opts.Writer): stdout is reserved for --version and any piped data.
func New(opts Options) *slog.Logger {
	w := opts.Writer
	if w == nil {
		w = os.Stderr
	}
	hopts := &slog.HandlerOptions{Level: opts.Level()}
	var h slog.Handler
	if opts.Format == "json" {
		h = slog.NewJSONHandler(w, hopts)
	} else {
		h = slog.NewTextHandler(w, hopts)
	}
	return slog.New(h)
}
