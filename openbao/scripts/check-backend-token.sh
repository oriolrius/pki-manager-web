#!/usr/bin/env bash
# check-backend-token.sh — prove what the PKI Manager runtime tokens can and cannot do.
#
# Needs OPENBAO_ADDR, OPENBAO_CACERT, OPENBAO_TOKEN_FILE (the X.509/SSH token, policy
# pki-manager-backend), curl, and standard Unix utilities. With OPENBAO_RA_TOKEN_FILE (the
# SCEP RA token, policy pki-manager-ra) it also proves the RA token and the separation of
# the two: the backend token cannot reach the RA mount, and the RA token cannot reach the
# X.509 or SSH mounts. It creates and deletes throw-away keys named check-<random> in the
# key mount; RA keys cannot be deleted, so with CHECK_RA=1 and the RA token it leaves one
# disposable RA key (scep-ra-check-*). Run it against dev and test stacks, not production.
set -euo pipefail

: "${OPENBAO_ADDR:?}" "${OPENBAO_CACERT:?}" "${OPENBAO_TOKEN_FILE:?}"
mount="${OPENBAO_TRANSIT_MOUNT:-pki-manager}"
ra="${OPENBAO_RA_MOUNT:-pki-manager-ra}"
ssh="${OPENBAO_SSH_MOUNT:-pki-manager-ssh}"
backend_token="$(cat "$OPENBAO_TOKEN_FILE")"
ra_token=""
if [ -n "${OPENBAO_RA_TOKEN_FILE:-}" ]; then ra_token="$(cat "$OPENBAO_RA_TOKEN_FILE")"; fi
token="$backend_token"
fails=0

# call METHOD PATH [JSON] -> prints the HTTP status; the body goes to $bodyf
bodyf="$(mktemp)"; trap 'rm -f "$bodyf"' EXIT
call() {
  curl -sS --cacert "$OPENBAO_CACERT" -H "X-Vault-Token: $token" -X "$1" \
    ${3:+-H 'Content-Type: application/json' --data "$3"} -o "$bodyf" -w '%{http_code}' "$OPENBAO_ADDR/v1/$2"
}
expect() { # expect CODE-REGEX DESCRIPTION METHOD PATH [JSON]
  local want="$1" what="$2" got; shift 2
  got="$(call "$@")"
  if [[ "$got" =~ ^($want)$ ]]; then echo "  ok    $what ($got)"; else echo "  FAIL  $what: HTTP $got (expected $want)"; fails=$((fails + 1)); fi
}

random_hex() {
  od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
}

k="check-$(random_hex 6)"
echo "backend token on $OPENBAO_ADDR (key mount '$mount', RA mount '$ra'):"
expect '200|204' "create exportable rsa-2048 key"      POST "$mount/keys/$k" '{"type":"rsa-2048","exportable":true}'
expect 200       "read key"                             GET  "$mount/keys/$k"
expect 200       "sign sha2-256 (PKCS#1 v1.5)"          POST "$mount/sign/$k/sha2-256" '{"input":"aGVsbG8=","signature_algorithm":"pkcs1v15"}'
expect 200       "export the exportable key"            GET  "$mount/export/signing-key/$k"
expect 403       "read the wrapping key (import is migration-only)" GET "$mount/wrapping_key"
expect 403       "import a key (migration-only)"        POST "$mount/keys/check-import-$(random_hex 4)/import" '{"ciphertext":"AAAA","type":"rsa-2048"}'
expect 403       "turn on plaintext backup"             POST "$mount/keys/$k/config" '{"allow_plaintext_backup":true}'
expect 403       "backup a key"                         GET  "$mount/backup/$k"
expect 403       "rotate a key"                         POST "$mount/keys/$k/rotate" '{}'
expect 403       "decrypt"                              POST "$mount/decrypt/$k" '{"ciphertext":"vault:v1:AAAA"}'
expect 403       "list mounts (sys)"                    GET  "sys/mounts"
expect 403       "read the default policy (sys)"        GET  "sys/policies/acl/default"
expect '200|204' "allow deletion"                       POST "$mount/keys/$k/config" '{"deletion_allowed":true}'
expect 204       "delete the key"                       DELETE "$mount/keys/$k"

k2="check-$(random_hex 6)"
expect '200|204' "create non-exportable ec-p256 key"    POST "$mount/keys/$k2" '{"type":"ecdsa-p256"}'
expect 400       "export of a non-exportable key is refused" GET "$mount/export/signing-key/$k2"
expect 403       "make a key exportable"                POST "$mount/keys/$k2/config" '{"exportable":true}'
expect '200|204' "allow deletion"                       POST "$mount/keys/$k2/config" '{"deletion_allowed":true}'
expect 204       "delete the key"                       DELETE "$mount/keys/$k2"

# The X.509/SSH token has no path on the SCEP RA mount (policy pki-manager-ra is not attached).
# 384 bytes with a zero first byte, so the value is below every RSA-3072 modulus.
ct="$({ printf '\000'; head -c 383 /dev/urandom; } | base64 | tr -d '\n')"
expect 403       "RA mount: recover a CMS session key (RA token only)" POST "$ra/session-key/pkcs1v15/scep-ra-x" "{\"ciphertext\":\"$ct\",\"key_version\":1,\"session_key_length\":32}"
expect 403       "RA mount: pre-hashed sign (RA token only)" POST "$ra/sign/scep-ra-x/sha2-256" '{"input":"aGVsbG8=","prehashed":true}'
expect 403       "RA mount: read a key (RA token only)" GET  "$ra/keys/scep-ra-x"
expect 403       "RA mount: create a key (RA token only)" POST "$ra/keys/scep-ra-check-x" '{"type":"rsa-3072"}'
expect 403       "RA mount: configure a key"            POST "$ra/keys/x/config" '{"deletion_allowed":true}'
expect 403       "RA mount: export"                     GET  "$ra/export/signing-key/x"
expect 403       "RA mount: decrypt (OAEP)"             POST "$ra/decrypt/x" '{"ciphertext":"vault:v1:AAAA"}'
expect 403       "AppRole: read the RA role-id"         GET  "auth/approle/role/pki-manager-ra/role-id"

if [ -n "$ra_token" ]; then
  token="$ra_token"
  echo "RA token (key mount '$mount', SSH mount '$ssh', RA mount '$ra'):"
  [ "$ra_token" != "$backend_token" ] || { echo "  FAIL  OPENBAO_RA_TOKEN_FILE holds the backend token"; fails=$((fails + 1)); }
  expect 403     "X.509 mount: create a key"            POST "$mount/keys/check-ra-$(random_hex 4)" '{"type":"ecdsa-p256"}'
  expect 403     "X.509 mount: read a key"              GET  "$mount/keys/check-x"
  expect 403     "X.509 mount: sign"                    POST "$mount/sign/check-x/sha2-256" '{"input":"aGVsbG8="}'
  expect 403     "X.509 mount: export"                  GET  "$mount/export/signing-key/check-x"
  expect 403     "SSH mount: create a key"              POST "$ssh/keys/check-ra-$(random_hex 4)" '{"type":"ecdsa-p256"}'
  expect 403     "SSH mount: sign"                      POST "$ssh/sign/check-x/sha2-256" '{"input":"aGVsbG8="}'
  expect 403     "RA mount: read the wrapping key (import is migration-only)" GET "$ra/wrapping_key"
  expect 403     "RA mount: configure a key"            POST "$ra/keys/x/config" '{"deletion_allowed":true}'
  expect 403     "RA mount: export"                     GET  "$ra/export/signing-key/x"
  expect 403     "RA mount: backup"                     GET  "$ra/backup/x"
  expect 403     "RA mount: rotate"                     POST "$ra/keys/x/rotate" '{}'
  expect 403     "RA mount: decrypt (OAEP)"             POST "$ra/decrypt/x" '{"ciphertext":"vault:v1:AAAA"}'
  expect 403     "list mounts (sys)"                    GET  "sys/mounts"
  expect 403     "AppRole: read the backend role-id"    GET  "auth/approle/role/pki-manager-backend/role-id"
  if [ "${CHECK_RA:-}" = 1 ]; then
    r="scep-ra-check-$(random_hex 4)"
    expect '200|204' "RA mount: create rsa-3072 RA key"  POST "$ra/keys/$r" '{"type":"rsa-3072","exportable":false,"allow_plaintext_backup":false,"allow_pkcs1v15_session_key":true}'
    expect 200   "RA mount: read the RA key"            GET  "$ra/keys/$r"
    expect 200   "RA mount: pre-hashed sign"            POST "$ra/sign/$r/sha2-256" "{\"input\":\"$(head -c 32 /dev/urandom | base64)\",\"prehashed\":true,\"signature_algorithm\":\"pkcs1v15\"}"
    # A random modulus-sized block: the fork returns a session key of the requested length
    # (a deterministic fallback for invalid padding), never a padding error.
    expect 200   "RA mount: recover a CMS session key"  POST "$ra/session-key/pkcs1v15/$r" "{\"ciphertext\":\"$ct\",\"key_version\":1,\"session_key_length\":32}"
    expect 403   "RA mount: delete the RA key"          DELETE "$ra/keys/$r"
  fi
elif [ "${CHECK_RA:-}" = 1 ]; then
  echo "  FAIL  CHECK_RA=1 needs OPENBAO_RA_TOKEN_FILE (the pki-manager-ra token)"; fails=$((fails + 1))
fi

if ((fails)); then echo "check-backend-token: $fails check(s) FAILED"; exit 1; fi
echo "check-backend-token: all checks passed"
