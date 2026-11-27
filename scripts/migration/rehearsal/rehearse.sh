#!/usr/bin/env bash
# rehearse.sh — disposable end-to-end rehearsal of the offline v3 -> OpenBao migration.
#
# SYNTHETIC DATA ONLY. Everything runs in throwaway containers and a throwaway
# directory; it never reads an existing installation. Steps:
#   1. Cosmian KMS 5.28.0 + the released v3.19.1 backend image; seed data through the
#      v3 API (CAs, leaf certificates, a renewal that reuses its key, an external CSR,
#      a revocation and a CRL, SSH user and host CAs with a rotation and a host
#      certificate, a SCEP integration with its RA key).
#   2. Stop v3 (writes frozen), back up its database, make the target copy and bring it
#      to the v4 schema with the v4 backend's migration runner.
#   3. The OpenBao fork (pinned image, Raft, TLS, file audit), the migration policy.
#   4. pki-migrate: inventory -> approval -> preflight -> apply with a simulated crash
#      -> apply (resume) -> apply (no-op) -> verify, with Cosmian still running.
#   5. Backup pair (SQLite + Raft snapshot); STOP Cosmian; restore the snapshot into a
#      new OpenBao and verify the restored pair (no Cosmian).
#   6. Start the v4 backend on the restored pair with Cosmian stopped and use the
#      migrated keys: CRL, new leaf, renewal with key reuse, PKCS#12, SSH host
#      certificate, SCEP RA state and renewal.
#
# Needs: docker, jq, curl, openssl, ssh, ssh-keygen, python3 (free ports), Node >= 22.18, and
# `pnpm install` done (the v4 migration runner and server run from backend/). Images,
# pulled when missing:
#   PKI_V3_IMAGE   (default ghcr.io/oriolrius/pki-manager-web/backend:3.19.1)
#   OPENBAO_IMAGE  (default: `scripts/openbao-image.sh ensure`, the signed fork release
#                   pinned by digest in openbao/image.env)
#   KMS_IMAGE      (default ghcr.io/cosmian/kms:5.28.0)
# Each run uses its own container prefix and free local ports, so rehearsals can run
# side by side. Usage: scripts/migration/rehearsal/rehearse.sh [RUN_DIR]
# (RUN_DIR is kept; KEEP=1 also keeps the containers and the v4 server for inspection.)
# Guide: docs/operations/openbao-migration.md
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$(cd "$HERE/.." && pwd)"
WEB="$(cd "$MIG/../.." && pwd)"
# shellcheck disable=SC1091
. "$WEB/openbao/image.env"
PKI_V3_IMAGE="${PKI_V3_IMAGE:-ghcr.io/oriolrius/pki-manager-web/backend:3.19.1}"
OPENBAO_IMAGE="${OPENBAO_IMAGE:-$(bash "$WEB/scripts/openbao-image.sh" ensure)}"
KMS_IMAGE="${KMS_IMAGE:-ghcr.io/cosmian/kms:5.28.0}"
RUN="${1:-$(mktemp -d "${TMPDIR:-/tmp}/pki-migration-rehearsal.XXXXXX")}"
# A unique prefix per run: teardown removes only this run's containers and network.
P="${PREFIX:-pkimig-$(date -u +%Y%m%d%H%M%S)-$$}"
NET="$P-net"
NET_ID=
V4_PID=
ports=$(python3 - "${KMS_PORT:-0}" "${V3_PORT:-0}" "${BAO_PORT:-0}" "${BAO2_PORT:-0}" "${V4_PORT:-0}" <<'PY'
import socket
import sys

sockets = []
for port in sys.argv[1:]:
    listener = socket.socket()
    listener.bind(("127.0.0.1", int(port)))
    sockets.append(listener)
print(*(s.getsockname()[1] for s in sockets))
PY
)
read -r KMS_PORT V3_PORT BAO_PORT BAO2_PORT V4_PORT <<< "$ports"
mkdir -p "$RUN"; umask 077
EVIDENCE="$RUN/evidence.txt"
: > "$EVIDENCE"

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$EVIDENCE" >&2; }
die() { log "FAILED: $*"; exit 1; }
ok() { log "PASS  $*"; }
migrate() { node --disable-warning=ExperimentalWarning "$MIG/pki-migrate.ts" "$@"; }

teardown() {
  if [[ -n "$V4_PID" ]]; then
    kill "$V4_PID" 2>/dev/null || true
    wait "$V4_PID" 2>/dev/null || true
  fi
  if [[ -n "$NET_ID" ]]; then
    local id
    while IFS= read -r id; do
      if [[ -n "$id" ]]; then docker rm -f "$id" >/dev/null || true; fi
    done < <(docker ps -aq --filter "label=pki-manager.rehearsal=$NET_ID")
    docker network rm "$NET_ID" >/dev/null || true
  fi
}
cleanup() {
  if [ "${KEEP:-0}" = 1 ]; then log "KEEP=1: containers left running (prefix $P)"; return; fi
  teardown
}
trap cleanup EXIT

for c in docker jq curl openssl ssh ssh-keygen node python3; do command -v "$c" >/dev/null || die "missing $c"; done
for img in "$PKI_V3_IMAGE" "$OPENBAO_IMAGE" "$KMS_IMAGE"; do docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null || die "image $img not available"; done
log "run dir $RUN; prefix $P; images v3=$PKI_V3_IMAGE openbao=$OPENBAO_IMAGE kms=$KMS_IMAGE"
log "OpenBao image: $(docker run --rm --entrypoint bao "$OPENBAO_IMAGE" version)"
if rev=$(git -C "$WEB" rev-parse --short HEAD 2>/dev/null); then
  log "tool commit: $rev$(git -C "$WEB" diff --quiet HEAD -- backend scripts/migration || echo ' (+ local changes in backend or scripts/migration)')"
else
  log "tool source: archive without Git metadata"
fi
NET_ID=$(docker network create "$NET")

# ───────────────────────── 1. v3 installation with synthetic data ─────────────────────────
mkdir -p "$RUN/kms-data" "$RUN/v3-data"; chmod 777 "$RUN/kms-data" "$RUN/v3-data"
docker run -d --name "$P-kms" --label "pki-manager.rehearsal=$NET_ID" --network "$NET_ID" -p "127.0.0.1:$KMS_PORT:9998" \
  -v "$WEB/kms/kms.toml:/etc/cosmian/kms.toml:ro" -v "$RUN/kms-data:/cosmian-kms" -e COSMIAN_KMS_CONF=/etc/cosmian/kms.toml "$KMS_IMAGE" >/dev/null
docker run -d --name "$P-v3" --label "pki-manager.rehearsal=$NET_ID" --network "$NET_ID" -p "127.0.0.1:$V3_PORT:3000" -v "$RUN/v3-data:/app/backend/data" \
  -e KMS_URL="http://$P-kms:9998" -e ALLOW_UNAUTHENTICATED_SSH_CA=true -e FRONTEND_URL="http://localhost:$V3_PORT" \
  -e CRL_DISTRIBUTION_URL="http://localhost:$V3_PORT/crl" "$PKI_V3_IMAGE" >/dev/null
for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$V3_PORT/api/v1/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$V3_PORT/api/v1/health" >/dev/null || { docker logs "$P-v3" | tail -20; die "v3 backend did not start"; }
API="http://127.0.0.1:$V3_PORT/api/v1"
j() { curl -fsS -H 'content-type: application/json' "$@"; }
# REST downloads answer {"data": "<base64 of the file>"}.
dl() { local url=$1 out=$2; shift 2; curl -fsS "$@" "$url" | jq -er .data | base64 -d > "$out" && [ -s "$out" ]; }
post() { j -X POST "$API$1" -d "$2"; }

CA1=$(post /cas/ '{"subject":{"commonName":"Rehearsal Root RSA-2048","organization":"Rehearsal","country":"ES"},"keyAlgorithm":"RSA-2048","validityYears":5}' | jq -r .id)
CA2=$(post /cas/ '{"subject":{"commonName":"Rehearsal Root RSA-4096","organization":"Rehearsal","country":"ES"},"keyAlgorithm":"RSA-4096","validityYears":5}' | jq -r .id)
leaf() { post /certificates/ "{\"caId\":\"$1\",\"subject\":{\"commonName\":\"$2\",\"organization\":\"Rehearsal\",\"country\":\"ES\"},\"certificateType\":\"$3\",\"keyAlgorithm\":\"$4\",\"validityDays\":90,\"sanDns\":[\"$2\"]}" | jq -r .id; }
L1=$(leaf "$CA1" web1.rehearsal.test server RSA-2048)
L2=$(leaf "$CA1" client1.rehearsal.test client ECDSA-P256)
L3=$(leaf "$CA2" web2.rehearsal.test server RSA-4096)
L1R=$(post "/certificates/$L1/renew" '{"generateNewKey":false}' | jq -r '.id // .certificate.id')
L3R=$(post "/certificates/$L3/renew" '{"generateNewKey":true}' | jq -r '.id // .certificate.id')
post "/certificates/$L2/revoke" '{"reason":"keyCompromise"}' >/dev/null
post "/cas/$CA1/crls" '{}' >/dev/null
GEN_TOKEN=$(j -X POST "http://127.0.0.1:$V3_PORT/trpc/integration.register" -d "{\"name\":\"rehearsal-k8s\",\"caId\":\"$CA1\",\"kind\":\"kubernetes\"}" | jq -r .result.data.token)
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=ext.rehearsal.test -keyout "$RUN/ext.key" -out "$RUN/ext.csr" 2>/dev/null
j -X POST "$API/external/sign" -H "authorization: Bearer $GEN_TOKEN" -d "$(jq -n --rawfile c "$RUN/ext.csr" '{csrPem:$c, requestUid:"rehearsal-ext-1", durationDays:30, sanDns:["ext.rehearsal.test"]}')" >/dev/null
USER_CA=$(post /ssh/cas '{"caType":"user","label":"rehearsal-user-ca"}' | jq -r .id)
post /ssh/cas '{"caType":"host","label":"rehearsal-host-ca"}' > "$RUN/host-ca.json"
HOST_CA=$(jq -er .id "$RUN/host-ca.json")
jq -er .opensshPublicKey "$RUN/host-ca.json" > "$RUN/host-ca-v3.pub"
post "/ssh/cas/$USER_CA/rotate" '{}' >/dev/null
ssh-keygen -q -t ecdsa -b 256 -N '' -f "$RUN/host_key" -C host1 >/dev/null
HOST=$(post /ssh/hosts "$(jq -n --arg k "$(cat "$RUN/host_key.pub")" '{fqdn:"host1.rehearsal.test", addresses:["host1.rehearsal.test"], opensshHostPubkey:$k}')" | jq -r .id)
post /ssh/hosts/issue "{\"hostId\":\"$HOST\"}" >/dev/null
SCEP_TOKEN=$(j -X POST "http://127.0.0.1:$V3_PORT/trpc/integration.register" -d "{\"name\":\"rehearsal-scep\",\"caId\":\"$CA1\",\"kind\":\"scep\"}" | jq -r .result.data.token)
j -X POST "$API/external/ra/provision" -H "authorization: Bearer $SCEP_TOKEN" -d '{}' >/dev/null
# Original trust material, captured from v3 (the v4 checks below verify against it).
dl "$API/cas/$CA1/download?format=pem" "$RUN/ca1-v3.pem" || die "v3 CA download"
openssl x509 -in "$RUN/ca1-v3.pem" -noout -subject >> "$EVIDENCE"
j "$API/external/ra/state" -H "authorization: Bearer $SCEP_TOKEN" | jq -er .certificatePem > "$RUN/ra-v3.pem"
printf '%s\n' "$GEN_TOKEN" > "$RUN/generic.token"; printf '%s\n' "$SCEP_TOKEN" > "$RUN/scep.token"
ok "v3.19.1 seeded: CAs $CA1 $CA2, leaves $L1 $L2 $L3 renewals $L1R $L3R, SSH CAs $USER_CA (rotated) $HOST_CA, host $HOST, SCEP RA"

# ───────────────────────── 2. freeze, backup, v4 copy ─────────────────────────
docker stop "$P-v3" >/dev/null
migrate backup --db "$RUN/v3-data/pki.db" --out-dir "$RUN/backup-v3" --label "v3.19.1 before migration" >/dev/null
SRC="$RUN/backup-v3/pki.db"; chmod 400 "$SRC"
migrate check-backup --dir "$RUN/backup-v3" | tee -a "$EVIDENCE"
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
  local rc
  for _ in $(seq 1 60); do
    rc=0; docker exec "$1" bao status -address=https://127.0.0.1:8200 -ca-cert=/openbao/tls/ca.pem >/dev/null 2>&1 || rc=$?
    [ "$rc" -ne 1 ] && return 0; sleep 1   # 0 unsealed, 2 sealed/uninitialized: the API answers
  done
  docker logs "$1" 2>&1 | tail -20; die "OpenBao $1 did not answer"
}
bao() { local c=$1; shift; docker exec -e BAO_ADDR=https://127.0.0.1:8200 -e BAO_CACERT=/openbao/tls/ca.pem -e BAO_TOKEN="${BAO_TOKEN:-}" "$c" bao "$@"; }
start_bao "$P-bao" "$BAO_PORT" "$RUN/bao"
bao "$P-bao" operator init -key-shares=1 -key-threshold=1 -format=json > "$RUN/bao/secrets/init.json"
jq -r '.unseal_keys_b64[0]' "$RUN/bao/secrets/init.json" > "$RUN/bao/secrets/unseal.key"
jq -r .root_token "$RUN/bao/secrets/init.json" > "$RUN/bao/secrets/operator.token"
bao "$P-bao" operator unseal "$(cat "$RUN/bao/secrets/unseal.key")" >/dev/null
sleep 2
export BAO_TOKEN; BAO_TOKEN="$(cat "$RUN/bao/secrets/operator.token")"
# The operator steps of docs/operations/openbao.md: configure, then the migration identity.
docker cp "$WEB/openbao/scripts/bootstrap.sh" "$P-bao:/tmp/bootstrap.sh"
docker cp "$WEB/openbao/policies" "$P-bao:/tmp/policies"
boot() { docker exec -i -e BAO_ADDR=https://127.0.0.1:8200 -e BAO_CACERT=/openbao/tls/ca.pem -e BAO_TOKEN="$BAO_TOKEN" -e POLICY_DIR=/tmp/policies -e SECRETS_DIR=/tmp/secrets "$@"; }
boot "$P-bao" sh /tmp/bootstrap.sh configure 2>>"$EVIDENCE"
boot "$P-bao" sh /tmp/bootstrap.sh migration-setup < "$MIG/policies/pki-manager-migration.hcl" 2>>"$EVIDENCE"
boot -e MIGRATION_TOKEN_TTL=2h "$P-bao" sh /tmp/bootstrap.sh migration-token > "$RUN/bao/secrets/migration.token" 2> "$RUN/migration-token.log"
cat "$RUN/migration-token.log" >> "$EVIDENCE"
MIGRATION_ACCESSOR=$(sed -n 's/.*accessor \([^,]*\),.*/\1/p' "$RUN/migration-token.log")
[ -n "$MIGRATION_ACCESSOR" ] || die "no migration token accessor"
# v4 runtime identities (doc-012 §2): X.509 + SSH token and a separate SCEP RA token.
bao "$P-bao" token create -policy=pki-manager-backend -no-default-policy -ttl=4h -field=token > "$RUN/bao/secrets/backend.token"
bao "$P-bao" token create -policy=pki-manager-ra -no-default-policy -ttl=4h -field=token > "$RUN/bao/secrets/ra.token"
http() { curl -s -o /dev/null -w '%{http_code}' --cacert "$RUN/bao/tls/ca.pem" -H "X-Vault-Token: $(cat "$1")" "https://127.0.0.1:$BAO_PORT/v1/$2"; }
deny() { local c; c=$(http "$1" "$2"); [ "$c" = 403 ] || die "$(basename "$1") reached $2 (HTTP $c)"; }
deny "$RUN/bao/secrets/backend.token" pki-manager/wrapping_key
deny "$RUN/bao/secrets/ra.token" pki-manager-ra/wrapping_key
deny "$RUN/bao/secrets/backend.token" pki-manager-ra/keys/probe
deny "$RUN/bao/secrets/ra.token" pki-manager/keys/probe
ok "runtime tokens: no import path (wrapping_key 403); X.509/SSH and RA identities do not cross (403)"
# The migration policy closes the import parameters: an exportable SSH key is refused by the
# policy (403); the same call with the allowed values passes the policy and Transit rejects
# the dummy ciphertext (an error that is not 403, and no key is created).
imp() { curl -s -o /dev/null -w '%{http_code}' --cacert "$RUN/bao/tls/ca.pem" -H "X-Vault-Token: $(cat "$RUN/bao/secrets/migration.token")" \
  -X POST "https://127.0.0.1:$BAO_PORT/v1/pki-manager-ssh/keys/policy-probe/import" -d "{\"ciphertext\":\"AAAA\",\"hash_function\":\"SHA256\",\"type\":\"ecdsa-p256\",\"exportable\":$1,\"allow_plaintext_backup\":false,\"allow_rotation\":false}"; }
c1=$(imp true); c2=$(imp false)
[ "$c1" = 403 ] && [ "$c2" != 403 ] && [ "${c2:0:1}" != 2 ] || die "migration policy import limits: exportable=true -> $c1 (want 403), exportable=false -> $c2 (want a Transit error)"
[ "$(http "$RUN/bao/secrets/migration.token" pki-manager-ssh/keys/policy-probe)" = 404 ] || die "the probe created a key"
ok "migration policy: exportable SSH import refused (403); allowed parameters pass the policy (Transit $c2 on a dummy ciphertext, no key)"
unset BAO_TOKEN
BADDR="https://127.0.0.1:$BAO_PORT"; CACERT="$RUN/bao/tls/ca.pem"
MT=(--openbao-addr "$BADDR" --openbao-cacert "$CACERT" --openbao-token-file "$RUN/bao/secrets/migration.token")
ok "OpenBao fork $OPENBAO_IMAGE: Raft, TLS, audit; migration token (role pki-manager-migration, not renewable, 2h) accessor $MIGRATION_ACCESSOR"

# ───────────────────────── 4. migration ─────────────────────────
KMS=(--kms-url "http://127.0.0.1:$KMS_PORT")
set +e; migrate inventory --source-db "$SRC" "${KMS[@]}" --out "$RUN/manifest.json" > "$RUN/inventory.txt"; rc=$?; set -e
cat "$RUN/inventory.txt" >> "$EVIDENCE"
[ $rc -le 1 ] || die "inventory error"
DIGEST=$(sed -n 's/^manifest digest //p' "$RUN/inventory.txt")
migrate approve-template --manifest "$RUN/manifest.json" "${MT[@]}" --out "$RUN/approval.template.json" >/dev/null
jq --arg t "$(date -u +%FT%TZ)" '.approvedBy = "rehearsal-admin" | .approvedAt = $t | .allowSourceWrappingKeyRegistration = true
  | .keys |= with_entries(if .value.acknowledgeSensitive == false then .value.acknowledgeSensitive = true else . end)' \
  "$RUN/approval.template.json" > "$RUN/approval.json"
migrate rotation-plan --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" > "$RUN/rotation-plan.md"
migrate preflight --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" --source-db "$SRC" --target-db "$TGT" "${MT[@]}" "${KMS[@]}" | tee -a "$EVIDENCE"
APPLY=(apply --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" --source-db "$SRC" --target-db "$TGT" --run-dir "$RUN/run" --confirm "${DIGEST:0:16}" --actor rehearsal-admin "${MT[@]}" "${KMS[@]}")
set +e; PKI_MIGRATE_FAULT=after-import:2 migrate "${APPLY[@]}" > "$RUN/apply-crash.json" 2>>"$EVIDENCE"; rc=$?; set -e
[ $rc -eq 75 ] || die "the simulated crash did not happen (exit $rc)"
ok "apply #1 crashed on purpose after the 2nd import (exit 75)"
migrate "${APPLY[@]}" > "$RUN/apply-resume.json"
jq -c '{imported, adopted, alreadyVerified, skipped, db, noOp}' "$RUN/apply-resume.json" | tee -a "$EVIDENCE"
[ "$(jq .adopted "$RUN/apply-resume.json")" -ge 1 ] || die "resume did not adopt the key imported before the crash"
ok "apply #2 resumed (adopted the key of the crashed run, imported the rest)"
migrate "${APPLY[@]}" > "$RUN/apply-noop.json"
jq -c '{imported, adopted, alreadyVerified, db, noOp}' "$RUN/apply-noop.json" | tee -a "$EVIDENCE"
[ "$(jq .noOp "$RUN/apply-noop.json")" = true ] || die "third apply was not a no-op"
ok "apply #3 is a verified no-op"
VERIFY=(verify --manifest "$RUN/manifest.json" --approval "$RUN/approval.json" --source-db "$SRC")
migrate "${VERIFY[@]}" --target-db "$TGT" "${MT[@]}" --out "$RUN/verify-after-apply.json" | tee -a "$EVIDENCE"
migrate "${VERIFY[@]}" --target-db "$TGT" --openbao-addr "$BADDR" --openbao-cacert "$CACERT" --openbao-token-file "$RUN/bao/secrets/backend.token" \
  --openbao-ra-token-file "$RUN/bao/secrets/ra.token" --ra-session-check --cutover --out "$RUN/verify-cutover.json" | tee -a "$EVIDENCE"
ok "verify + cutover gate pass; RA session-key unwrap with the runtime identity"
BAO_TOKEN="$(cat "$RUN/bao/secrets/operator.token")" boot -e MIGRATION_TOKEN_ACCESSOR="$MIGRATION_ACCESSOR" "$P-bao" sh /tmp/bootstrap.sh migration-revoke 2>>"$EVIDENCE"
code=$(curl -s -o /dev/null -w '%{http_code}' --cacert "$RUN/bao/tls/ca.pem" -H "X-Vault-Token: $(cat "$RUN/bao/secrets/migration.token")" "https://127.0.0.1:$BAO_PORT/v1/auth/token/lookup-self")
[ "$code" = 403 ] || die "the migration token still works after revoke (HTTP $code)"
ok "migration token revoked after the run (HTTP 403)"
log "OpenBao audit log: $(grep -c '"type":"request"' "$RUN/bao/logs/audit.log") requests recorded"

# ───────────────────────── 5. backup, Cosmian off, restore, verify ─────────────────────────
set +e; migrate backup --db "$TGT" --out-dir "$RUN/backup-denied" --label "wrong token" --openbao-addr "$BADDR" --openbao-cacert "$CACERT" --openbao-token-file "$RUN/bao/secrets/migration.token" >/dev/null 2>>"$EVIDENCE"; rc=$?; set -e
[ $rc -ne 0 ] && [ ! -e "$RUN/backup-denied" ] || die "backup with the (revoked) migration token did not fail cleanly"
ok "backup with the migration token fails and leaves no partial backup"
migrate backup --db "$TGT" --out-dir "$RUN/backup-v4" --label "migrated pair" --openbao-addr "$BADDR" --openbao-cacert "$CACERT" --openbao-token-file "$RUN/bao/secrets/operator.token" >/dev/null
migrate check-backup --dir "$RUN/backup-v4" | tee -a "$EVIDENCE"
docker stop "$P-kms" >/dev/null
ok "Cosmian stopped from here on"
start_bao "$P-bao2" "$BAO2_PORT" "$RUN/bao2"
bao "$P-bao2" operator init -key-shares=1 -key-threshold=1 -format=json > "$RUN/bao2/secrets/init.json"
bao "$P-bao2" operator unseal "$(jq -r '.unseal_keys_b64[0]' "$RUN/bao2/secrets/init.json")" >/dev/null; sleep 2
docker cp "$RUN/backup-v4/openbao.snap" "$P-bao2:/tmp/openbao.snap"
BAO_TOKEN="$(jq -r .root_token "$RUN/bao2/secrets/init.json")" bao "$P-bao2" operator raft snapshot restore -force /tmp/openbao.snap
sleep 2
# After a restore the cluster uses the keyring of the snapshot: unseal with the ORIGINAL key.
bao "$P-bao2" operator unseal "$(cat "$RUN/bao/secrets/unseal.key")" >/dev/null 2>&1 || true
for _ in $(seq 1 30); do if bao "$P-bao2" status >/dev/null 2>&1; then break; fi; sleep 1; done
docker stop "$P-bao" >/dev/null
RADDR="https://127.0.0.1:$BAO2_PORT"; RCACERT="$RUN/bao2/tls/ca.pem"
cp "$RUN/backup-v4/pki.db" "$RUN/restored.db"
migrate "${VERIFY[@]}" --target-db "$RUN/restored.db" --openbao-addr "$RADDR" --openbao-cacert "$RCACERT" --openbao-token-file "$RUN/bao/secrets/backend.token" \
  --openbao-ra-token-file "$RUN/bao/secrets/ra.token" --ra-session-check --cutover --out "$RUN/verify-restored.json" | tee -a "$EVIDENCE"
ok "restored pair (new OpenBao from the Raft snapshot + SQLite backup) verifies with Cosmian stopped"

# ───────────────────────── 6. v4 backend on the restored pair ─────────────────────────
(cd "$WEB/backend" && exec env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production PORT="$V4_PORT" HOST=127.0.0.1 DATABASE_PATH="$RUN/restored.db" \
  OPENBAO_ADDR="$RADDR" OPENBAO_CACERT="$RCACERT" OPENBAO_TOKEN_FILE="$RUN/bao/secrets/backend.token" \
  OPENBAO_RA_TOKEN_FILE="$RUN/bao/secrets/ra.token" ALLOW_UNAUTHENTICATED_SSH_CA=true ALLOW_CA_KEY_EXPORT=true \
  FRONTEND_URL="http://localhost:$V4_PORT" CRL_DISTRIBUTION_URL="http://localhost:$V4_PORT/crl" \
  node --import tsx src/server.ts > "$RUN/v4-backend.log" 2>&1) & V4_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$V4_PID" 2>/dev/null || die "v4 backend exited at startup; see $RUN/v4-backend.log"
  curl -fsS "http://127.0.0.1:$V4_PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$V4_PORT/api/v1/health" >/dev/null || { tail -30 "$RUN/v4-backend.log"; die "v4 backend did not start"; }
API="http://127.0.0.1:$V4_PORT/api/v1"
step() { local name=$1; shift; if out=$("$@" 2>&1); then ok "v4 runtime: $name"; else log "$out" | head -5; die "v4 runtime: $name"; fi; }
host_cert() {
  j -X POST "$API/ssh/hosts/issue" -d "{\"hostId\":\"$HOST\"}" | jq -er .cert.certOpenssh > "$RUN/host-cert.pub" || return 1
  bash "$HERE/verify-ssh-host.sh" "$RUN" "$NET_ID"
}
ra_state() { j "$API/external/ra/state" -H "authorization: Bearer $SCEP_TOKEN" | jq -er .certificatePem > "$RUN/ra.pem" && same_cert "$RUN/ra.pem" "$RUN/ra-v3.pem" && openssl x509 -in "$RUN/ra-v3.pem" -pubkey -noout > "$RUN/ra.pub"; }
ra_sign() {
  head -c 64 /dev/urandom | openssl dgst -sha256 -binary > "$RUN/ra.digest"
  j -X POST "$API/external/ra/sign" -H "authorization: Bearer $SCEP_TOKEN" -d "{\"digest\":\"$(base64 -w0 "$RUN/ra.digest")\"}" | jq -er .data | base64 -d > "$RUN/ra.sig"
  openssl pkeyutl -verify -pubin -inkey "$RUN/ra.pub" -pkeyopt digest:sha256 -in "$RUN/ra.digest" -sigfile "$RUN/ra.sig"
}
ra_decrypt() {
  head -c 32 /dev/urandom > "$RUN/ra.session"
  openssl pkeyutl -encrypt -pubin -inkey "$RUN/ra.pub" -pkeyopt rsa_padding_mode:pkcs1 -in "$RUN/ra.session" -out "$RUN/ra.ct"
  j -X POST "$API/external/ra/decrypt" -H "authorization: Bearer $SCEP_TOKEN" -d "{\"data\":\"$(base64 -w0 "$RUN/ra.ct")\",\"sessionKeyLength\":32}" | jq -er .data | base64 -d | cmp - "$RUN/ra.session"
}
p12_match() {
  local k c; k=$(openssl pkcs12 -in "$RUN/l3r.p12" -passin pass:Rehearsal-1 -nocerts -nodes 2>/dev/null | openssl pkey -pubout) \
    && c=$(openssl pkcs12 -in "$RUN/l3r.p12" -passin pass:Rehearsal-1 -clcerts -nokeys 2>/dev/null | openssl x509 -pubkey -noout) && [ -n "$k" ] && [ "$k" = "$c" ]
}
ca_p12_match() {
  local k c; k=$(openssl pkcs12 -in "$RUN/ca1.p12" -passin pass:Rehearsal-1 -nocerts -nodes 2>/dev/null | openssl pkey -pubout) && c=$(openssl x509 -in "$RUN/ca1-v3.pem" -pubkey -noout) && [ -n "$k" ] && [ "$k" = "$c" ]
}
same_cert() { # both must parse, and be byte-identical in DER
  local a b; a=$(openssl x509 -in "$1" -outform der | base64 -w0) && b=$(openssl x509 -in "$2" -outform der | base64 -w0) && [ -n "$a" ] && [ "$a" = "$b" ]
}
step "download the migrated CA certificate" dl "$API/cas/$CA1/download?format=pem" "$RUN/ca1.pem"
step "CA certificate identical to the v3 one" same_cert "$RUN/ca1.pem" "$RUN/ca1-v3.pem"
step "CRL signed with the migrated CA key" post "/cas/$CA1/crls" '{}'
step "download the new CRL (public endpoint)" curl -fsS "http://127.0.0.1:$V4_PORT/crl/$CA1.crl" -o "$RUN/ca1.crl"
step "CRL signature verifies with the original CA certificate (openssl)" openssl crl -in "$RUN/ca1.crl" -CAfile "$RUN/ca1-v3.pem" -noout -verify
step "new leaf from the migrated RSA-4096 CA" leaf "$CA2" new.rehearsal.test server ECDSA-P256
step "renewal with key reuse of a migrated leaf key" post "/certificates/$L1R/renew" '{"generateNewKey":false}'
step "PKCS#12 export of a migrated leaf key" dl "$API/certificates/$L3R/download?format=p12" "$RUN/l3r.p12" -H 'x-export-password: Rehearsal-1'
step "PKCS#12 private key matches the migrated leaf certificate" p12_match
step "CA keystore export of a migrated CA key (ALLOW_CA_KEY_EXPORT=true)" dl "$API/cas/$CA1/download?format=p12-keystore" "$RUN/ca1.p12" -H 'x-export-password: Rehearsal-1'
step "exported CA private key belongs to the v3 CA certificate" ca_p12_match
step "OpenSSH accepts the new host certificate with the original v3 host CA" host_cert
step "SCEP RA state: same RA certificate as v3" ra_state
step "RA signature with the migrated key verifies with the original RA certificate (openssl)" ra_sign
step "RA recovers a PKCS#1 v1.5 CMS session key with the migrated key (fork operation)" ra_decrypt
step "external CSR signing by the migrated CA" j -X POST "$API/external/sign" -H "authorization: Bearer $GEN_TOKEN" -d "$(jq -n --rawfile c "$RUN/ext.csr" '{csrPem:$c, requestUid:"rehearsal-ext-2", durationDays:30, sanDns:["ext.rehearsal.test"]}')"
# First provisioning after cutover: a new SCEP integration gets a NEW RA key, generated in
# OpenBao (not imported), and signs with it; Cosmian is still stopped.
ra_first_provision() {
  local tok
  tok=$(j -X POST "http://127.0.0.1:$V4_PORT/trpc/integration.register" -d "{\"name\":\"rehearsal-scep-v4\",\"caId\":\"$CA1\",\"kind\":\"scep\"}" | jq -er .result.data.token)
  j -X POST "$API/external/ra/provision" -H "authorization: Bearer $tok" -d '{}' >/dev/null
  j "$API/external/ra/state" -H "authorization: Bearer $tok" | jq -er .certificatePem > "$RUN/ra-v4.pem"
  openssl x509 -in "$RUN/ra-v4.pem" -pubkey -noout > "$RUN/ra-v4.pub"
  head -c 64 /dev/urandom | openssl dgst -sha256 -binary > "$RUN/ra-v4.digest"
  j -X POST "$API/external/ra/sign" -H "authorization: Bearer $tok" -d "{\"digest\":\"$(base64 -w0 "$RUN/ra-v4.digest")\"}" | jq -er .data | base64 -d > "$RUN/ra-v4.sig"
  openssl pkeyutl -verify -pubin -inkey "$RUN/ra-v4.pub" -pkeyopt digest:sha256 -in "$RUN/ra-v4.digest" -sigfile "$RUN/ra-v4.sig" >/dev/null
  local name; name=$(node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});const r=d.prepare("SELECT key_provider p, key_id k FROM integration_ras r JOIN integrations i ON i.id=r.integration_id WHERE i.name=?").get("rehearsal-scep-v4");if(r.p!=="openbao")process.exit(1);console.log(r.k)' "$RUN/restored.db" 2>/dev/null)
  [ -n "$name" ] || return 1
  curl -fsS --cacert "$RCACERT" -H "X-Vault-Token: $(cat "$RUN/bao/secrets/ra.token")" "$RADDR/v1/pki-manager-ra/keys/$name" | jq -e '.data.imported_key == false and .data.exportable == false and .data.allow_pkcs1v15_session_key == true' >/dev/null
  ! cmp -s "$RUN/ra-v4.pub" "$RUN/ra.pub"
}
step "first SCEP RA provisioning on v4: generated OpenBao key, signs, distinct from the migrated RA" ra_first_provision
ok "rehearsal complete: $RUN"
