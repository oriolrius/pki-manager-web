#!/bin/sh
# bootstrap.sh — set up the OpenBao server that PKI Manager uses.
#
# Runs inside the OpenBao image (busybox sh + the `bao` CLI); the Compose files and the
# Kubernetes test Job mount it at /openbao/scripts. Every command is idempotent.
#
#   wait                 wait until the API answers (sealed or not)
#   init-dev             DEV/TEST ONLY: initialize with ONE unseal key and keep the key
#                        and the root token in $SECRETS_DIR (refused without
#                        PKI_MANAGER_OPENBAO_DEV=1)
#   unseal-dev           DEV/TEST ONLY: unseal with the key that init-dev stored
#   configure            mounts, policies, the AppRoles and token roles pki-manager-backend
#                        (X.509 + SSH) and pki-manager-ra (SCEP RA) (needs BAO_TOKEN with
#                        root or the pki-manager-operator policy)
#   backend-token        DEV/TEST ONLY: write a periodic X.509/SSH token (policy
#                        pki-manager-backend only) to $SECRETS_DIR/backend-token (reused
#                        while it is valid and has exactly that policy)
#   ra-token             DEV/TEST ONLY: write a periodic SCEP RA token (policy
#                        pki-manager-ra only) to $SECRETS_DIR/ra-token (same reuse rule)
#   approle-credentials [backend|ra]
#                        write role-id and a new secret-id for one OpenBao Agent to
#                        $SECRETS_DIR/approle/ (backend, the default) or
#                        $SECRETS_DIR/approle-ra/ (ra) (production path)
#   revoke-agent-tokens  revoke every token issued by an AppRole login, then restart the
#                        Agents so they log in again. Run it once after `configure` changed
#                        the AppRole policies: a renewed token keeps the policies of its login
#   migration-setup      write the migration policy (HCL on stdin: the file
#                        scripts/migration/policies/pki-manager-migration.hcl) and the
#                        token role pki-manager-migration; the backend never gets it
#   migration-token      print a new short-lived token for the v3 -> v4 migration tool
#                        (policy pki-manager-migration, not renewable, TTL
#                        $MIGRATION_TOKEN_TTL, default 1h, at most 8h) to stdout, which
#                        must be a file; its accessor and expiry go to stderr
#   migration-revoke     revoke the migration token whose accessor is in
#                        $MIGRATION_TOKEN_ACCESSOR (refused for any other token)
#   dev                  DEV/TEST ONLY: wait, init-dev, unseal-dev, configure, backend-token,
#                        ra-token
#   status               seal status and the policies of the dev/test runtime tokens
#
# Environment: BAO_ADDR (https://openbao:8200), BAO_CACERT (/openbao/tls/ca.pem),
# SECRETS_DIR (/openbao/secrets), POLICY_DIR (/openbao/policies),
# OPENBAO_TRANSIT_MOUNT (pki-manager), OPENBAO_SSH_MOUNT (pki-manager-ssh),
# OPENBAO_RA_MOUNT (pki-manager-ra), MIGRATION_TOKEN_TTL (1h), SECRETS_OWNER
# (uid:gid; when it runs as root, test stacks only: hand $SECRETS_DIR to the backend user).
#
# Production never runs the DEV/TEST commands: it initializes with several key shares
# held by people, unseals by hand, and gives the backend one AppRole per credential, each
# through its own OpenBao Agent (the RA Agent only where SCEP is used).
# Guide: docs/operations/openbao.md
set -eu

: "${BAO_ADDR:=https://openbao:8200}"
: "${BAO_CACERT:=/openbao/tls/ca.pem}"
: "${SECRETS_DIR:=/openbao/secrets}"
: "${POLICY_DIR:=/openbao/policies}"
: "${OPENBAO_TRANSIT_MOUNT:=pki-manager}"
: "${OPENBAO_RA_MOUNT:=pki-manager-ra}"
: "${OPENBAO_SSH_MOUNT:=pki-manager-ssh}"
: "${BACKEND_TOKEN_PERIOD:=768h}"
export BAO_ADDR BAO_CACERT
umask 077

ROLE=pki-manager-backend
RA_ROLE=pki-manager-ra
MIGRATION_ROLE=pki-manager-migration
log() { echo "openbao-bootstrap: $*" >&2; }
die() { log "error: $*"; exit 1; }

dev_only() {
  [ "${PKI_MANAGER_OPENBAO_DEV:-}" = "1" ] \
    || die "'$1' is for dev and test stacks only (it stores the unseal key on disk). Set PKI_MANAGER_OPENBAO_DEV=1 there; production: docs/operations/openbao.md"
}

# bao status: exit 0 unsealed, 2 sealed, 1 error.
seal_state() {
  set +e; out="$(bao status -format=json 2>/dev/null)"; rc=$?; set -e
  case "$rc" in
    0) echo unsealed ;;
    2) if echo "$out" | grep -q '"initialized": *true'; then echo sealed; else echo uninitialized; fi ;;
    *) echo unreachable ;;
  esac
}

cmd_wait() {
  i=0
  while [ "$(seal_state)" = unreachable ]; do
    i=$((i + 1)); [ "$i" -le 60 ] || die "OpenBao at $BAO_ADDR did not answer in 60 s"
    sleep 1
  done
  log "OpenBao at $BAO_ADDR is $(seal_state)"
}

cmd_init_dev() {
  dev_only init-dev
  mkdir -p "$SECRETS_DIR"
  case "$(seal_state)" in
    uninitialized)
      out="$(bao operator init -key-shares=1 -key-threshold=1)"
      echo "$out" | sed -n 's/^Unseal Key 1: *//p' > "$SECRETS_DIR/dev-unseal-key"
      echo "$out" | sed -n 's/^Initial Root Token: *//p' > "$SECRETS_DIR/dev-root-token"
      [ -s "$SECRETS_DIR/dev-unseal-key" ] && [ -s "$SECRETS_DIR/dev-root-token" ] || die "could not read the init output"
      log "initialized (1 key share; DEV/TEST ONLY: key and root token in $SECRETS_DIR)"
      ;;
    unreachable) die "OpenBao at $BAO_ADDR is unreachable" ;;
    *) log "already initialized" ;;
  esac
}

cmd_unseal_dev() {
  dev_only unseal-dev
  case "$(seal_state)" in
    sealed)
      [ -s "$SECRETS_DIR/dev-unseal-key" ] || die "sealed, and no $SECRETS_DIR/dev-unseal-key (initialized elsewhere?)"
      bao operator unseal "$(cat "$SECRETS_DIR/dev-unseal-key")" >/dev/null
      log "unsealed" ;;
    unsealed) log "already unsealed" ;;
    *) die "cannot unseal: OpenBao is $(seal_state)" ;;
  esac
}

admin_token() {
  if [ -z "${BAO_TOKEN:-}" ] && [ "${PKI_MANAGER_OPENBAO_DEV:-}" = "1" ] && [ -s "$SECRETS_DIR/dev-root-token" ]; then
    BAO_TOKEN="$(cat "$SECRETS_DIR/dev-root-token")"
  fi
  [ -n "${BAO_TOKEN:-}" ] || die "set BAO_TOKEN (root, or a token with the pki-manager-operator policy)"
  export BAO_TOKEN
}

enable_transit() {
  if bao read -format=json "sys/mounts/$1" >/dev/null 2>&1; then
    log "transit mount '$1' exists"
  else
    bao secrets enable -path="$1" -description="$2" transit >/dev/null
    log "enabled transit at '$1'"
  fi
}

# KV v1 mount of the backup pair marker (scripts/migration/lib/backup.ts): one entry,
# written by `pki-migrate backup` and read by `verify --restore`, operator token only.
BACKUP_MOUNT=pki-manager-backup
enable_backup_kv() {
  if bao read -format=json "sys/mounts/$BACKUP_MOUNT" >/dev/null 2>&1; then
    log "kv mount '$BACKUP_MOUNT' exists"
  else
    bao secrets enable -path="$BACKUP_MOUNT" -version=1 -description="PKI Manager backup pair marker" kv >/dev/null
    log "enabled kv (v1) at '$BACKUP_MOUNT'"
  fi
}

# The policy files name the default mounts; rewrite them for other mount paths.
# write_policy NAME [FILE]: FILE defaults to $POLICY_DIR/NAME.hcl.
write_policy() {
  src="${2:-$POLICY_DIR/$1.hcl}"
  sed -e 's#"pki-manager-ra/#"@RA@/#g; s#"pki-manager-ssh/#"@SSH@/#g; s#"pki-manager/#"@X509@/#g' \
      -e 's#/mounts/pki-manager-ra"#/mounts/@RA@"#g; s#/mounts/pki-manager-ssh"#/mounts/@SSH@"#g; s#/mounts/pki-manager"#/mounts/@X509@"#g' \
      -e "s#@RA@#$OPENBAO_RA_MOUNT#g; s#@SSH@#$OPENBAO_SSH_MOUNT#g; s#@X509@#$OPENBAO_TRANSIT_MOUNT#g" "$src" \
    | bao policy write "$1" - >/dev/null
  log "policy '$1' written"
}

cmd_configure() {
  admin_token
  [ "$(seal_state)" = unsealed ] || die "OpenBao is $(seal_state)"
  for mount in "$OPENBAO_TRANSIT_MOUNT" "$OPENBAO_RA_MOUNT" "$OPENBAO_SSH_MOUNT"; do
    case "$mount" in ""|/*|*/|*//*|*[!a-zA-Z0-9_/-]*) die "invalid Transit mount path";; esac
  done
  for mount in "$OPENBAO_TRANSIT_MOUNT" "$OPENBAO_RA_MOUNT" "$OPENBAO_SSH_MOUNT"; do
    [ "$mount" != "$BACKUP_MOUNT" ] || die "'$BACKUP_MOUNT' is the backup marker mount: use another Transit mount"
  done
  [ "$OPENBAO_TRANSIT_MOUNT" != "$OPENBAO_SSH_MOUNT" ] && [ "$OPENBAO_TRANSIT_MOUNT" != "$OPENBAO_RA_MOUNT" ] && [ "$OPENBAO_SSH_MOUNT" != "$OPENBAO_RA_MOUNT" ] || die "use distinct Transit mounts for X.509, SSH and SCEP"
  enable_transit "$OPENBAO_TRANSIT_MOUNT" "PKI Manager X.509 keys"
  enable_transit "$OPENBAO_SSH_MOUNT" "PKI Manager SSH CA keys"
  enable_transit "$OPENBAO_RA_MOUNT" "PKI Manager SCEP RA keys"
  enable_backup_kv
  write_policy pki-manager-backend
  write_policy pki-manager-ra
  write_policy pki-manager-operator
  if ! bao auth list -format=json | grep -q '"approle/"'; then
    bao auth enable approle >/dev/null
    log "enabled approle auth"
  fi
  # One AppRole per runtime credential (production), each with ONE policy: the backend
  # token (X.509 + SSH) cannot reach the RA mount, and the RA token cannot reach the
  # X.509 or SSH mounts. Short tokens; each Agent renews and re-authenticates, and
  # writes its token to the backend OPENBAO_TOKEN_FILE or OPENBAO_RA_TOKEN_FILE.
  # Token roles: directly issued tokens (dev/test, break-glass), same single policy.
  for r in "$ROLE" "$RA_ROLE"; do
    bao write "auth/approle/role/$r" \
      token_policies="$r" \
      token_no_default_policy=true token_type=service \
      token_ttl=1h token_max_ttl=24h \
      secret_id_ttl=0 secret_id_num_uses=0 bind_secret_id=true >/dev/null
    bao write "auth/token/roles/$r" \
      allowed_policies="$r" disallowed_policies="root" \
      orphan=true renewable=true token_no_default_policy=true \
      token_period="$BACKEND_TOKEN_PERIOD" >/dev/null
    log "AppRole and token role '$r' written (policy $r only)"
  done
}

# The migration policy belongs to the migration tool (scripts/migration/policies), which
# the bootstrap container does not mount: the operator pipes the file in. Token role:
# short, not renewable, no `default` policy. The backend AppRole and token role above
# never list pki-manager-migration.
cmd_migration_setup() {
  admin_token
  [ "$(seal_state)" = unsealed ] || die "OpenBao is $(seal_state)"
  [ ! -t 0 ] || die "pipe the migration policy on stdin (< scripts/migration/policies/pki-manager-migration.hcl)"
  tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
  cat > "$tmp"
  grep -q '^path ' "$tmp" || die "stdin holds no policy"
  ! grep -E '^ *path|capabilities' "$tmp" | grep -Eq 'sudo|"\*"|auth/approle|auth/token/(create|roles)|sys/(policies|storage|mounts"|auth|seal|audit)|/(export|backup|restore)/' \
    || die "the migration policy on stdin names an administrative or export path: refused"
  write_policy pki-manager-migration "$tmp"
  bao write "auth/token/roles/$MIGRATION_ROLE" \
    allowed_policies="pki-manager-migration" disallowed_policies="root" \
    orphan=true renewable=false token_no_default_policy=true token_type=service \
    token_explicit_max_ttl=8h >/dev/null
  log "token role '$MIGRATION_ROLE' written"
}

# Prints the token to stdout only, so the operator chooses the file (mode 0600 by the
# caller's umask) and the token never lands in OpenBao's shared secrets directory.
cmd_migration_token() {
  admin_token
  [ ! -t 1 ] || die "stdout is a terminal: redirect it to the token file (> FILE)"
  ttl="${MIGRATION_TOKEN_TTL:-1h}"
  case "$ttl" in ""|*[!0-9smh]*) die "MIGRATION_TOKEN_TTL must be a duration such as 30m or 2h" ;; esac
  out="$(bao token create -role="$MIGRATION_ROLE" -policy=pki-manager-migration \
    -ttl="$ttl" -display-name=pki-migrate -format=json)"
  token="$(echo "$out" | sed -n 's/.*"client_token": *"\([^"]*\)".*/\1/p')"
  accessor="$(echo "$out" | sed -n 's/.*"accessor": *"\([^"]*\)".*/\1/p')"
  ttl_s="$(echo "$out" | sed -n 's/.*"lease_duration": *\([0-9]*\).*/\1/p' | tail -n 1)"
  [ -n "$token" ] && [ -n "$accessor" ] || die "could not read the token create output"
  printf '%s\n' "$token"
  log "migration token issued: accessor $accessor, expires in ${ttl_s}s, not renewable"
}

cmd_migration_revoke() {
  admin_token
  acc="${MIGRATION_TOKEN_ACCESSOR:-}"
  case "$acc" in ""|*[!A-Za-z0-9._-]*) die "set MIGRATION_TOKEN_ACCESSOR to the accessor that migration-token printed" ;; esac
  set +e; info="$(bao token lookup -accessor -format=json "$acc" 2>&1)"; rc=$?; set -e
  if [ "$rc" -ne 0 ]; then
    if echo "$info" | grep -qi 'invalid accessor\|bad token'; then log "accessor $acc is not valid (expired or revoked already)"; return 0; fi
    die "lookup of accessor $acc failed: $(echo "$info" | tail -n 1)"
  fi
  # Revoke only migration tokens: never the backend token or an operator token.
  pols="$(echo "$info" | tr -d ' \n' | sed -n 's/.*"policies":\[\([^]]*\)\].*/\1/p')"
  [ "$pols" = '"pki-manager-migration"' ] || die "accessor $acc is not a migration token (policies $pols)"
  bao token revoke -accessor "$acc" >/dev/null
  log "migration token $acc revoked"
}

# runtime_token FILE ROLE: a periodic dev/test token of token role ROLE (policy ROLE only).
# A valid token with exactly that policy is renewed and kept. Any other token in the file
# (expired, or issued before the X.509/SSH and RA credentials were split) is revoked and
# replaced.
runtime_token() {
  f="$SECRETS_DIR/$1" role="$2"
  # The runtime tokens have no `default` policy, so they cannot look themselves up: the
  # admin token checks and renews them.
  if [ -s "$f" ] && info="$(bao token lookup -format=json "$(cat "$f")" 2>/dev/null)"; then
    pols="$(echo "$info" | tr -d ' \n' | sed -n 's/.*"policies":\[\([^]]*\)\].*/\1/p')"
    if [ "$pols" = "\"$role\"" ]; then
      bao token renew "$(cat "$f")" >/dev/null
      log "$1 in $SECRETS_DIR is valid (renewed, policy $role)"
      return 0
    fi
    bao token revoke "$(cat "$f")" >/dev/null
    log "$1 had policies [$pols]: revoked, issuing a $role-only token"
  fi
  mkdir -p "$SECRETS_DIR"
  bao token create -role="$role" -policy="$role" -display-name="$role" -field=token > "$f.tmp"
  mv "$f.tmp" "$f"
  log "$1 written to $SECRETS_DIR (period $BACKEND_TOKEN_PERIOD, policy $role only)"
}

cmd_backend_token() {
  dev_only backend-token
  admin_token
  runtime_token backend-token "$ROLE"
}

cmd_ra_token() {
  dev_only ra-token
  admin_token
  runtime_token ra-token "$RA_ROLE"
}

cmd_approle_credentials() {
  case "${1:-backend}" in
    backend) role="$ROLE" d="$SECRETS_DIR/approle" ;;
    ra) role="$RA_ROLE" d="$SECRETS_DIR/approle-ra" ;;
    *) die "approle-credentials takes 'backend' (X.509 + SSH, the default) or 'ra' (SCEP RA)" ;;
  esac
  admin_token
  mkdir -p "$d"
  tmp="$(mktemp -d "$d/.login.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  bao read -field=role_id "auth/approle/role/$role/role-id" > "$tmp/role-id"
  bao write -f -field=secret_id "auth/approle/role/$role/secret-id" > "$tmp/secret-id"
  chmod 0400 "$tmp/role-id" "$tmp/secret-id"
  mv "$tmp/role-id" "$d/role-id"
  mv "$tmp/secret-id" "$d/secret-id"
  log "role-id and a new secret-id of '$role' written to $d for Agent login and restart"
}

# After a policy change (for example the split of the RA policy from the backend AppRole),
# AppRole tokens issued before it keep their old policies through every renewal until
# their max TTL. Revoking them makes both Agents log in again at once.
cmd_revoke_agent_tokens() {
  admin_token
  [ "$(seal_state)" = unsealed ] || die "OpenBao is $(seal_state)"
  bao lease revoke -prefix auth/approle/login >/dev/null
  log "revoked every AppRole login token: restart the Agents now (openbao-agent, and openbao-agent-ra with SCEP); until then the backend gets HTTP 403"
}

cmd_status() {
  bao status || true
  for t in backend-token ra-token; do
    if [ -s "$SECRETS_DIR/$t" ] && { [ -n "${BAO_TOKEN:-}" ] || { [ "${PKI_MANAGER_OPENBAO_DEV:-}" = 1 ] && [ -s "$SECRETS_DIR/dev-root-token" ]; }; }; then
      admin_token
      log "$t:"
      bao token lookup "$(cat "$SECRETS_DIR/$t")" 2>/dev/null \
        | grep -E "^(display_name|policies|ttl|period) " || log "$t is not valid"
    fi
  done
}

# Test stacks run this as root on a named volume; the backend reads the token as its own user.
own_secrets() {
  if [ -n "${SECRETS_OWNER:-}" ] && [ "$(id -u)" = 0 ]; then
    chown -R "$SECRETS_OWNER" "$SECRETS_DIR"
    log "$SECRETS_DIR handed to $SECRETS_OWNER"
  fi
}

case "${1:-}" in
  wait) cmd_wait ;;
  init-dev) cmd_init_dev ;;
  unseal-dev) cmd_unseal_dev ;;
  configure) cmd_configure ;;
  backend-token) cmd_backend_token; own_secrets ;;
  ra-token) cmd_ra_token; own_secrets ;;
  approle-credentials) cmd_approle_credentials "${2:-backend}" ;;
  revoke-agent-tokens) cmd_revoke_agent_tokens ;;
  migration-setup) cmd_migration_setup ;;
  migration-token) cmd_migration_token ;;
  migration-revoke) cmd_migration_revoke ;;
  dev) dev_only dev; cmd_wait; cmd_init_dev; cmd_unseal_dev; cmd_configure; cmd_backend_token; cmd_ra_token; own_secrets ;;
  status) cmd_status ;;
  *) sed -n 's/^#   //p' "$0" >&2; exit 2 ;;
esac
