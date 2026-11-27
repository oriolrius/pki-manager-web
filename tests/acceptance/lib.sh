# Helpers of the release acceptance runner. Sourced by run.sh and the checks.
# shellcheck shell=bash

: "${API:?}" "${OUT:?}"
RESULTS="$OUT/results.tsv"
STATUS=""
JSON_CT='Content-Type: application/json'

# ---------- results ----------
# One line per assertion: status<TAB>check<TAB>message. Status: PASS, FAIL, SKIP.
_record() { printf '%s\t%s\t%s\n' "$1" "$CHECK" "$2" >> "$RESULTS"; printf '  %-4s %s\n' "$1" "$2" >&2; }
pass() { _record PASS "$*"; }
fail() { _record FAIL "$*"; }
skip() { _record SKIP "$*"; }
# assert "message" command...   (records PASS or FAIL, never aborts the check)
assert() {
  local msg="$1"; shift
  if "$@" >>"$OUT/assert.log" 2>&1; then pass "$msg"; else fail "$msg"; fi
}
# need tool... : SKIP the rest of the check when a tool is missing.
need() {
  local t
  for t in "$@"; do
    command -v "$t" >/dev/null 2>&1 || { skip "tool '$t' is not installed"; return 1; }
  done
}

# ---------- HTTP ----------
# api METHOD PATH [JSON-BODY] [extra curl args...]
# The body goes to $BODY_FILE and the status to $STATUS. Returns 0 for 2xx.
BODY_FILE="$OUT/last-body"
api() {
  local method="$1" path="$2" body="${3:-}"; shift 3 2>/dev/null || shift $#
  local args=(-sS -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$API$path")
  [[ -n "${ACCEPT_TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $ACCEPT_TOKEN")
  [[ -n "$body" ]] && args+=(-H "$JSON_CT" --data-binary "$body")
  STATUS="$(curl "${args[@]}" "$@" || echo 000)"
  echo "$method $path -> $STATUS" >> "$OUT/http.log"
  [[ "$STATUS" == 2* ]]
}
body() { cat "$BODY_FILE"; }
jb() { jq -r "$@" "$BODY_FILE"; }
# trpc_mutation PROC JSON / trpc_query PROC JSON: the result data goes to $BODY_FILE.
trpc_mutation() {
  api POST "/trpc/$1" "$2" || return 1
  jq '.result.data' "$BODY_FILE" > "$BODY_FILE.tmp" && mv "$BODY_FILE.tmp" "$BODY_FILE"
}
trpc_query() {
  local in="${2:-}"; [[ -n "$in" ]] || in='{}'
  local input; input="$(jq -rn --arg v "$in" '$v|@uri')"
  api GET "/trpc/$1?input=$input" || return 1
  jq '.result.data' "$BODY_FILE" > "$BODY_FILE.tmp" && mv "$BODY_FILE.tmp" "$BODY_FILE"
}
# download PATH FILE [curl args...]: a REST download (base64 JSON .data) decoded into FILE.
download() {
  local path="$1" file="$2"; shift 2
  api GET "$path" "" "$@" || return 1
  jq -r .data "$BODY_FILE" | base64 -d > "$file"
}

# ---------- fixtures ----------
RUN_TAG="${RUN_TAG:-$(date +%s)}"
subject_json() { jq -cn --arg cn "$1" '{commonName:$cn, organization:"Acceptance Test", country:"ES", organizationalUnit:"Release", state:"Barcelona", locality:"Barcelona"}'; }
# create_ca NAME ALG -> echo CA id; CA PEM in $WORK/ca-<id>.pem
create_ca() {
  local body; body="$(jq -cn --argjson s "$(subject_json "$1")" --arg a "$2" '{subject:$s, keyAlgorithm:$a, validityYears:5}')"
  api POST /api/v1/cas/ "$body" || return 1
  local id; id="$(jb .id)"
  download "/api/v1/cas/$id/download?format=pem" "$WORK/ca-$id.pem" || return 1
  echo "$id"
}
# issue CA_ID TYPE ALG CN [extra-jq-object] -> echo cert id; PEM in $WORK/cert-<id>.pem
issue() {
  local ca="$1" type="$2" alg="$3" cn="$4" extra="${5:-}"; [[ -n "$extra" ]] || extra='{}'
  local body; body="$(jq -cn --arg ca "$ca" --arg t "$type" --arg a "$alg" --argjson s "$(subject_json "$cn")" --argjson x "$extra" \
    '{caId:$ca, subject:$s, certificateType:$t, keyAlgorithm:$a, validityDays:30} + $x')"
  api POST /api/v1/certificates/ "$body" || return 1
  local id; id="$(jb .id)"
  jb .certificatePem > "$WORK/cert-$id.pem"
  echo "$id"
}
ext_text() { openssl x509 -in "$1" -noout -text; }
verify_chain() { openssl verify -x509_strict -CAfile "$1" "$2"; }
