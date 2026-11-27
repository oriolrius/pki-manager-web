#!/usr/bin/env bash
# Run the browser suite against candidate images with an isolated OpenBao fork.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"
: "${RUN_TAG:?}" "${OUT:?}"
instance="rbac-${RUN_TAG,,}"
dc=(docker compose -p "$instance" -f docker/docker-compose.e2e.yml)
cleanup() {
  if [[ -n "${OPENBAO_TEST_NETWORK:-}" ]]; then
    "${dc[@]}" logs --tail 100 > "$OUT/rbac-stack.log" 2>&1 || true
    "${dc[@]}" down -v >&2
  fi
  bash scripts/openbao-test.sh down "$instance" >&2
}
trap cleanup EXIT
bash scripts/openbao-test.sh up "$instance" >/dev/null
settings="$(bash scripts/openbao-test.sh client "$instance")"
while IFS= read -r setting; do export "$setting"; done <<< "$settings"
# Both files are public fixtures mounted by unprivileged container users.
chmod a+r docker/config.e2e.json docker/keycloak-e2e-realm.json
"${dc[@]}" up -d --wait --wait-timeout 300
pnpm exec playwright test tests/e2e-rbac.spec.ts --reporter=list --output="$OUT/browser-results"
