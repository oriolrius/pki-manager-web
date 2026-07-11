#!/usr/bin/env bash
# ANS-10: dockerized ssh_host_cert e2e (containers-as-hosts).
#
# One command: stands up backend+KMS, applies the role to a public-cron
# (ed25519) host and an ecies (ecdsa) host, asserts idempotence, then drives
# real ssh from a client container — cert login with no TOFU, principal RBAC,
# and per-host revocation narrowing on BOTH KRL channels.
#
# Skips cleanly (exit 0) when docker/KMS is unavailable (AC#6).
set -uo pipefail
cd "$(dirname "$0")"

REPO=$(cd ../../.. && pwd)
PORT=${E2E_BACKEND_PORT:-43000}
export E2E_BACKEND_PORT=$PORT
HOST_IP=$(hostname -I | awk '{print $1}')
BASE="http://${HOST_IP}:${PORT}"
DC="docker compose"

skip() { echo "SKIP: $*"; exit 0; }
fail() { echo "FAIL: $*"; exit 1; }
ok()   { echo "PASS: $*"; }

command -v docker >/dev/null 2>&1 || skip "docker not installed"
docker info >/dev/null 2>&1 || skip "docker daemon not reachable"

cleanup() { $DC down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

# --- krl-client static binary (built via make; the role get_url's it) ---
BIN="$REPO/krl-client/dist/krl-client-linux-amd64"
if [ ! -f "$BIN" ]; then
  command -v go >/dev/null 2>&1 || skip "krl-client binary missing and go unavailable to build it"
  (cd "$REPO/krl-client" && make build-static) || fail "krl-client build-static"
fi
CHECKSUM="sha256:$(sha256sum "$BIN" | awk '{print $1}')"

mkdir -p _artifacts
rm -f _artifacts/* 2>/dev/null || true

echo "==> building + starting stack (backend+KMS+hosts+client)"
$DC up -d --build || skip "compose up failed (docker/KMS unavailable)"

echo "==> waiting for backend health at $BASE/health"
code=000
for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" || true)
  [ "$code" = "200" ] && break
  sleep 2
done
[ "$code" = "200" ] || skip "backend/KMS did not become healthy"
ok "backend healthy"

# --- resolve the exact fqdn ansible will use (== hostname -f in the container) ---
FQDN_PUBLIC=$($DC exec -T host_public hostname -f | tr -d '\r')
FQDN_ECIES=$($DC exec -T host_ecies hostname -f | tr -d '\r')
[ -n "$FQDN_PUBLIC" ] && [ -n "$FQDN_ECIES" ] || fail "could not resolve host fqdns"
echo "    public=$FQDN_PUBLIC  ecies=$FQDN_ECIES"

echo "==> seeding backend (CAs, fleet token, principal map, user certs)"
python3 seed.py bootstrap --base "$BASE" \
  --host "${FQDN_PUBLIC}:ed25519" --host "${FQDN_ECIES}:ecdsa" \
  > _artifacts/bootstrap.json || fail "seed bootstrap"
TOKEN=$(python3 -c 'import json;print(json.load(open("_artifacts/state.json"))["token"])')
[ -n "$TOKEN" ] || fail "no fleet token from seed"
ok "seeded (token ${TOKEN:0:12}…)"

ID_PUBLIC=$($DC ps -q host_public)
ID_ECIES=$($DC ps -q host_ecies)

echo "==> writing inventory"
cat > inventory.ini <<EOF
[managed]
host_public ansible_host=${ID_PUBLIC} ssh_host_cert_ecies_enabled=false ssh_host_cert_krl_cron_enabled=true ssh_host_cert_krl_fetch_url=${BASE}/krl/hosts/${FQDN_PUBLIC}.bin
host_ecies  ansible_host=${ID_ECIES} ssh_host_cert_ecies_enabled=true

[managed:vars]
ansible_connection=community.docker.docker
ansible_user=root
ansible_python_interpreter=/usr/bin/python3
ssh_ca_base_url=${BASE}
ssh_ca_fleet_token=${TOKEN}
ssh_host_cert_validate_certs=false
ssh_host_cert_require_timesync=false
ssh_host_cert_reload_method=command
ssh_host_cert_scheduler=cron
ssh_host_cert_krl_client_url=file:///opt/krl-client-linux-amd64
ssh_host_cert_krl_client_checksum=${CHECKSUM}
ssh_host_cert_krl_client_man_src=${REPO}/krl-client/packaging/krl-client.8
EOF

echo "==> CONVERGE (run 1)"
ansible-playbook -i inventory.ini converge.yml 2>&1 | tee _artifacts/converge1.log
grep -qE 'failed=[1-9]' _artifacts/converge1.log && fail "converge run 1 had failures"
ok "converge run 1"

echo "==> IDEMPOTENCE (run 2 — expect changed=0)"
ansible-playbook -i inventory.ini converge.yml 2>&1 | tee _artifacts/converge2.log
grep -qE 'failed=[1-9]' _artifacts/converge2.log && fail "converge run 2 had failures"
if grep -E 'changed=[1-9]' _artifacts/converge2.log; then
  fail "idempotence: run 2 reported changed tasks"
fi
ok "idempotence: run 2 changed=0"

# ---------- verify helpers (real ssh from the client container) ----------
ssh_login() { # user targetfqdn  -> prints LOGIN_OK on success
  $DC exec -T client ssh \
    -i "/artifacts/${1}_id" \
    -o "CertificateFile=/artifacts/${1}_id-cert.pub" \
    -o "UserKnownHostsFile=/artifacts/known_hosts" \
    -o StrictHostKeyChecking=yes -o PasswordAuthentication=no \
    -o BatchMode=yes -o ConnectTimeout=8 \
    "deploy@${2}" 'echo LOGIN_OK' 2>/dev/null
}
assert_accept() { # user host label
  out=$(ssh_login "$1" "$2"); [ "$out" = "LOGIN_OK" ] || fail "$3 (expected accept)"; ok "$3"
}
assert_deny() { # user host label
  out=$(ssh_login "$1" "$2"); [ "$out" = "LOGIN_OK" ] && fail "$3 (expected deny)"; ok "$3"
}

echo "==> VERIFY: cert login (no TOFU) + principal RBAC"
assert_accept alice "$FQDN_PUBLIC" "alice logs into public host (cert, StrictHostKeyChecking=yes, no TOFU)"
assert_accept alice "$FQDN_ECIES"  "alice logs into ecies host (cert, no TOFU)"
assert_deny  mallory "$FQDN_PUBLIC" "mallory (unlisted principal) denied on public host (RBAC)"

echo "==> VERIFY: revocation narrowing on the PUBLIC (curl-cron) channel"
python3 seed.py block --base "$BASE" --host "$FQDN_PUBLIC" --user alice || fail "block alice on public"
REV="/etc/ssh/revoked_keys"
$DC exec -T host_public bash -c \
  "curl -fsS --max-time 30 -o ${REV}.tmp '${BASE}/krl/hosts/${FQDN_PUBLIC}.bin' && chmod 0444 ${REV}.tmp && mv -f ${REV}.tmp ${REV}" \
  || fail "public host KRL pull"
assert_deny  alice "$FQDN_PUBLIC" "alice denied on public host after block (revoked by file)"
assert_accept alice "$FQDN_ECIES"  "alice still accepted on ecies host (block narrowed to public)"

echo "==> VERIFY: revocation on the ECIES (krl-client) channel"
python3 seed.py block --base "$BASE" --host "$FQDN_ECIES" --user alice || fail "block alice on ecies"
$DC exec -T host_ecies /usr/local/bin/krl-client --config /etc/krl-client/config.yaml --log-format json --quiet \
  || fail "krl-client pull on ecies host"
SIZE=$($DC exec -T host_ecies stat -c %s /etc/ssh/revoked_keys | tr -d '\r')
[ "${SIZE:-0}" -gt 0 ] || fail "ecies revoked_keys is empty (krl-client did not install a signed KRL)"
ok "ecies host installed a signature-verified RevokedKeys (${SIZE} bytes)"
assert_deny alice "$FQDN_ECIES" "alice denied on ecies host after krl-client pull (revoked by file)"

echo
echo "============================================================"
echo "ALL E2E ASSERTIONS PASSED (ANS-10)"
echo "============================================================"
