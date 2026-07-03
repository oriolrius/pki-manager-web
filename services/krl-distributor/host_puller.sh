#!/usr/bin/env bash
#
# host_puller.sh — host-side puller for the PKI-Manager SSH KRL distribution
# (SSH-24). Fetches the per-host ECIES-encrypted KRL from the manager, decrypts
# it with this host's KMS key, verifies the detached CA signature + freshness +
# host_id binding + anti-rollback, then atomically installs /etc/ssh/revoked_keys.
#
# sshd re-reads RevokedKeys per auth, so no restart is needed. The puller holds
# no secrets: decryption/verification are delegated to Cosmian KMS.
#
# BLK-10 (decision-016): the served KRL is the COMPOSED per-host artifact
# (host-CA ∪ user-CA revocations ∪ per-host access blocks), signed with the
# HOST CA key — CA_PUBLIC_KEY_ID must be the Host CA public key id (matching
# the /etc/ssh/ssh-host-ca.pub trust anchor krl-client verifies against).
#
set -euo pipefail

KRL_API_URL="${KRL_API_URL:-https://pki.internal/api/v1/external/ssh/krl}"
HOST_ID="${HOST_ID:-$(hostname -f)}"
REVOKED_KEYS="${REVOKED_KEYS:-/etc/ssh/revoked_keys}"
STATE_FILE="${STATE_FILE:-/var/lib/krl-puller/version}"   # anti-rollback state

COSMIAN_BIN="${COSMIAN_BIN:-cosmian}"
HOST_PRIV_KEY_ID="${HOST_PRIV_KEY_ID:?set HOST_PRIV_KEY_ID to this host's KMS ECIES private key id}"
CA_PUBLIC_KEY_ID="${CA_PUBLIC_KEY_ID:?set CA_PUBLIC_KEY_ID to the Host CA public key id}"
CA_CURVE="${CA_CURVE:-nist-p256}"

CURL_OPTS=(--fail-with-body --silent --show-error --max-time 30)
log()  { printf '%s krl-puller: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die()  { log "ERROR: $*"; exit 1; }

for bin in curl jq base64 install sha256sum "${COSMIAN_BIN}"; do
  command -v "${bin}" >/dev/null 2>&1 || die "required command not found: ${bin}"
done

WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT

# 1. Local version for If-None-Match (the manager's sha256:<hex> ETag).
LOCAL_VERSION="$( [[ -f "${STATE_FILE}" ]] && cat "${STATE_FILE}" || echo 'sha256:none' )"
log "local KRL version: ${LOCAL_VERSION}"

# 2. POST {host_id} (host_id in the BODY, never the URL).
CT="${WORK}/krl.enc"
CODE="$(curl "${CURL_OPTS[@]}" -o "${CT}" -w '%{http_code}' \
  -X POST "${KRL_API_URL}" -H 'Content-Type: application/json' \
  -H "If-None-Match: ${LOCAL_VERSION}" \
  --data "$(jq -nc --arg h "${HOST_ID}" '{host_id: $h}')" || true)"

case "${CODE}" in
  304) log "KRL unchanged (304)"; exit 0 ;;
  200) log "new KRL (200); processing" ;;
  404) die "host not registered for KRL distribution (404)" ;;
  *)   die "unexpected HTTP ${CODE} from ${KRL_API_URL}" ;;
esac

# 3. ECIES-decrypt with this host's KMS key.
PT="${WORK}/payload.json"
"${COSMIAN_BIN}" kms ec decrypt --key-id "${HOST_PRIV_KEY_ID}" -o "${PT}" "${CT}" \
  || die "ECIES decrypt failed (wrong host?)"

KRL_B64="$(jq -r '.krl' "${PT}")"
SIG_B64="$(jq -r '.ca_signature' "${PT}")"
VERSION="$(jq -r '.krl_version' "${PT}")"
VALID_UNTIL="$(jq -r '.valid_until' "${PT}")"
PAYLOAD_HOST="$(jq -r '.host_id' "${PT}")"

[[ "${PAYLOAD_HOST}" == "${HOST_ID}" ]] || die "host_id mismatch: ${PAYLOAD_HOST} != ${HOST_ID}"
(( VALID_UNTIL > $(date +%s) )) || die "payload expired (valid_until=${VALID_UNTIL})"

KRL_NEW="${WORK}/revoked_keys.new"
printf '%s' "${KRL_B64}" | base64 -d > "${KRL_NEW}"

# 4. Verify the detached CA signature (DER) over the bare KRL bytes.
if [[ "${SIG_B64}" != "null" && -n "${SIG_B64}" ]]; then
  SIG="${WORK}/krl.sig"
  printf '%s' "${SIG_B64}" | base64 -d > "${SIG}"
  "${COSMIAN_BIN}" kms ec sign-verify --key-id "${CA_PUBLIC_KEY_ID}" --curve "${CA_CURVE}" \
    "${KRL_NEW}" "${SIG}" || die "CA signature verification FAILED — refusing to install"
fi

# 5. Version sanity + anti-rollback.
ACTUAL="sha256:$(sha256sum "${KRL_NEW}" | awk '{print $1}')"
[[ "${ACTUAL}" == "${VERSION}" ]] || die "version mismatch: bytes=${ACTUAL} advertised=${VERSION}"
if [[ "${LOCAL_VERSION}" != "sha256:none" && "${VERSION}" == "${LOCAL_VERSION}" ]]; then
  log "already current"; exit 0
fi

# 6. Atomic install + record version.
install -m 444 -o root -g root "${KRL_NEW}" "${REVOKED_KEYS}"
mkdir -p "$(dirname "${STATE_FILE}")"
printf '%s' "${VERSION}" > "${STATE_FILE}"
log "installed KRL ${VERSION} -> ${REVOKED_KEYS} (no sshd restart needed)"
