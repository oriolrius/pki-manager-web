#!/usr/bin/env bash
# openbao-test.sh — a throw-away OpenBao of the pinned fork for tests (CI and local).
#
#   up [NAME]     start an isolated instance (own Compose project, container, free port,
#                 state dir), bootstrap it in dev/test mode, print its backend settings
#   env [NAME]    print the settings again: OPENBAO_ADDR, OPENBAO_CACERT, OPENBAO_TOKEN_FILE
#   check [NAME]  run openbao/scripts/check-backend-token.sh against it
#   down [NAME]   remove the containers and the state
#
# NAME defaults to "test". It never touches the dev stack (`just dev`, port 42996).
# The output of `up` and `env` is KEY=VALUE lines: `bash scripts/openbao-test.sh up ci
# >> "$GITHUB_ENV"`, or `eval "$(bash scripts/openbao-test.sh env)"` (values have no
# spaces). Logs go to stderr. State: ${OPENBAO_TEST_ROOT:-$REPO/.openbao-test}/NAME.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CMD="${1:-}"; NAME="${2:-test}"
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || { echo "openbao-test: bad NAME '$NAME'" >&2; exit 2; }
ROOT="${OPENBAO_TEST_ROOT:-$REPO/.openbao-test}"
STATE="$ROOT/$NAME"
PROJECT="pki-manager-openbao-test-$NAME"

compose() {
  OPENBAO_IMAGE="${OPENBAO_IMAGE:-$(bash "$REPO/scripts/openbao-image.sh" ensure)}" \
  OPENBAO_CONTAINER="$PROJECT" OPENBAO_STATE_DIR="$STATE" OPENBAO_PORT="" OPENBAO_BIND=127.0.0.1 \
  OPENBAO_UID="$(id -u)" OPENBAO_GID="$(id -g)" \
    docker compose -p "$PROJECT" --project-directory "$REPO/openbao" -f "$REPO/openbao/docker-compose.yml" "$@"
}

print_env() {
  local port
  port="$(compose port openbao 8200 2>/dev/null | sed 's/.*://')"
  [ -n "$port" ] || { echo "openbao-test: '$NAME' is not running" >&2; exit 1; }
  echo "OPENBAO_ADDR=https://localhost:$port"
  echo "OPENBAO_CACERT=$STATE/tls/ca.pem"
  echo "OPENBAO_TOKEN_FILE=$STATE/secrets/backend-token"
  echo "OPENBAO_TRANSIT_MOUNT=pki-manager"
  echo "OPENBAO_RA_MOUNT=pki-manager-ra"
}

case "$CMD" in
  up)
    command -v openssl >/dev/null || { echo "openbao-test: openssl is required" >&2; exit 1; }
    mkdir -p "$STATE"/{data,logs,tls,secrets}
    bash "$REPO/openbao/scripts/dev-tls.sh" "$STATE/tls" >&2
    export OPENBAO_IMAGE="${OPENBAO_IMAGE:-$(bash "$REPO/scripts/openbao-image.sh" ensure)}"
    compose up -d --wait --wait-timeout 120 openbao >&2
    compose run --rm -T bootstrap dev >&2
    print_env
    ;;
  env) print_env ;;
  check)
    env $(print_env) CHECK_RA="${CHECK_RA:-1}" bash "$REPO/openbao/scripts/check-backend-token.sh" >&2
    ;;
  down)
    if [ -d "$STATE" ]; then
      compose down -v --remove-orphans >&2 2>&1 || true
      rm -rf "$STATE"
    fi
    echo "openbao-test: '$NAME' removed" >&2
    ;;
  *) sed -n 's/^#   //p' "${BASH_SOURCE[0]}" >&2; exit 2 ;;
esac
