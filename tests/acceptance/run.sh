#!/usr/bin/env bash
# Release acceptance: black-box positive checks of a PKI Manager stack.
#
#   tests/acceptance/run.sh                     disposable OpenBao stack, built from this checkout
#   ACCEPT_PROFILE=baseline-v3 run.sh           isolated v3 source for migration rehearsal
#   ACCEPT_PROFILE=openbao-v4 ACCEPT_BUILD=1 run.sh
#                                               disposable v4 stack: OpenBao fork, no Cosmian, backend and
#                                               frontend images built from this checkout
#   ACCEPT_STACK=none API=http://... run.sh     an already running stack (no backup/restore check)
#   ACCEPT_COMPOSE_FILES=a.yml:b.yml run.sh     any compose stack that keeps its state in named volumes
#   ACCEPT_CHECKS="x509_ca_profiles ssh" run.sh only these checks (default: all core checks)
#   ACCEPT_SUITES="scep k8s ansible cli" run.sh also run the existing live suites (see checks/suites.sh)
#   ACCEPT_STRICT=1 run.sh                      a SKIP counts as a failure (release mode)
#   KEEP=1 run.sh                               leave the stack up at the end
#
# The runner only talks HTTP to the stack (REST, tRPC, public CRL/KRL/SSH endpoints) and checks
# every answer with OpenSSL, ssh-keygen, keytool and a real sshd. It never touches a stack it did
# not start, except the one given with ACCEPT_STACK=none, and never stops another project.
#
# Output: $OUT/results.tsv (PASS/FAIL/SKIP per assertion), $OUT/summary.json (SHAs, images,
# counts), $OUT/http.log. Exit 0 only when nothing failed (and, in strict mode, nothing skipped).
#
# Needs: bash, curl, jq, openssl, ssh-keygen, docker (compose v2). Optional: keytool, go, cargo,
# ansible-playbook, kind/kubectl/helm (for the suites).
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

export RUN_TAG="${RUN_TAG:-$(date +%Y%m%d%H%M%S)}"
export OUT="${OUT:-${TMPDIR:-/tmp}/pki-accept-$RUN_TAG}"
export WORK="$OUT/work" ACCEPT_RUN_DIR="$OUT/run"
mkdir -p "$OUT"
if ! mkdir "$OUT/.acceptance-run"; then
  echo "Use a new OUT directory for each acceptance run." >&2; exit 1
fi
if [[ -e "$ACCEPT_RUN_DIR/driver/projects" || -e "$OUT/results.tsv" ]]; then
  echo "Output directory already contains an acceptance run." >&2; exit 1
fi
mkdir -p "$WORK" "$ACCEPT_RUN_DIR"
: > "$OUT/results.tsv"

# ---------- stack ----------
ACCEPT_STACK="${ACCEPT_STACK:-compose}"
export ACCEPT_API_PORT="${ACCEPT_API_PORT:-47610}" ACCEPT_UI_PORT="${ACCEPT_UI_PORT:-47680}"
export ACCEPT_PROFILE="${ACCEPT_PROFILE:-openbao-v4}"
if [[ "$ACCEPT_STACK" == compose && "$ACCEPT_PROFILE" == openbao-v4 && -z "${ACCEPT_BACKEND_IMAGE:-}" && -z "${ACCEPT_FRONTEND_IMAGE:-}" ]]; then
  ACCEPT_BUILD="${ACCEPT_BUILD:-1}"
fi
# ACCEPT_BUILD=1: images from this checkout, tagged with its commit (+dirty when it has changes).
if [[ "${ACCEPT_BUILD:-}" == 1 ]]; then
  src="$(git -C "$REPO" rev-parse --short=12 HEAD)$( [[ -n "$(git -C "$REPO" status --porcelain -- backend frontend docker package.json pnpm-lock.yaml)" ]] && echo -dirty)"
  export ACCEPT_IMAGE_SOURCE="$src"
  for t in backend frontend; do
    echo "== build $t image from $REPO ($src)" >&2
    docker build -q --target "$t" -t "pki-accept-$t:$src" -f "$REPO/docker/Dockerfile" "$REPO" >"$OUT/build-$t.log" 2>&1       || { tail -30 "$OUT/build-$t.log" >&2; echo "image build failed: $t" >&2; exit 1; }
  done
  export ACCEPT_BACKEND_IMAGE="pki-accept-backend:$src" ACCEPT_FRONTEND_IMAGE="pki-accept-frontend:$src"
fi
if [[ "$ACCEPT_STACK" == compose ]]; then
  case "$ACCEPT_PROFILE" in
    baseline-v3)
      export ACCEPT_COMPOSE_FILES="${ACCEPT_COMPOSE_FILES:-$HERE/stacks/baseline-v3.compose.yml}"
      export ACCEPT_PREPARE_HOOK="${ACCEPT_PREPARE_HOOK:-$HERE/stacks/baseline-v3.prepare.sh}" ;;
    openbao-v4)
      export ACCEPT_COMPOSE_FILES="${ACCEPT_COMPOSE_FILES:-$HERE/stacks/openbao-v4.compose.yml}"
      export ACCEPT_ENV_HOOK="${ACCEPT_ENV_HOOK:-$HERE/stacks/openbao-v4.hooks.sh env}"
      export ACCEPT_PREPARE_HOOK="${ACCEPT_PREPARE_HOOK:-$HERE/stacks/openbao-v4.hooks.sh prepare}"
      export ACCEPT_UP_HOOK="${ACCEPT_UP_HOOK:-$HERE/stacks/openbao-v4.hooks.sh}"
      : "${ACCEPT_FRONTEND_IMAGE:?openbao-v4 needs the matching ACCEPT_FRONTEND_IMAGE or ACCEPT_BUILD=1}"
      : "${ACCEPT_BACKEND_IMAGE:?openbao-v4 needs ACCEPT_BACKEND_IMAGE or ACCEPT_BUILD=1}" ;;
    custom) : "${ACCEPT_COMPOSE_FILES:?ACCEPT_PROFILE=custom needs ACCEPT_COMPOSE_FILES}" ;;
    *) echo "unknown ACCEPT_PROFILE $ACCEPT_PROFILE" >&2; exit 2 ;;
  esac
  export ACCEPT_PROJECT="${ACCEPT_PROJECT:-pki-accept-$RUN_TAG}"
  export API="${API:-http://localhost:$ACCEPT_API_PORT}" UI="${UI:-http://localhost:$ACCEPT_UI_PORT}"
  STACK=("$HERE/stacks/compose.sh")
  for p in "$ACCEPT_API_PORT" "$ACCEPT_UI_PORT"; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
      echo "port $p is in use: set ACCEPT_API_PORT / ACCEPT_UI_PORT" >&2; exit 2
    fi
  done
else
  : "${API:?ACCEPT_STACK=none needs API=<base URL>}"
  export UI="${UI:-}"
  STACK=()
fi
stack() { [[ ${#STACK[@]} -gt 0 ]] && "${STACK[@]}" "$@"; }

cleanup() {
  local rc=$?
  docker rm -f "pki-accept-sshd-$RUN_TAG" >/dev/null 2>&1 || true
  if [[ ${#STACK[@]} -gt 0 ]]; then
    stack logs > "$OUT/stack.log" 2>&1 || true
    if [[ "${KEEP:-}" == 1 ]]; then echo "KEEP=1: stack $(stack project) left up" >&2
    else stack down >/dev/null 2>&1 || true; fi
  fi
  exit $rc
}
trap cleanup EXIT

# ---------- run ----------
# shellcheck source=lib.sh
source "$HERE/lib.sh"
# shellcheck disable=SC1090
for f in "$HERE"/checks/*.sh; do source "$f"; done

CORE_CHECKS=(health ui x509_ca_profiles x509_leaf_profiles x509_trpc_parity x509_exports x509_renew
  x509_revoke_crl x509_external_csr ssh_ca ssh_user_host ssh_krl ssh_sshd audit backup_restore)
read -ra CHECKS <<< "${ACCEPT_CHECKS:-${CORE_CHECKS[*]}}"
read -ra SUITES <<< "${ACCEPT_SUITES:-}"

if [[ ${#STACK[@]} -gt 0 ]]; then
  echo "== stack up: $ACCEPT_COMPOSE_FILES (project $ACCEPT_PROJECT)" >&2
  stack up >"$OUT/stack-up.log" 2>&1 || { tail -30 "$OUT/stack-up.log" >&2; echo "stack did not start" >&2; exit 1; }
  stack images > "$OUT/images.txt"
fi

run_check() {
  local fn="$1"; CHECK="${1#check_}"
  echo "== $CHECK" >&2
  if ! declare -F "$fn" >/dev/null; then fail "unknown check"; return; fi
  local before; before="$(wc -l < "$RESULTS")"
  # A check runs in a subshell: an unexpected error ends that check only.
  # The return code of a check is not a result: only assertions are.
  ( set +e; set -uo pipefail; "$fn" ) || _record FAIL "check aborted (exit $?)"
  if [[ "$(wc -l < "$RESULTS")" -eq "$before" ]]; then fail "check produced no assertions"; fi
}
for c in "${CHECKS[@]}"; do run_check "check_$c"; done
for s in "${SUITES[@]}"; do run_check "suite_$s"; done

# ---------- summary ----------
count() { awk -F'\t' -v s="$1" '$1==s' "$RESULTS" | wc -l | tr -d ' '; }
P=$(count PASS) F=$(count FAIL) S=$(count SKIP)
images_json="$(if [[ -f "$OUT/images.txt" ]]; then jq -Rn '[inputs | split(" ") | {service:.[0], image:.[1], digest:.[2]}]' < "$OUT/images.txt"; else echo '[]'; fi)"
jq -n --arg tag "$RUN_TAG" --arg api "$API" --arg stack "$ACCEPT_STACK" --arg files "${ACCEPT_COMPOSE_FILES:-}" \
  --arg profile "$ACCEPT_PROFILE" --arg imgsrc "${ACCEPT_IMAGE_SOURCE:-published}" \
  --arg web "$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)" \
  --arg dirty "$(git -C "$REPO" status --porcelain 2>/dev/null | wc -l | tr -d ' ')" \
  --arg version "$(cat "$WORK/version" 2>/dev/null || echo unknown)" \
  --argjson images "$images_json" --argjson pass "$P" --argjson fail "$F" --argjson skip "$S" \
  --argjson checks "$(printf '%s\n' "${CHECKS[@]}" "${SUITES[@]/#/suite_}" | jq -R . | jq -s 'map(select(length>0))')" \
  '{runTag:$tag, api:$api, stack:$stack, profile:$profile, composeFiles:$files, imageSource:$imgsrc,
    harnessCommit:$web, harnessDirtyFiles:($dirty|tonumber),
    apiVersion:$version, images:$images, checks:$checks, pass:$pass, fail:$fail, skip:$skip}' > "$OUT/summary.json"

echo >&2
awk -F'\t' '$1!="PASS"{printf "%s %s: %s\n",$1,$2,$3}' "$RESULTS" >&2
echo "acceptance: $P passed, $F failed, $S skipped. Results: $OUT/results.tsv, $OUT/summary.json" >&2
[[ $F -eq 0 ]] || exit 1
[[ "${ACCEPT_STRICT:-}" == 1 && $S -gt 0 ]] && { echo "strict mode: skips count as failures" >&2; exit 1; }
exit 0
