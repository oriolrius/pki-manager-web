#!/usr/bin/env bash
# Demo stack for the documentation (fake data only, never prod).
#   demo/demo.sh up      start a CLEAN stack (old demo volumes are deleted)
#   demo/demo.sh down    stop it and delete its volumes
#   demo/demo.sh token   print an access token for the demo admin (alex)
#   demo/demo.sh shots   up + screenshots/screencasts for the guides (tests in demo/shots/)
#   demo/demo.sh check   browser check of the CSP with an OIDC login (stack must be up; demo/checks/)
# DEMO_BUILD=1 builds the backend and frontend images from this checkout (tag "local") and
# does not pull them: use it to test the code of a branch before its release.
# UI http://localhost:47380 · API http://localhost:47300 · Keycloak http://localhost:47381
# Users: alex / Demo-Pass-1 (admin), uma / Demo-Pass-1 (user)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# The release that runs the API examples in CI. Each guide says which release took its screenshots.
if [[ "${DEMO_BUILD:-}" == 1 ]]; then export IMAGE_TAG="${IMAGE_TAG:-local}"; fi
export IMAGE_TAG="${IMAGE_TAG:-4.0.0}"
export BACKEND_EXTERNAL_PORT=47300 FRONTEND_EXTERNAL_PORT=47380
export FRONTEND_URL=http://localhost:47380 CRL_DISTRIBUTION_URL=http://localhost:47300/crl
export DEMO_DIR="$HERE"  # the UI finds the API through config.demo.json (apiUrl)
export OPENBAO_TEST_ROOT="${OPENBAO_TEST_ROOT:-$REPO/.openbao-test}"
export OPENBAO_TEST_CLIENT_DIR="$OPENBAO_TEST_ROOT/docs-demo/client" OPENBAO_TEST_NETWORK=pki-manager-openbao-test-docs-demo_default
# The production-only services in the overlay still need a Compose image value.
export OPENBAO_IMAGE="${OPENBAO_IMAGE:-$(bash "$REPO/scripts/openbao-image.sh" ensure)}"
dc() { docker compose -p pki-demo -f "$REPO/docker/docker-compose.yml" -f "$HERE/compose.demo.yml" "$@"; }

up() {
  rm -rf "$HERE/.run" "$REPO/docs/guides/video/.tmp"
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  bash "$REPO/scripts/openbao-test.sh" down docs-demo
  bash "$REPO/scripts/openbao-test.sh" up docs-demo >/dev/null
  bash "$REPO/scripts/openbao-test.sh" client docs-demo >/dev/null
  # The containers read these mounted files as another user: a clone made with umask 077 gives 403 on config.json.
  chmod a+r "$HERE/config.demo.json" "$HERE/keycloak-demo-realm.json"
  if [[ "${DEMO_BUILD:-}" == 1 ]]; then
    dc pull -q keycloak
    dc build backend frontend
  else
    dc pull -q backend frontend keycloak
  fi
  dc up -d --no-build --wait
  echo "demo stack up: UI http://localhost:47380 (alex / Demo-Pass-1), API http://localhost:47300 (images $IMAGE_TAG)"
}
token() {
  curl -fsS http://localhost:47381/realms/pki-demo/protocol/openid-connect/token \
    -d grant_type=password -d client_id=pki-web -d username="${1:-alex}" -d password=Demo-Pass-1 -d scope=openid | jq -r .access_token
}
case "${1:-}" in
  up) up ;;
  down) dc down -v --remove-orphans; bash "$REPO/scripts/openbao-test.sh" down docs-demo ;;
  token) token "${2:-alex}" ;;
  shots) up; cd "$HERE" && "$REPO/node_modules/.bin/playwright" test --config playwright.config.ts "${@:2}" ;;
  check) cd "$HERE" && "$REPO/node_modules/.bin/playwright" test --config playwright.checks.config.ts "${@:2}" ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
