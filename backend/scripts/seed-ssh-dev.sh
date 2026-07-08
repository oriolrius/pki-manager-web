#!/usr/bin/env bash
#
# seed-ssh-dev.sh — populate the local dev DB with synthetic SSH data.
#
# Drives the real tRPC API (same code paths the UI uses), so every SSH CA,
# host, identity, principal and certificate is genuinely signed. Generates
# throwaway ed25519 keypairs for host registration and user-cert issuance.
#
# Requires: the backend dev server running (default http://localhost:52081)
# with ALLOW_UNAUTHENTICATED_SSH_CA=true (local dev, OIDC off).
#
# Idempotent-ish: re-running tolerates CONFLICT on already-existing names and
# reuses existing CAs/identities/principals/hosts by looking them up.
#
# Usage:  API=http://localhost:52081 bash backend/scripts/seed-ssh-dev.sh
set -uo pipefail

API="${API:-http://localhost:52081}"
TRPC="$API/trpc"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf '\033[1;36m%s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$*"; }

# POST a tRPC mutation; echo the JSON response.
post() { curl -s -m 30 -X POST "$TRPC/$1" -H 'content-type: application/json' -d "$2"; }
# GET a tRPC query with empty input; echo the JSON response.
getq() { curl -s -m 30 "$TRPC/$1?input=%7B%7D"; }

# Extract the id created by a mutation, or empty on error (e.g. CONFLICT).
new_id() { jq -r '.result.data.id // empty' 2>/dev/null; }

# --- CAs: reuse existing user/host CAs, or create them -----------------------
say "CAs"
CA_JSON="$(getq ssh.ca.list)"
USER_CA="$(echo "$CA_JSON" | jq -r '[.result.data[] | select(.caType=="user")][0].id // empty')"
HOST_CA="$(echo "$CA_JSON" | jq -r '[.result.data[] | select(.caType=="host")][0].id // empty')"
if [ -z "$USER_CA" ]; then
  USER_CA="$(post ssh.ca.create '{"caType":"user","label":"Corp User CA"}' | new_id)"
  echo "  created user CA $USER_CA"
else echo "  reusing user CA $USER_CA"; fi
if [ -z "$HOST_CA" ]; then
  HOST_CA="$(post ssh.ca.create '{"caType":"host","label":"Corp Host CA"}' | new_id)"
  echo "  created host CA $HOST_CA"
else echo "  reusing host CA $HOST_CA"; fi

# --- Principals (roles) ------------------------------------------------------
say "Principals"
declare -A PRIN   # name -> id
for row in "deploy:Application deployment" "dba:Database admins" \
           "webadmin:Web server admins" "monitoring:Read-only monitoring" \
           "backup:Backup automation" "root:Emergency break-glass"; do
  name="${row%%:*}"; desc="${row#*:}"
  post ssh.principal.create "$(jq -nc --arg n "$name" --arg d "$desc" '{name:$n,description:$d}')" >/dev/null
done
# Resolve all principal ids by name from the list.
PJSON="$(getq ssh.principal.list)"
while IFS=$'\t' read -r n i; do PRIN["$n"]="$i"; done < <(echo "$PJSON" | jq -r '.result.data[] | "\(.name)\t\(.id)"')
echo "  ${#PRIN[@]} principals present"

# --- Identities (people) -----------------------------------------------------
say "Identities"
for row in "alice:alice@corp.example" "bob:bob@corp.example" \
           "carol:carol@corp.example" "dave:dave@corp.example" \
           "eve:eve@corp.example" "frank:frank@corp.example" \
           "grace:grace@corp.example"; do
  subj="${row%%:*}"; email="${row#*:}"
  post ssh.user.createIdentity "$(jq -nc --arg s "$subj" --arg e "$email" '{subject:$s,email:$e}')" >/dev/null
done
IJSON="$(getq ssh.user.listIdentities)"
declare -A IDENT   # subject -> id
while IFS=$'\t' read -r s i; do IDENT["$s"]="$i"; done < <(echo "$IJSON" | jq -r '.result.data[] | "\(.subject)\t\(.id)"')
echo "  ${#IDENT[@]} identities present"

# --- Hosts -------------------------------------------------------------------
say "Hosts"
declare -A HOST   # fqdn -> id
gen_hostkey() { ssh-keygen -t ed25519 -N '' -C "$1" -f "$TMP/$1" -q; cat "$TMP/$1.pub"; }
idx=1
for row in "web-01.corp.example:10.0.1.11" "web-02.corp.example:10.0.1.12" \
           "db-01.corp.example:10.0.2.21" "bastion-01.corp.example:10.0.0.5" \
           "monitor-01.corp.example:10.0.3.31"; do
  fqdn="${row%%:*}"; addr="${row#*:}"
  pub="$(gen_hostkey "host$idx")"; idx=$((idx+1))
  resp="$(post ssh.host.register "$(jq -nc --arg f "$fqdn" --arg a "$addr" --arg p "$pub" \
        '{fqdn:$f,displayName:$f,addresses:[$a],opensshHostPubkey:$p}')")"
  id="$(echo "$resp" | new_id)"
  HOST["$fqdn"]="$id"
done
# Resolve any that already existed.
HJSON="$(getq ssh.host.list)"
while IFS=$'\t' read -r f i; do [ -n "$i" ] && HOST["$f"]="$i"; done < <(echo "$HJSON" | jq -r '.result.data[] | "\(.fqdn)\t\(.id)"')
echo "  ${#HOST[@]} hosts present"

# --- Grant principals to identities & map principals to hosts ----------------
say "Entitlements (grant roles to people, map roles to host accounts)"
grant() { post ssh.principal.grant "$(jq -nc --arg i "$1" --arg p "$2" '{identityId:$i,principalId:$p}')" >/dev/null; }
mapp()  { post ssh.principal.map "$(jq -nc --arg h "$1" --arg p "$2" --arg l "$3" '{hostId:$h,principalId:$p,localAccount:$l}')" >/dev/null; }

grant "${IDENT[alice]}" "${PRIN[webadmin]}";   grant "${IDENT[alice]}" "${PRIN[deploy]}"
grant "${IDENT[bob]}"   "${PRIN[dba]}"
grant "${IDENT[carol]}" "${PRIN[deploy]}";     grant "${IDENT[carol]}" "${PRIN[monitoring]}"
grant "${IDENT[dave]}"  "${PRIN[monitoring]}"
grant "${IDENT[eve]}"   "${PRIN[backup]}"
grant "${IDENT[frank]}" "${PRIN[webadmin]}"

mapp "${HOST[web-01.corp.example]}"     "${PRIN[webadmin]}"   webadmin
mapp "${HOST[web-01.corp.example]}"     "${PRIN[deploy]}"     deploy
mapp "${HOST[web-02.corp.example]}"     "${PRIN[webadmin]}"   webadmin
mapp "${HOST[db-01.corp.example]}"      "${PRIN[dba]}"        postgres
mapp "${HOST[monitor-01.corp.example]}" "${PRIN[monitoring]}" nobody
echo "  grants + host maps applied"

# --- Issue user certificates (populates the per-user certs table) ------------
say "User certificates"
issue_user() { # <subject> <principals-json-array> <ttl-seconds> <extensions-json-array>
  local subj="$1" prins="$2" ttl="$3" exts="$4" id="${IDENT[$1]}"
  local kf="$TMP/u_${subj}_${RANDOM}"
  ssh-keygen -t ed25519 -N '' -C "$subj@laptop" -f "$kf" -q
  local pub; pub="$(cat "$kf.pub")"
  local body; body="$(jq -nc --arg id "$id" --arg ca "$USER_CA" --arg pk "$pub" \
      --argjson pr "$prins" --argjson ttl "$ttl" --argjson ex "$exts" \
      '{identityId:$id,caId:$ca,sshPublicKey:$pk,principals:$pr,validForSeconds:$ttl,extensions:$ex}')"
  local out; out="$(post ssh.user.issue "$body")"
  if echo "$out" | jq -e '.result.data' >/dev/null 2>&1; then
    echo "  ✔ $subj  [$(echo "$prins" | jq -r 'join(",")')]  ttl=${ttl}s"
  else
    warn "$subj issue failed: $(echo "$out" | jq -r '.error.message // .' | head -c 160)"
  fi
}
DAY=$((24*3600))
issue_user alice '["webadmin","deploy"]' $((30*DAY)) '["permit-pty","permit-agent-forwarding"]'
issue_user alice '["webadmin"]'          $((1*DAY))  '["permit-pty"]'
issue_user bob   '["dba"]'               $((7*DAY))  '["permit-pty"]'
issue_user bob   '["dba"]'               $((90*DAY)) '["permit-pty","permit-port-forwarding"]'
issue_user carol '["deploy","monitoring"]' $((30*DAY)) '["permit-pty"]'
issue_user dave  '["monitoring"]'        $((14*DAY)) '["permit-pty"]'
issue_user eve   '["backup"]'            $((365*DAY)) '["permit-pty"]'
issue_user frank '["webadmin"]'          $((3*DAY))  '["permit-pty"]'

# --- Issue host certificates -------------------------------------------------
say "Host certificates"
for fqdn in web-01.corp.example web-02.corp.example db-01.corp.example \
            bastion-01.corp.example monitor-01.corp.example; do
  hid="${HOST[$fqdn]}"; [ -z "$hid" ] && continue
  out="$(post ssh.host.issue "$(jq -nc --arg h "$hid" --arg ca "$HOST_CA" \
        '{hostId:$h,caId:$ca,validForSeconds:2592000}')")"
  if echo "$out" | jq -e '.result.data' >/dev/null 2>&1; then echo "  ✔ $fqdn"
  else warn "$fqdn issue failed: $(echo "$out" | jq -r '.error.message // .' | head -c 160)"; fi
done

# --- Optional: place a couple of access blocks so the UI shows red pills ------
say "Access blocks (demo)"
block() { post ssh.block.block "$(jq -nc --arg h "$1" --arg i "$2" --arg r "$3" '{hostId:$h,identityId:$i,reason:$r}')" >/dev/null; }
block "${HOST[db-01.corp.example]}" "${IDENT[frank]}" "left the DBA rotation" 2>/dev/null || true

say "Done. Refresh the SSH pages in the UI."
