#!/usr/bin/env bash
# Demo stack for the documentation (fake data only, never prod).
#   demo/demo.sh up      start a CLEAN stack (old demo volumes are deleted)
#   demo/demo.sh down    stop it and delete its volumes
#   demo/demo.sh token   print an access token for the demo admin (alex)
#   demo/demo.sh shots   up + screenshots/screencasts for the guides (tests in demo/shots.spec.ts)
# UI http://localhost:47380 · API http://localhost:47300 · Keycloak http://localhost:47381
# Users: alex / Demo-Pass-1 (admin), uma / Demo-Pass-1 (user)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# The release that runs the API examples in CI. Each guide says which release took its screenshots.
export IMAGE_TAG="${IMAGE_TAG:-3.17.0}"
export BACKEND_EXTERNAL_PORT=47300 FRONTEND_EXTERNAL_PORT=47380
export FRONTEND_URL=http://localhost:47380 CRL_DISTRIBUTION_URL=http://localhost:47300/crl
export DEMO_DIR="$HERE"  # the UI finds the API through config.demo.json (apiUrl)
dc() { docker compose -p pki-demo -f "$REPO/docker/docker-compose.yml" -f "$HERE/compose.demo.yml" "$@"; }

up() {
  rm -rf "$HERE/.run" "$REPO/docs/guides/video/.tmp"
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  # The containers read these mounted files as another user: a clone made with umask 077 gives 403 on config.json.
  chmod a+r "$HERE/config.demo.json" "$HERE/keycloak-demo-realm.json" "$REPO/kms/kms.toml"
  dc pull -q kms backend frontend keycloak
  dc up -d --no-build --wait
  echo "demo stack up: UI http://localhost:47380 (alex / Demo-Pass-1), API http://localhost:47300 (images $IMAGE_TAG)"
}
token() {
  curl -fsS http://localhost:47381/realms/pki-demo/protocol/openid-connect/token \
    -d grant_type=password -d client_id=pki-web -d username="${1:-alex}" -d password=Demo-Pass-1 -d scope=openid | jq -r .access_token
}
case "${1:-}" in
  up) up ;;
  down) dc down -v --remove-orphans ;;
  token) token "${2:-alex}" ;;
  shots) up; cd "$HERE" && "$REPO/node_modules/.bin/playwright" test --config playwright.config.ts "${@:2}" ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
