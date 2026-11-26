# Existing live suites, run by the acceptance runner only when ACCEPT_SUITES names them.
# The runner does not copy these tests: it calls them, and records PASS/FAIL/SKIP with the
# commit of the repository that holds them. Most bring their OWN stack (see each comment):
# for a release, they must be pointed at the release images or updated for the new runtime.
# shellcheck shell=bash

GROUP="$(cd "$REPO/.." && pwd)"
sha_of() { git -C "$1" rev-parse --short=12 HEAD 2>/dev/null || echo none; }
dirty_of() { [[ -n "$(git -C "$1" status --porcelain 2>/dev/null)" ]] && echo "+dirty" || true; }
# run_logged NAME DIR CMD...: run in DIR, log to $OUT/suite-NAME.log, PASS/FAIL with the commit.
run_logged() {
  local name="$1" dir="$2"; shift 2
  local log="$OUT/suite-$name.log" rev; rev="$(sha_of "$dir")$(dirty_of "$dir")"
  if (cd "$dir" && "$@") >"$log" 2>&1; then pass "$name at $rev ($(tail -1 "$log" | head -c 160))"
  else fail "$name at $rev: see $log ($(grep -m1 -iE 'fail|error' "$log" | head -c 200))"; fi
}

# Go unit tests of the SCEP gateway, the Kubernetes issuer and the KRL client (no stack needed).
suite_go_unit() {
  need go || return 0
  local m
  for m in scep k8s/issuer krl-client; do run_logged "go-test-${m//\//-}" "$REPO/$m" go test -count=1 ./...; done
}

# CLI: its own unit tests, then a live smoke against $API (health, CA, issue, download, verify).
suite_cli() {
  local dir="${ACCEPT_CLI_DIR:-$GROUP/pki-manager-cli}"
  [[ -d "$dir" ]] || { skip "CLI checkout $dir is absent"; return 0; }
  need cargo openssl jq || return 0
  run_logged cli-cargo-test "$dir" cargo test --locked
  (cd "$dir" && cargo build --release --locked) >"$OUT/suite-cli-build.log" 2>&1 || { fail "cargo build --release"; return 0; }
  local pki="$dir/target/release/pki" w="$WORK/cli"; mkdir -p "$w"
  export PKI_API_URL="$API/api/v1"; [[ -n "${ACCEPT_TOKEN:-}" ]] && export PKI_TOKEN="$ACCEPT_TOKEN"
  local rev; rev="$(sha_of "$dir")$(dirty_of "$dir")"
  assert "CLI $rev: pki health" "$pki" health
  local ca id
  ca="$(sed -n 1p "$WORK/ca-ids" 2>/dev/null)"
  [[ -n "$ca" ]] || { fail "CLI: needs a CA from the x509 checks"; return 0; }
  "$pki" ca get "$ca" >"$w/ca-get.txt" 2>&1 && pass "CLI: pki ca get" || fail "CLI: pki ca get ($(head -c 200 "$w/ca-get.txt"))"
  if "$pki" cert issue --ca "$ca" --cn "cli-$RUN_TAG.accept.test" --type server -a ECDSA-P256 -v 30 -O "Acceptance Test" -c ES -o json >"$w/issue.json" 2>"$w/issue.err"; then
    id="$(jq -r '.id // .certificate.id' "$w/issue.json")"
    pass "CLI: pki cert issue ($id)"
    (cd "$w" && "$pki" cert download "$id" -f pem -o "$w/cli.pem") >"$w/dl.log" 2>&1 && \
      assert "CLI: downloaded certificate verifies against the CA" verify_chain "$WORK/ca-$ca.pem" "$w/cli.pem" || fail "CLI: pki cert download ($(head -c 200 "$w/dl.log"))"
    (cd "$w" && "$pki" cert download "$id" -f chain-pem -o "$w/cli-chain.pem") >>"$w/dl.log" 2>&1 && \
      assert "CLI: chain-pem has the issuing CA" bash -c "[ \$(grep -c 'BEGIN CERT' '$w/cli-chain.pem') -ge 2 ]" || fail "CLI: chain-pem download"
  else fail "CLI: pki cert issue ($(head -c 300 "$w/issue.err"))"; fi
  "$pki" ssh --help >/dev/null 2>&1 && pass "CLI: ssh commands present" || fail "CLI: ssh commands"
}

# Ansible collection (sibling repo). It starts ITS OWN PKI Manager from tests/integration/compose.yml
# with the same candidate backend and fork under test.
suite_ansible_collection() {
  local dir="${ACCEPT_ANSIBLE_DIR:-$GROUP/pki-manager-ansible}"
  [[ -x "$dir/tests/integration/run.sh" ]] || { skip "Ansible collection checkout $dir is absent"; return 0; }
  need ansible-playbook docker || return 0
  PKI_WEB_DIR="$REPO" PKI_IMAGE="${ACCEPT_BACKEND_IMAGE:?candidate backend image required}" COMPOSE_PROJECT_NAME="ansible-$RUN_TAG" PKI_IMAGE_TAG="${ACCEPT_ANSIBLE_PKI_TAG:-4.0.0}" PKI_PORT="${ACCEPT_ANSIBLE_PORT:-47650}" \
    PKI_IT_TARGET="pki-ansible-it-target-$RUN_TAG" \
    run_logged "ansible-collection-integration(pki ${ACCEPT_ANSIBLE_PKI_TAG:-4.0.0})" "$dir" tests/integration/run.sh
}

# ssh_host_cert role e2e in this repository (containers as hosts, real ssh logins, KRL pullers).
# It starts its own backend + KMS (ansible/tests/e2e/docker-compose.yml).
suite_ansible_e2e() {
  [[ -x "$REPO/ansible/tests/e2e/run.sh" ]] || { skip "ansible/tests/e2e/run.sh is absent"; return 0; }
  need ansible-playbook docker || return 0
  E2E_STRICT=1 run_logged ansible-ssh-host-cert-e2e "$REPO/ansible/tests/e2e" ./run.sh
}

# Issue real certificates through the candidate. Each protocol owns its test identity.
suite_scep() {
  need go jq curl || return 0
  run_logged scep-live "$REPO" bash tests/acceptance/protocols.sh scep
}

suite_k8s() {
  need kind kubectl helm make docker openssl jq curl || return 0
  run_logged k8s-live "$REPO" bash tests/acceptance/protocols.sh kubernetes
}

# Web UI RBAC with a real OIDC login (Playwright, docker/docker-compose.e2e.yml, fixed ports 53000/58080/58180).
suite_playwright_rbac() {
  need docker || return 0
  [[ -x "$REPO/node_modules/.bin/playwright" ]] || { skip "playwright is not installed (pnpm install)"; return 0; }
  local p; for p in 53000 58080 58180; do
    (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && { skip "port $p is in use: the RBAC stack cannot start"; return 0; }
  done
  run_logged playwright-rbac "$REPO" bash tests/acceptance/rbac.sh
}
