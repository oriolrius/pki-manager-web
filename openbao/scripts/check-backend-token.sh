#!/usr/bin/env bash
# check-backend-token.sh — prove what the PKI Manager backend token can and cannot do.
#
# Needs OPENBAO_ADDR, OPENBAO_CACERT, OPENBAO_TOKEN_FILE (the backend settings), curl,
# jq and openssl. It creates and deletes throw-away keys named check-<random> in the key
# mount; RA keys cannot be deleted by this token, so it leaves one disposable RA key
# (scep-ra-check-*) only when CHECK_RA=1. Run it against dev and test stacks, not
# production.
set -euo pipefail

: "${OPENBAO_ADDR:?}" "${OPENBAO_CACERT:?}" "${OPENBAO_TOKEN_FILE:?}"
mount="${OPENBAO_TRANSIT_MOUNT:-pki-manager}"
ra="${OPENBAO_RA_MOUNT:-pki-manager-ra}"
token="$(cat "$OPENBAO_TOKEN_FILE")"
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
  if [[ "$got" =~ ^($want)$ ]]; then echo "  ok    $what ($got)"; else echo "  FAIL  $what: HTTP $got $(head -c 300 "$bodyf")"; fails=$((fails + 1)); fi
}

k="check-$(openssl rand -hex 6)"
echo "backend token on $OPENBAO_ADDR (key mount '$mount', RA mount '$ra'):"
expect '200|204' "create exportable rsa-2048 key"      POST "$mount/keys/$k" '{"type":"rsa-2048","exportable":true}'
expect 200       "read key"                             GET  "$mount/keys/$k"
expect 200       "sign sha2-256 (PKCS#1 v1.5)"          POST "$mount/sign/$k/sha2-256" '{"input":"aGVsbG8=","signature_algorithm":"pkcs1v15"}'
expect 200       "export the exportable key"            GET  "$mount/export/signing-key/$k"
expect 200       "read wrapping key (import)"           GET  "$mount/wrapping_key"
expect 403       "turn on plaintext backup"             POST "$mount/keys/$k/config" '{"allow_plaintext_backup":true}'
expect 403       "backup a key"                         GET  "$mount/backup/$k"
expect 403       "rotate a key"                         POST "$mount/keys/$k/rotate" '{}'
expect 403       "decrypt"                              POST "$mount/decrypt/$k" '{"ciphertext":"vault:v1:AAAA"}'
expect 403       "list mounts (sys)"                    GET  "sys/mounts"
expect 403       "read the default policy (sys)"        GET  "sys/policies/acl/default"
expect '200|204' "allow deletion"                       POST "$mount/keys/$k/config" '{"deletion_allowed":true}'
expect 204       "delete the key"                       DELETE "$mount/keys/$k"

k2="check-$(openssl rand -hex 6)"
expect '200|204' "create non-exportable ec-p256 key"    POST "$mount/keys/$k2" '{"type":"ecdsa-p256"}'
expect 400       "export of a non-exportable key is refused" GET "$mount/export/signing-key/$k2"
expect 403       "make a key exportable"                POST "$mount/keys/$k2/config" '{"exportable":true}'
expect '200|204' "allow deletion"                       POST "$mount/keys/$k2/config" '{"deletion_allowed":true}'
expect 204       "delete the key"                       DELETE "$mount/keys/$k2"

expect 403       "RA mount: configure a key"            POST "$ra/keys/x/config" '{"deletion_allowed":true}'
expect 403       "RA mount: export"                     GET  "$ra/export/signing-key/x"
expect 403       "RA mount: decrypt (OAEP)"             POST "$ra/decrypt/x" '{"ciphertext":"vault:v1:AAAA"}'
if [ "${CHECK_RA:-}" = 1 ]; then
  r="scep-ra-check-$(openssl rand -hex 4)"
  expect '200|204' "RA mount: create rsa-3072 RA key"    POST "$ra/keys/$r" '{"type":"rsa-3072","exportable":false,"allow_plaintext_backup":false,"allow_pkcs1v15_session_key":true}'
  expect 200     "RA mount: pre-hashed sign"             POST "$ra/sign/$r/sha2-256" "{\"input\":\"$(openssl rand 32 | base64 -w0)\",\"prehashed\":true,\"signature_algorithm\":\"pkcs1v15\"}"
fi

if ((fails)); then echo "check-backend-token: $fails check(s) FAILED"; exit 1; fi
echo "check-backend-token: all checks passed"
