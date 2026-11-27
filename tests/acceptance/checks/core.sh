# Core checks: API reachability, web UI delivery, audit trail.
# shellcheck shell=bash

check_health() {
  need curl jq || return 0
  api GET /health && assert "GET /health is ok" test "$(jb .status)" = ok || fail "GET /health (HTTP $STATUS)"
  if api GET /api/docs/json; then
    jb .info.version > "$WORK/version"
    pass "OpenAPI document served (version $(cat "$WORK/version"), $(jq '.paths | length' "$BODY_FILE") paths)"
    jq -S '.paths | keys' "$BODY_FILE" > "$OUT/openapi-paths.json"
  else fail "GET /api/docs/json (HTTP $STATUS)"; fi
  api GET /api/v1/cas/?limit=1 && pass "management REST API answers" || fail "GET /api/v1/cas (HTTP $STATUS)"
}

check_ui() {
  [[ -n "${UI:-}" ]] || { skip "no UI URL (set UI=)"; return 0; }
  need curl || return 0
  local h="$WORK/ui-headers" js
  curl -fsS -D "$h" -o "$WORK/ui-index.html" "$UI/" && pass "UI index served" || { fail "UI index"; return 0; }
  assert "UI index is the SPA" grep -qi '<div id="root"' "$WORK/ui-index.html"
  assert "UI sends a Content-Security-Policy" grep -qi '^content-security-policy:' "$h"
  curl -fsS "$UI/config.json" -o "$WORK/ui-config.json" && assert "UI config.json points to the API" bash -c "jq -e '.apiUrl | test(\"/trpc\$\")' '$WORK/ui-config.json'" || fail "UI config.json"
  js="$(grep -oE '/assets/[^"]+\.js' "$WORK/ui-index.html" | head -1)"
  [[ -n "$js" ]] && curl -fsS -o /dev/null "$UI$js" && pass "UI bundle $js served" || fail "UI bundle"
  # SPA routes answer with the index (deep links work).
  local r
  for r in /cas /certificates /ssh /integrations; do
    curl -fsS -o "$WORK/ui-route" "$UI$r" && grep -qi '<div id="root"' "$WORK/ui-route" && pass "UI deep link $r" || fail "UI deep link $r"
  done
}

check_audit() {
  need jq || return 0
  api GET "/api/v1/audit?limit=200" || { fail "GET /api/v1/audit (HTTP $STATUS)"; return 0; }
  jq -r '(.items // .data // .)[] | .operation // .action' "$BODY_FILE" | sort | uniq -c | sort -rn > "$WORK/audit-ops"
  pass "audit log has $(jq '(.items // .data // .) | length' "$BODY_FILE") row(s): $(awk '{printf "%s=%s ", $2, $1}' "$WORK/audit-ops" | head -c 400)"
  local op
  for op in ${ACCEPT_AUDIT_OPS:-ca.create certificate.issue certificate.renew certificate.revoke crl.generate}; do
    assert "audit has $op" grep -qE " $op\$" "$WORK/audit-ops"
  done
}
