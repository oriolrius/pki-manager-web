#!/usr/bin/env bash
# KRLC-02a — reproduce the native P-256 ECIES round-trip + negative tests.
# Requires: node >= 20, go >= 1.23, ssh-keygen. Run: ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# A real OpenSSH ecdsa nistp256 host key — identical shape to /etc/ssh/ssh_host_ecdsa_key
ssh-keygen -t ecdsa -b 256 -f "$tmp/host" -N '' -C spike -q
printf '%s' '{"krl":"c3NoLWtybC1ib2R5","ca_signature":null,"krl_version":"sha256:deadbeef","valid_until":9999999999,"host_id":"spike.example.com"}' > "$tmp/payload.json"

go build -o "$tmp/krl-decrypt" .

# BACKEND encrypt (node, to the PUBLIC key) -> HOST decrypt (go, with the LOCAL private key)
node encrypt.mjs "$tmp/host.pub" "$tmp/payload.json" > "$tmp/env.bin"
"$tmp/krl-decrypt" "$tmp/host" "$tmp/env.bin" > "$tmp/out.bin"
cmp -s "$tmp/payload.json" "$tmp/out.bin" && echo "PASS  round-trip: plaintext byte-identical" || { echo "FAIL round-trip"; exit 1; }

check() { # <label> <expected-exit> <key> <envelope>
  set +e; "$tmp/krl-decrypt" "$3" "$4" >/dev/null 2>&1; local c=$?; set -e
  [ "$c" -eq "$2" ] && echo "PASS  $1 -> exit $c" || { echo "FAIL  $1: exit $c (want $2)"; exit 1; }
}
cp "$tmp/env.bin" "$tmp/tamper.bin"; printf '\x01' | dd of="$tmp/tamper.bin" bs=1 seek=100 count=1 conv=notrunc 2>/dev/null
ssh-keygen -t ecdsa   -b 256 -f "$tmp/other" -N '' -q
ssh-keygen -t ed25519        -f "$tmp/ed"    -N '' -q
check "tampered ciphertext" 4 "$tmp/host"  "$tmp/tamper.bin"
check "wrong host key"      4 "$tmp/other" "$tmp/env.bin"
check "ed25519 (not P-256)" 3 "$tmp/ed"    "$tmp/env.bin"
echo "ALL PASS — native local ECIES decrypt is FEASIBLE (KRLC-02/KRLC-04 unblocked)"
