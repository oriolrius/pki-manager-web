#!/usr/bin/env bash
# Hooks of the OpenBao v4 acceptance stack (openbao-v4.compose.yml), called by compose.sh.
#
#   openbao-v4.hooks.sh env       print KEY=VALUE lines for compose (image refs, uid/gid)
#   openbao-v4.hooks.sh prepare   state dirs, dev TLS, the UI config (once per run)
#   openbao-v4.hooks.sh up        start OpenBao, bootstrap it (dev/test), then the rest
#
# "up" also serves a restore: the restored Raft data starts sealed, `bootstrap dev` is
# idempotent (it unseals with the stored dev key and reuses a valid backend token).
# Images: OPENBAO_IMAGE (default: scripts/openbao-image.sh ensure), ACCEPT_BACKEND_IMAGE and
# ACCEPT_FRONTEND_IMAGE (run.sh builds them from the checkout with ACCEPT_BUILD=1).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
: "${ACCEPT_RUN_DIR:?}" "${ACCEPT_STATE_DIR:?}"

case "${1:-}" in
  env)
    echo "OPENBAO_IMAGE=${OPENBAO_IMAGE:-$(bash "$REPO/scripts/openbao-image.sh" ensure)}"
    echo "ACCEPT_UID=$(id -u)"; echo "ACCEPT_GID=$(id -g)"; echo "ACCEPT_REPO=$REPO"
    ;;
  prepare)
    mkdir -p "$ACCEPT_STATE_DIR"/openbao/{data,logs,tls,secrets}
    bash "$REPO/openbao/scripts/dev-tls.sh" "$ACCEPT_STATE_DIR/openbao/tls" >&2
    # The backend (uid 1001) reads the CA certificate; it is public.
    chmod 0644 "$ACCEPT_STATE_DIR/openbao/tls/ca.pem"
    printf '{"apiUrl":"http://localhost:%s/trpc"}\n' "${ACCEPT_API_PORT:?}" > "$ACCEPT_RUN_DIR/config.json"
    chmod 0644 "$ACCEPT_RUN_DIR/config.json"
    ;;
  up)
    : "${ACCEPT_DC:?compose.sh sets ACCEPT_DC}"
    $ACCEPT_DC up -d --quiet-pull --wait --wait-timeout 120 openbao
    $ACCEPT_DC run --rm -T bootstrap dev
    $ACCEPT_DC up -d --quiet-pull --wait --wait-timeout "${ACCEPT_WAIT_TIMEOUT:-300}"
    ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
