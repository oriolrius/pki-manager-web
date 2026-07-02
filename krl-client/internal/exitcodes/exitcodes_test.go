package exitcodes

import "testing"

// TestCodesMatchDocumentedContract pins the numeric exit codes to the values
// documented in the README and required by KRLC-08 AC#3. Changing a number here
// is a breaking change for crontab/systemd wrappers, so it must be deliberate.
func TestCodesMatchDocumentedContract(t *testing.T) {
	cases := []struct {
		name string
		got  Code
		want int
	}{
		{"OK", OK, 0},
		{"Usage", Usage, 1},
		{"Network", Network, 2},
		{"Decrypt", Decrypt, 3},
		{"Verify", Verify, 4},
		{"Expired", Expired, 5},
		{"HostMismatch", HostMismatch, 6},
		{"Install", Install, 7},
		{"Version", Version, 8},
		{"NotProvisioned", NotProvisioned, 9},
		{"RateLimited", RateLimited, 10},
	}
	for _, c := range cases {
		if int(c.got) != c.want {
			t.Errorf("%s = %d, want %d", c.name, int(c.got), c.want)
		}
	}
}

func TestErrorCarriesCode(t *testing.T) {
	err := New(Network, "boom %d", 42)
	if err.Code != Network {
		t.Fatalf("Code = %d, want %d", err.Code, Network)
	}
	if err.Error() != "boom 42" {
		t.Fatalf("Error() = %q, want %q", err.Error(), "boom 42")
	}
}
