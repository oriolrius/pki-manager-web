#!/usr/bin/env bash
# Checks the security headers of a built frontend image (issue #66).
#
#   docker/check-security-headers.sh <image> [host-port]
#
# It starts the image with a test config.json and asserts:
# - the SPA pages, silent-renew.html, config.json, an asset and /health have every security
#   header and the SPA CSP (script-src 'self' without 'unsafe-inline', the config.json origins,
#   cspSources included, in connect-src and frame-src);
# - a proxied backend path has the security headers but not the SPA CSP;
# - a config.json without apiUrl allows the build-time API origin;
# - text in config.json that is not an origin does not reach the nginx configuration.
# CI runs it in .github/workflows/docker-build.yml.
set -euo pipefail

IMAGE="${1:?usage: $0 <image> [host-port]}"
PORT="${2:-18080}"
BASE="http://127.0.0.1:${PORT}"
NAME="pki-headers-check-$$"
WORK="$(mktemp -d)"
FAILED=0

cleanup() {
  docker rm -f "$NAME" "$NAME-empty" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

cat >"$WORK/config.json" <<'JSON'
{
  "apiUrl": "http://localhost:3000/trpc",
  "oidc": { "authority": "https://id.example.test/realms/pki", "clientId": "pki-web" },
  "cspSources": ["https://sso.example.test:8443", "https://x.example.test\"; script-src *"]
}
JSON
chmod 755 "$WORK"
chmod 644 "$WORK/config.json"

fail() { echo "FAIL: $*"; FAILED=1; }

# `backend` must resolve at nginx start; nothing listens there, so proxied paths answer 502.
docker run -d --name "$NAME" --add-host backend:127.0.0.1 -p "127.0.0.1:${PORT}:8080" \
  -v "$WORK/config.json:/usr/share/nginx/html/config.json:ro" "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "$BASE/health" 2>/dev/null && break
  sleep 1
done

headers() { curl -sS -o /dev/null -D - "$BASE$1" | tr -d '\r'; }
header() { { grep -i "^$2:" <<<"$1" || true; } | head -1 | cut -d' ' -f2-; }

check_common() {
  local path="$1" h="$2"
  [[ "$(header "$h" X-Frame-Options)" == "SAMEORIGIN" ]] || fail "$path: X-Frame-Options"
  [[ "$(header "$h" X-Content-Type-Options)" == "nosniff" ]] || fail "$path: X-Content-Type-Options"
  [[ "$(header "$h" Referrer-Policy)" == "strict-origin-when-cross-origin" ]] || fail "$path: Referrer-Policy"
  [[ "$(header "$h" X-XSS-Protection)" == "0" ]] || fail "$path: X-XSS-Protection"
}

check_csp() {
  local path="$1" h="$2" csp
  csp="$(header "$h" Content-Security-Policy)"
  [[ -n "$csp" ]] || { fail "$path: no Content-Security-Policy"; return; }
  [[ "$csp" == *"script-src 'self';"* ]] || fail "$path: script-src is not 'self' only: $csp"
  [[ "$csp" != *"script-src *"* ]] || fail "$path: config.json text reached the CSP: $csp"
  [[ "$csp" == *"frame-ancestors 'self'"* ]] || fail "$path: no frame-ancestors 'self'"
  [[ "$csp" == *"object-src 'none'"* ]] || fail "$path: no object-src 'none'"
  [[ "$csp" == *"connect-src 'self' http://localhost:3000 https://id.example.test https://sso.example.test:8443 https://x.example.test;"* ]] \
    || fail "$path: connect-src misses the config.json origins: $csp"
  [[ "$csp" == *"frame-src 'self' http://localhost:3000 https://id.example.test https://sso.example.test:8443 https://x.example.test;"* ]] \
    || fail "$path: frame-src misses the config.json origins: $csp"
}

ASSET="$(curl -fsS "$BASE/" | grep -oE '/assets/[^"]+\.js' | head -1)"
[[ -n "$ASSET" ]] || fail "no /assets/*.js in index.html"

for path in / /index.html /certificates /silent-renew.html /config.json "$ASSET" /vite.svg /health; do
  h="$(headers "$path")"
  status="$(head -1 <<<"$h" | cut -d' ' -f2)"
  [[ "$status" == "200" ]] || fail "$path: HTTP $status"
  check_common "$path" "$h"
  check_csp "$path" "$h"
  echo "checked $path"
done

for path in /api/v1/health /trpc/health /crl/x.crl /ssh/host-ca-keys; do
  h="$(headers "$path")"
  check_common "$path" "$h"
  [[ -z "$(header "$h" Content-Security-Policy)" ]] || fail "$path: proxied path has the SPA CSP"
  echo "checked $path (proxied)"
done

# A config.json without apiUrl: the CSP allows the build-time API origin of the bundle.
BUILD_ORIGIN="$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" \
  | sed -n 's/^PKI_BUILD_API_URL=//p' | grep -oE '^https?://[A-Za-z0-9.-]+(:[0-9]+)?' || true)"
echo '{}' >"$WORK/empty.json"
chmod 644 "$WORK/empty.json"
docker run -d --name "$NAME-empty" --add-host backend:127.0.0.1 -p "127.0.0.1:$((PORT + 1)):8080" \
  -v "$WORK/empty.json:/usr/share/nginx/html/config.json:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:$((PORT + 1))/health" 2>/dev/null && break
  sleep 1
done
csp="$(curl -sS -o /dev/null -D - "http://127.0.0.1:$((PORT + 1))/" | tr -d '\r' \
  | { grep -i '^Content-Security-Policy:' || true; })"
docker rm -f "$NAME-empty" >/dev/null 2>&1 || true
if [[ -n "$BUILD_ORIGIN" && "$csp" == *"connect-src 'self' $BUILD_ORIGIN;"* ]]; then
  echo "checked empty config.json (connect-src 'self' $BUILD_ORIGIN)"
else
  fail "empty config.json: connect-src misses the build-time API origin '$BUILD_ORIGIN': $csp"
fi

if [[ "$FAILED" -ne 0 ]]; then
  docker logs "$NAME" 2>&1 | tail -20
  exit 1
fi
echo "OK: security headers"
