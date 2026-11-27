#!/usr/bin/env bash
# rehearse-ra-reprovision.sh — disposable rehearsal of an approved SCEP RA key replacement.
#
# SYNTHETIC DATA ONLY. Throwaway containers and a throwaway directory; it never reads an
# existing installation. The RA key is NOT transferred (action `reprovision`): v4 gets a new
# RA key, generated in OpenBao. Steps:
#   1. Cosmian KMS 5.28.0 + the released v3.19.1 backend: a CA and a SCEP integration with its
#      RA. One RA renewal with the same key (the row of the first RA certificate is aged so
#      that v3 renews it), so the v3 binding has an unexpired earlier same-key certificate in
#      its overlap list.
#   2. Stop v3, back up, make the target copy, apply the v4 migrations.
#   3. The OpenBao fork, the migration identity and the runtime tokens.
#   4. pki-migrate: inventory -> approval (RA key: reprovision, acknowledgeNewKey) -> preflight
#      -> apply with a crash inside the database transaction -> apply -> apply (no-op) ->
#      verify --cutover. The binding is reset with an EMPTY overlap list; the audit row lists
#      both retired RA certificates.
#   5. Stop Cosmian. Start the v4 backend and the real SCEP gateway (built from scep/) with
#      auto-provisioning: new RA key and certificate, GetCACert without the old key, a live
#      enrollment, a request encrypted to each old RA certificate fails, gateway restart and a
#      second enrollment, the old RA certificates stay readable and can be revoked.
#   6. verify after the v4 writes; a quiesced paired backup verified with --restore
#      (pair marker); a negative control: an old-key certificate put back in the overlap
#      list fails verify, and the v4 backend does not serve it to the gateway.
#
# Needs: docker, jq, curl, openssl, go, python3, Node >= 22.18, `pnpm install` done.
# Usage: scripts/migration/rehearsal/rehearse-ra-reprovision.sh [RUN_DIR]   (KEEP=1 keeps containers)
# Guide: docs/operations/openbao-migration.md ("SCEP RA with a new key")
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$(cd "$HERE/.." && pwd)"
WEB="$(cd "$MIG/../.." && pwd)"
# shellcheck disable=SC1091
. "$WEB/openbao/image.env"
PKI_V3_IMAGE="${PKI_V3_IMAGE:-ghcr.io/oriolrius/pki-manager-web/backend:3.19.1}"
OPENBAO_IMAGE="${OPENBAO_IMAGE:-$(bash "$WEB/scripts/openbao-image.sh" ensure)}"
KMS_IMAGE="${KMS_IMAGE:-ghcr.io/cosmian/kms:5.28.0}"
RUN="${1:-$(mktemp -d "${TMPDIR:-/tmp}/pki-ra-reprovision.XXXXXX")}"
P="${PREFIX:-pkira-$(date -u +%Y%m%d%H%M%S)-$$}"
NET_ID=
V4_PID=
GW_PID=
read -r KMS_PORT V3_PORT BAO_PORT V4_PORT GW_PORT BAO2_PORT < <(python3 - <<'PY'
import socket
s = [socket.socket() for _ in range(6)]
for x in s: x.bind(("127.0.0.1", 0))
print(*(x.getsockname()[1] for x in s))
PY
)
mkdir -p "$RUN"; umask 077
EVIDENCE="$RUN/evidence.txt"; : > "$EVIDENCE"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$EVIDENCE" >&2; }
die() { log "FAILED: $*"; exit 1; }
ok() { log "PASS  $*"; }
migrate() { node --disable-warning=ExperimentalWarning "$MIG/pki-migrate.ts" "$@"; }
sql() { node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:process.argv[3]!=="rw"});const r=d.prepare(process.argv[2]).all();console.log(JSON.stringify(r))' "$@" 2>/dev/null; }
stop_pid() { if [[ -n "${1:-}" ]]; then kill "$1" 2>/dev/null || true; wait "$1" 2>/dev/null || true; fi; }
teardown() {
  stop_pid "$GW_PID"; stop_pid "$V4_PID"
  if [[ -n "$NET_ID" ]]; then
    docker ps -aq --filter "label=pki-manager.rehearsal=$NET_ID" | xargs -r docker rm -f >/dev/null || true
    docker network rm "$NET_ID" >/dev/null || true
  fi
}
cleanup() { if [ "${KEEP:-0}" = 1 ]; then log "KEEP=1: containers left running (prefix $P)"; return; fi; teardown; }
trap cleanup EXIT

for c in docker jq curl openssl go node python3; do command -v "$c" >/dev/null || die "missing $c"; done
for img in "$PKI_V3_IMAGE" "$OPENBAO_IMAGE" "$KMS_IMAGE"; do docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null || die "image $img not available"; done
log "run dir $RUN; prefix $P; images v3=$PKI_V3_IMAGE openbao=$OPENBAO_IMAGE kms=$KMS_IMAGE"
if rev=$(git -C "$WEB" rev-parse --short HEAD 2>/dev/null); then
  log "tool commit: $rev$(git -C "$WEB" diff --quiet HEAD -- backend scripts/migration scep || echo ' (+ local changes in backend, scripts/migration or scep)')"
fi
NET_ID=$(docker network create "$P-net")

# ───────────────────────── 1. v3 with a SCEP RA and one same-key RA renewal ─────────────────────────
mkdir -p "$RUN/kms-data" "$RUN/v3-data"; chmod 777 "$RUN/kms-data" "$RUN/v3-data"
docker run -d --name "$P-kms" --label "pki-manager.rehearsal=$NET_ID" --network "$NET_ID" -p "127.0.0.1:$KMS_PORT:9998" \
  -v "$WEB/kms/kms.toml:/etc/cosmian/kms.toml:ro" -v "$RUN/kms-data:/cosmian-kms" -e COSMIAN_KMS_CONF=/etc/cosmian/kms.toml "$KMS_IMAGE" >/dev/null
v3_start() {
  docker run -d --name "$P-v3" --label "pki-manager.rehearsal=$NET_ID" --network "$NET_ID" -p "127.0.0.1:$V3_PORT:3000" -v "$RUN/v3-data:/app/backend/data" \
    -e KMS_URL="http://$P-kms:9998" -e FRONTEND_URL="http://localhost:$V3_PORT" -e CRL_DISTRIBUTION_URL="http://localhost:$V3_PORT/crl" "$PKI_V3_IMAGE" >/dev/null
  for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$V3_PORT/api/v1/health" >/dev/null 2>&1 && return 0; sleep 1; done
  docker logs "$P-v3" | tail -20; die "v3 backend did not start"
}
v3_start
API="http://127.0.0.1:$V3_PORT/api/v1"
j() { curl -fsS -H 'content-type: application/json' "$@"; }
CA1=$(j -X POST "$API/cas/" -d '{"subject":{"commonName":"Rehearsal RA Root","organization":"Rehearsal","country":"ES"},"keyAlgorithm":"RSA-2048","validityYears":5}' | jq -er .id)
SCEP_TOKEN=$(j -X POST "http://127.0.0.1:$V3_PORT/trpc/integration.register" -d "{\"name\":\"rehearsal-scep\",\"caId\":\"$CA1\",\"kind\":\"scep\"}" | jq -er .result.data.token)
printf '%s\n' "$SCEP_TOKEN" > "$RUN/scep.token"
j -X POST "$API/external/ra/provision" -H "authorization: Bearer $SCEP_TOKEN" -d '{}' | jq -er .certificatePem > "$RUN/ra-v3-first.pem"
# Age the row of the first RA certificate (row metadata only) so that v3.19.1 renews it now.
docker exec -w /app/backend "$P-v3" node -e '
  const D = require("better-sqlite3"); const db = new D("/app/backend/data/pki.db");
  const r = db.prepare("UPDATE certificates SET not_before = not_before - 200*86400 WHERE id = (SELECT certificate_id FROM integration_ras LIMIT 1)").run();
  if (r.changes !== 1) process.exit(1);' || die "could not age the v3 RA certificate row"
# v3 refuses a renewal that does not extend the validity: not in the same second.
sleep 2
j -X POST "$API/external/ra/renew" -H "authorization: Bearer $SCEP_TOKEN" -d '{}' > "$RUN/ra-v3-state.json"
jq -e '.previousCertificatesPem | length == 1' "$RUN/ra-v3-state.json" >/dev/null || die "v3 did not renew the RA certificate"
jq -er .certificatePem "$RUN/ra-v3-state.json" > "$RUN/ra-v3.pem"
jq -er '.previousCertificatesPem[0]' "$RUN/ra-v3-state.json" > "$RUN/ra-v3-earlier.pem"
pub() { openssl x509 -in "$1" -pubkey -noout; }
der() { openssl x509 -in "$1" -outform der | base64 -w0; }
[ "$(der "$RUN/ra-v3-earlier.pem")" = "$(der "$RUN/ra-v3-first.pem")" ] || die "the overlap entry is not the first RA certificate"
[ "$(pub "$RUN/ra-v3.pem")" = "$(pub "$RUN/ra-v3-earlier.pem")" ] && [ "$(der "$RUN/ra-v3.pem")" != "$(der "$RUN/ra-v3-earlier.pem")" ] || die "v3 renewal did not keep the RA key"
ok "v3.19.1 seeded: CA $CA1, SCEP RA renewed with the same key (current + 1 unexpired earlier certificate in the overlap list)"

# ───────────────────────── 2. freeze, backup, v4 copy ─────────────────────────
docker stop "$P-v3" >/dev/null
migrate backup --db "$RUN/v3-data/pki.db" --out-dir "$RUN/backup-v3" --label "v3.19.1 before migration" >/dev/null
SRC="$RUN/backup-v3/pki.db"; chmod 400 "$SRC"
migrate backup --db "$SRC" --out-dir "$RUN/target" --label "target copy" >/dev/null
TGT="$RUN/target/pki.db"
(cd "$WEB/backend" && DATABASE_PATH="$TGT" ./node_modules/.bin/tsx src/db/migrate.ts) >>"$EVIDENCE" 2>&1 || die "v4 migrations failed on the copy"
ok "frozen v3 backup + target copy migrated to the v4 schema"

# ───────────────────────── 3. OpenBao fork ─────────────────────────
start_bao() { # name port statedir
  mkdir -p "$3/data" "$3/logs" "$3/secrets"; chmod 777 "$3/data" "$3/logs" "$3/secrets"
  bash "$WEB/openbao/scripts/dev-tls.sh" "$3/tls" "DNS:$1" >/dev/null; chmod 755 "$3/tls"; chmod 644 "$3/tls/"*
  docker run -d --name "$1" --label "pki-manager.rehearsal=$NET_ID" --network "$NET_ID" -p "127.0.0.1:$2:8200" --user "$(id -u):$(id -g)" \
    -v "$WEB/openbao/config:/openbao/config:ro" -v "$3/data:/openbao/data" -v "$3/logs:/openbao/logs" -v "$3/tls:/openbao/tls:ro" \
    -e BAO_API_ADDR="https://$1:8200" -e BAO_CLUSTER_ADDR="https://$1:8201" "$OPENBAO_IMAGE" server -config=/openbao/config >/dev/null
  for _ in $(seq 1 60); do rc=0; baoc "$1" status >/dev/null 2>&1 || rc=$?; [ "$rc" -ne 1 ] && return 0; sleep 1; done
  die "OpenBao $1 did not answer"
}
baoc() { local c=$1; shift; docker exec -e BAO_ADDR=https://127.0.0.1:8200 -e BAO_CACERT=/openbao/tls/ca.pem -e BAO_TOKEN="${BAO_TOKEN:-}" "$c" bao "$@"; }
bao() { baoc "$P-bao" "$@"; }
start_bao "$P-bao" "$BAO_PORT" "$RUN/bao"
bao operator init -key-shares=1 -key-threshold=1 -format=json > "$RUN/bao/secrets/init.json"
jq -r '.unseal_keys_b64[0]' "$RUN/bao/secrets/init.json" > "$RUN/bao/secrets/unseal.key"
bao operator unseal "$(cat "$RUN/bao/secrets/unseal.key")" >/dev/null; sleep 2
jq -r .root_token "$RUN/bao/secrets/init.json" > "$RUN/bao/secrets/operator.token"
export BAO_TOKEN; BAO_TOKEN="$(cat "$RUN/bao/secrets/operator.token")"
docker cp "$WEB/openbao/scripts/bootstrap.sh" "$P-bao:/tmp/bootstrap.sh"; docker cp "$WEB/openbao/policies" "$P-bao:/tmp/policies"
boot() { docker exec -i -e BAO_ADDR=https://127.0.0.1:8200 -e BAO_CACERT=/openbao/tls/ca.pem -e BAO_TOKEN="$BAO_TOKEN" -e POLICY_DIR=/tmp/policies -e SECRETS_DIR=/tmp/secrets "$@"; }
boot "$P-bao" sh /tmp/bootstrap.sh configure 2>>"$EVIDENCE"
boot "$P-bao" sh /tmp/bootstrap.sh migration-setup < "$MIG/policies/pki-manager-migration.hcl" 2>>"$EVIDENCE"
boot -e MIGRATION_TOKEN_TTL=2h "$P-bao" sh /tmp/bootstrap.sh migration-token > "$RUN/bao/secrets/migration.token" 2>>"$EVIDENCE"
bao token create -policy=pki-manager-backend -no-default-policy -ttl=4h -field=token > "$RUN/bao/secrets/backend.token"
bao token create -policy=pki-manager-ra -no-default-policy -ttl=4h -field=token > "$RUN/bao/secrets/ra.token"
unset BAO_TOKEN
BADDR="https://127.0.0.1:$BAO_PORT"; CACERT="$RUN/bao/tls/ca.pem"
MT=(--openbao-addr "$BADDR" --openbao-cacert "$CACERT" --openbao-token-file "$RUN/bao/secrets/migration.token")
RT=(--openbao-addr "$BADDR" --openbao-cacert "$CACERT" --openbao-token-file "$RUN/bao/secrets/backend.token" --openbao-ra-token-file "$RUN/bao/secrets/ra.token")
ok "OpenBao fork $OPENBAO_IMAGE: migration token, X.509/SSH token and RA token"

# ───────────────────────── 4. migration: the RA key is replaced ─────────────────────────
KMS=(--kms-url "http://127.0.0.1:$KMS_PORT")
set +e; migrate inventory --source-db "$SRC" "${KMS[@]}" --out "$RUN/manifest.json" > "$RUN/inventory.txt"; rc=$?; set -e
cat "$RUN/inventory.txt" >> "$EVIDENCE"; [ $rc -le 1 ] || die "inventory error"
DIGEST=$(sed -n 's/^manifest digest //p' "$RUN/inventory.txt")
RA_KEY=$(jq -er '.keys[] | select(.class == "scep-ra") | .sourceKeyId' "$RUN/manifest.json")
migrate approve-template --manifest "$RUN/manifest.json" "${MT[@]}" --out "$RUN/approval.template.json" >/dev/null
jq --arg t "$(date -u +%FT%TZ)" --arg ra "$RA_KEY" '.approvedBy = "rehearsal-admin" | .approvedAt = $t | .allowSourceWrappingKeyRegistration = true
  | .keys |= with_entries(if .value.acknowledgeSensitive == false then .value.acknowledgeSensitive = true else . end)
  | .keys[$ra] = {action: "reprovision", spkiSha256: .keys[$ra].spkiSha256, acknowledgeNewKey: true}' "$RUN/approval.template.json" > "$RUN/approval.json"
migrate rotation-plan --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" > "$RUN/rotation-plan.md"
grep -q 'GetCACert' "$RUN/rotation-plan.md" && grep -q 'overlap list (`previous`) is empty' "$RUN/rotation-plan.md" || die "rotation plan lacks the device and overlap steps"
migrate preflight --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" --source-db "$SRC" --target-db "$TGT" "${MT[@]}" "${KMS[@]}" >> "$EVIDENCE"
APPLY=(apply --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" --source-db "$SRC" --target-db "$TGT" --run-dir "$RUN/run" --confirm "${DIGEST:0:16}" --actor rehearsal-admin "${MT[@]}" "${KMS[@]}")
set +e; PKI_MIGRATE_FAULT=db-mid-transaction migrate "${APPLY[@]}" > /dev/null 2>>"$EVIDENCE"; rc=$?; set -e
[ $rc -eq 75 ] || die "the simulated crash did not happen (exit $rc)"
[ "$(sql "$TGT" 'SELECT key_provider p FROM integration_ras' | jq -r '.[0].p')" = cosmian ] || die "the crashed run changed the binding"
ok "apply #1 crashed inside the database transaction (exit 75); the binding is unchanged"
migrate "${APPLY[@]}" > "$RUN/apply.json"
migrate "${APPLY[@]}" > "$RUN/apply-noop.json"
jq -c '{imported, adopted, alreadyVerified, skipped, db, noOp}' "$RUN/apply.json" "$RUN/apply-noop.json" | tee -a "$EVIDENCE"
[ "$(jq .noOp "$RUN/apply-noop.json")" = true ] && [ "$(jq .db.auditRows "$RUN/apply-noop.json")" = 0 ] || die "the third apply was not a no-op"
ok "apply #2 reset the binding; apply #3 is a no-op (no second audit row)"
sql "$TGT" "SELECT key_provider, key_id, key_version, certificate_id, certificate_pem, previous FROM integration_ras" > "$RUN/binding-reset.json"
jq -e '.[0] | .key_provider == "openbao" and .key_id == null and .certificate_pem == null and .previous == "[]"' "$RUN/binding-reset.json" >/dev/null || die "binding not reset with an empty overlap list: $(cat "$RUN/binding-reset.json")"
sql "$TGT" "SELECT details FROM audit_log WHERE operation = 'migration.ra.reprovision'" | jq '[.[].details | fromjson]' > "$RUN/audit-reprovision.json"
sha() { openssl x509 -in "$1" -outform der | sha256sum | cut -d' ' -f1; }
jq -e --arg a "$(sha "$RUN/ra-v3.pem")" --arg b "$(sha "$RUN/ra-v3-earlier.pem")" \
  'length == 1 and ([.[0].retiredRaCertificates[] | [.slot, .sha256]] == [["current", $a], ["previous", $b]]) and all(.[0].retiredRaCertificates[]; .id != null and (.certificatePem | startswith("-----BEGIN CERTIFICATE")))' \
  "$RUN/audit-reprovision.json" >/dev/null || die "audit row does not list both retired RA certificates"
mapfile -t OLD_IDS < <(jq -r '.[0].retiredRaCertificates[].id' "$RUN/audit-reprovision.json")
[ "$(sql "$TGT" "SELECT COUNT(*) n FROM certificates WHERE id IN ('${OLD_IDS[0]}','${OLD_IDS[1]}') AND kms_key_id IS NULL" | jq '.[0].n')" = 2 ] || die "old RA certificate rows missing"
ok "binding reset: openbao, no key, no certificate, overlap list []; audit row lists the current and the earlier RA certificate (PEM, SHA-256); both rows kept"
migrate verify --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" --source-db "$SRC" --target-db "$TGT" "${RT[@]}" --ra-session-check --cutover --out "$RUN/verify-cutover.json" >> "$EVIDENCE"
jq -e '.cutoverReady' "$RUN/verify-cutover.json" >/dev/null || die "cutover gate"
ok "verify --cutover passes ($(jq '[.checks[] | select(.ok)] | length' "$RUN/verify-cutover.json") checks, $(jq '.counts.rowsReconciled' "$RUN/verify-cutover.json") rows reconciled)"

# ───────────────────────── 5. v4 backend + the real SCEP gateway, Cosmian stopped ─────────────────────────
docker stop "$P-kms" >/dev/null
ok "Cosmian stopped from here on"
start_v4() {
  (cd "$WEB/backend" && exec env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production PORT="$V4_PORT" HOST=127.0.0.1 DATABASE_PATH="$TGT" \
    OPENBAO_ADDR="$BADDR" OPENBAO_CACERT="$CACERT" OPENBAO_TOKEN_FILE="$RUN/bao/secrets/backend.token" OPENBAO_RA_TOKEN_FILE="$RUN/bao/secrets/ra.token" \
    FRONTEND_URL="http://localhost:$V4_PORT" CRL_DISTRIBUTION_URL="http://localhost:$V4_PORT/crl" node --import tsx src/server.ts >> "$RUN/v4-backend.log" 2>&1) & V4_PID=$!
  for _ in $(seq 1 60); do kill -0 "$V4_PID" 2>/dev/null || die "v4 backend exited; see $RUN/v4-backend.log"; curl -fsS "http://127.0.0.1:$V4_PORT/api/v1/health" >/dev/null 2>&1 && return 0; sleep 1; done
  die "v4 backend did not start"
}
start_v4
API="http://127.0.0.1:$V4_PORT/api/v1"
(cd "$WEB/scep" && go build -o "$RUN/scep-server" .) || die "gateway build"
mkdir -p "$RUN/scep"; head -c 36 /dev/urandom | base64 -w0 > "$RUN/scep/challenge"
# The gateway's state file from v3 (current + earlier RA certificate): v4 replaces it.
jq -n --rawfile c "$RUN/ra-v3.pem" --rawfile p "$RUN/ra-v3-earlier.pem" '{certificatePem: $c, previousCertificatesPem: [$p]}' > "$RUN/scep/ra.json"
gw_start() { # extra env...
  (exec env -i PATH="$PATH" SCEP_BACKEND_URL="http://127.0.0.1:$V4_PORT" SCEP_BACKEND_TOKEN_FILE="$RUN/scep.token" SCEP_AUTH_MODE=shared \
    SCEP_CHALLENGE_FILE="$RUN/scep/challenge" SCEP_STATE_FILE="$RUN/scep/ra.json" SCEP_LISTEN="127.0.0.1:$GW_PORT" "$@" "$RUN/scep-server" serve >> "$RUN/scep/gateway.log" 2>&1) & GW_PID=$!
  for _ in $(seq 1 60); do
    kill -0 "$GW_PID" 2>/dev/null || { tail -5 "$RUN/scep/gateway.log"; return 1; }
    curl -fsS -o /dev/null "http://127.0.0.1:$GW_PORT/scep?operation=GetCACaps" 2>/dev/null && return 0; sleep 1
  done; return 1
}
gw_start SCEP_AUTO_PROVISION=true || die "gateway did not start (auto-provisioning); see $RUN/scep/gateway.log"
ok "SCEP gateway started with auto-provisioning (startup checks: RA certificate, sign + session-key self-test, overlap list)"
sql "$TGT" "SELECT key_id, key_version, certificate_id, certificate_pem, previous FROM integration_ras" > "$RUN/binding-v4.json"
NAME=$(jq -er '.[0].key_id' "$RUN/binding-v4.json"); jq -er '.[0].certificate_pem' "$RUN/binding-v4.json" > "$RUN/ra-v4.pem"
[ "$(jq -r '.[0].previous' "$RUN/binding-v4.json")" = "[]" ] || die "v4 binding has an overlap list"
[ "$(pub "$RUN/ra-v4.pem")" != "$(pub "$RUN/ra-v3.pem")" ] || die "v4 RA certificate certifies the old key"
curl -fsS --cacert "$CACERT" -H "X-Vault-Token: $(cat "$RUN/bao/secrets/ra.token")" "$BADDR/v1/pki-manager-ra/keys/$NAME" \
  | jq -e '.data.imported_key == false and .data.exportable == false and .data.allow_pkcs1v15_session_key == true' >/dev/null || die "the new RA key is not a generated, non-exportable session-key key"
[ "$(jq -r .certificatePem "$RUN/scep/ra.json" | openssl x509 -outform der | base64 -w0)" = "$(der "$RUN/ra-v4.pem")" ] \
  && jq -e '(.previousCertificatesPem // []) | length == 0' "$RUN/scep/ra.json" >/dev/null || die "gateway state file not replaced"
ok "new RA key $NAME generated in OpenBao (imported_key=false); new RA certificate; empty overlap list; state file replaced"
curl -fsS "http://127.0.0.1:$GW_PORT/scep?operation=GetCACert" -o "$RUN/getcacert.p7"
openssl pkcs7 -inform der -in "$RUN/getcacert.p7" -print_certs -out "$RUN/getcacert.pem"
csplit -s -z -f "$RUN/gc-" "$RUN/getcacert.pem" '/-----BEGIN CERTIFICATE-----/' '{*}'
OLDPUB=$(pub "$RUN/ra-v3.pem"); found_new=0
for f in "$RUN"/gc-*; do grep -q 'BEGIN CERTIFICATE' "$f" || continue; [ "$(pub "$f")" != "$OLDPUB" ] || die "GetCACert serves the old RA key"; [ "$(der "$f")" = "$(der "$RUN/ra-v4.pem")" ] && found_new=1; done
[ $found_new = 1 ] || die "GetCACert does not serve the new RA certificate"
ok "GetCACert serves the new RA certificate and no certificate of the old key"

live() {
  local out; out=$(cd "$WEB/scep" && env SCEP_TEST_SERVER_URL="http://127.0.0.1:$GW_PORT/scep" SCEP_TEST_CHALLENGE_FILE="$RUN/scep/challenge" "$@" go test -count=1 -v -run "$LIVE_TEST" . 2>&1) || { printf '%s\n' "$out" >> "$EVIDENCE"; return 1; }
  printf '%s\n' "$out" >> "$EVIDENCE"; grep -q -- '--- PASS' <<< "$out" && ! grep -q -- '--- SKIP' <<< "$out"
}
LIVE_TEST='^TestLiveEnrollment$' live || die "live enrollment with the new RA"
ok "live enrollment through the gateway with the new RA (OpenBao sign + session key, issuance, idempotent retry)"
for old in ra-v3.pem ra-v3-earlier.pem; do
  LIVE_TEST='^TestLiveEnrollmentStaleRA$' live SCEP_TEST_STALE_RA_FILE="$RUN/$old" || die "request encrypted to $old"
done
ok "a request encrypted to either old RA certificate (current or earlier) gets a CertRep FAILURE from the new RA; nothing issued"
stop_pid "$GW_PID"; GW_PID=
gw_start || die "gateway did not restart"
LIVE_TEST='^TestLiveEnrollment$' live || die "live enrollment after restart"
[ "$(der "$RUN/ra-v4.pem")" = "$(jq -r .certificatePem "$RUN/scep/ra.json" | openssl x509 -outform der | base64 -w0)" ] || die "restart changed the RA certificate"
ok "gateway restart (no provisioning): same RA certificate; second live enrollment"
for id in "${OLD_IDS[@]}"; do
  j "$API/certificates/$id" | jq -e '.subjectDn | contains("SCEP Registration Authority")' >/dev/null || die "old RA certificate $id not readable"
  j -X POST "$API/certificates/$id/revoke" -d '{"reason":"superseded"}' >/dev/null || die "revoke old RA certificate $id"
done
LIVE_TEST='^TestLiveEnrollment$' live || die "live enrollment after revoking the old RA certificates"
ok "old RA certificates readable through the v4 API and revoked (superseded); enrollment still works"

# ───────────────────────── 6. verify after the v4 writes; negative control ─────────────────────────
migrate verify --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" --source-db "$SRC" --target-db "$TGT" "${RT[@]}" --out "$RUN/verify-after-v4.json" >/dev/null 2>&1 || true
jq -e '[.checks[] | select(.name | test("^integration_ras:.*(reprovisioned|overlap list|retired RA certificates)|retired RA certificate kept")) | .ok] | length >= 4 and all' "$RUN/verify-after-v4.json" >/dev/null \
  || die "reprovision checks after v4 provisioning: $(jq -c '[.checks[] | select(.name | test("integration_ras|retired")) | select(.ok | not)]' "$RUN/verify-after-v4.json")"
ok "verify: new key provisioned, overlap list usable, retired certificates in the audit log and the rows"
# A paired backup of the state after the v4 writes (writers stopped), verified as a restore.
stop_pid "$GW_PID"; GW_PID=; stop_pid "$V4_PID"; V4_PID=
migrate backup --db "$TGT" --out-dir "$RUN/backup-v4" --label "after RA reprovision" --quiesced --openbao-addr "$BADDR" --openbao-cacert "$CACERT" --openbao-token-file "$RUN/bao/secrets/operator.token" >/dev/null
migrate check-backup --dir "$RUN/backup-v4" >> "$EVIDENCE"
# Restore it: the Raft snapshot into a new OpenBao (unsealed with the original key), the SQLite copy.
start_bao "$P-bao2" "$BAO2_PORT" "$RUN/bao2"
baoc "$P-bao2" operator init -key-shares=1 -key-threshold=1 -format=json > "$RUN/bao2/secrets/init.json"
baoc "$P-bao2" operator unseal "$(jq -r '.unseal_keys_b64[0]' "$RUN/bao2/secrets/init.json")" >/dev/null; sleep 2
docker cp "$RUN/backup-v4/openbao.snap" "$P-bao2:/tmp/openbao.snap"
BAO_TOKEN="$(jq -r .root_token "$RUN/bao2/secrets/init.json")" baoc "$P-bao2" operator raft snapshot restore -force /tmp/openbao.snap
sleep 2; baoc "$P-bao2" operator unseal "$(cat "$RUN/bao/secrets/unseal.key")" >/dev/null 2>&1 || true
for _ in $(seq 1 30); do if baoc "$P-bao2" status >/dev/null 2>&1; then break; fi; sleep 1; done
cp "$RUN/backup-v4/pki.db" "$RUN/restored.db"
RADDR="https://127.0.0.1:$BAO2_PORT"
RRT=(--openbao-addr "$RADDR" --openbao-cacert "$RUN/bao2/tls/ca.pem" --openbao-token-file "$RUN/bao/secrets/backend.token" --openbao-ra-token-file "$RUN/bao/secrets/ra.token")
migrate verify --restore --backup-dir "$RUN/backup-v4" --openbao-operator-token-file "$RUN/bao/secrets/operator.token" --source-db "$SRC" --target-db "$RUN/restored.db" "${RRT[@]}" --out "$RUN/verify-restore.json" >> "$EVIDENCE" \
  || die "verify --restore of the paired backup after the v4 writes"
jq -e '.ok and .pairBound' "$RUN/verify-restore.json" >/dev/null || die "restore pair not bound"
ok "paired backup (--quiesced) after the v4 writes, restored into a new OpenBao: verify --restore passes, pair bound"
# Negative control: the representation of the earlier tool (old-key certificate in the overlap list).
start_v4
sql "$TGT" "UPDATE integration_ras SET previous = json_array(json_object('id', '${OLD_IDS[0]}', 'certificatePem', (SELECT certificate_pem FROM certificates WHERE id = '${OLD_IDS[0]}'))) RETURNING 1" rw >/dev/null
set +e; migrate verify --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" --source-db "$SRC" --target-db "$TGT" "${RT[@]}" --out "$RUN/verify-negative.json" >/dev/null 2>&1; set -e
jq -e '[.checks[] | select(.name | endswith("overlap list") or endswith("overlap list holds no certificate of the replaced RA key")) | .ok] == [false, false]' "$RUN/verify-negative.json" >/dev/null \
  || die "negative control: the old-key overlap entry was not reported: $(jq -c '[.checks[] | select(.name | test("overlap"))]' "$RUN/verify-negative.json")"
gw_start || die "gateway did not start with the old-key overlap entry in the database (backend filter)"
LIVE_TEST='^TestLiveEnrollment$' live || die "enrollment with the filtered overlap list"
sql "$TGT" "UPDATE integration_ras SET previous = '[]' RETURNING 1" rw >/dev/null
ok "negative control: an old-key overlap entry fails the reprovision and pair checks; the v4 backend does not serve it, so the gateway still starts"
log "evidence: $EVIDENCE"
