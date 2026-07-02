// Package exitcodes is the single source of truth for krl-client process exit
// codes (documented in the README and asserted by tests), plus a typed error
// that carries the code from where a failure is detected up to main.
package exitcodes

import "fmt"

type Code int

const (
	OK             Code = 0  // up-to-date (304) or a newer KRL was verified + installed
	Usage          Code = 1  // config / usage / unexpected internal error
	Network        Code = 2  // DNS/connect/TLS/timeout, exhausted retries, 5xx/503/500
	Decrypt        Code = 3  // local ECIES decrypt failed (wrong key, bad envelope)
	Verify         Code = 4  // CA signature verification failed
	Expired        Code = 5  // payload valid_until is in the past beyond clock-skew
	HostMismatch   Code = 6  // payload host_id != our host-id
	Install        Code = 7  // atomic install of the KRL file failed
	Version        Code = 8  // version/integrity/anti-rollback failure
	NotProvisioned Code = 9  // 400/404/501 — host not registered / feature disabled
	RateLimited    Code = 10 // 429 — back off and retry later
)

// Error carries a process exit code alongside a human message.
type Error struct {
	Code Code
	Msg  string
}

func (e *Error) Error() string { return e.Msg }

// New builds a coded error.
func New(code Code, format string, a ...any) *Error {
	return &Error{Code: code, Msg: fmt.Sprintf(format, a...)}
}
