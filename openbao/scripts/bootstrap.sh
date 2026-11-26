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
#   configure            mounts, policies, AppRole role and token role (needs BAO_TOKEN
#                        with root or the pki-manager-operator policy)
#   backend-token        DEV/TEST ONLY: write a periodic backend token to
#                        $SECRETS_DIR/backend-token (reused while it is valid)
#   approle-credentials  write role-id and a new secret-id for the OpenBao Agent to
#                        $SECRETS_DIR/approle/ (production path)
#   dev                  DEV/TEST ONLY: wait, init-dev, unseal-dev, configure, backend-token
#   status               seal status, mounts and the backend token policies
#
# Environment: BAO_ADDR (https://openbao:8200), BAO_CACERT (/openbao/tls/ca.pem),
# SECRETS_DIR (/openbao/secrets), POLICY_DIR (/openbao/policies),
# OPENBAO_TRANSIT_MOUNT (pki-manager), OPENBAO_SSH_MOUNT (pki-manager-ssh),
# OPENBAO_RA_MOUNT (pki-manager-ra), SECRETS_OWNER
# (uid:gid; when it runs as root, test stacks only: hand $SECRETS_DIR to the backend user).
#
# Production never runs the DEV/TEST commands: it initializes with several key shares
# held by people, unseals by hand, and gives the backend an AppRole through an OpenBao
# Agent. Guide: docs/operations/openbao.md
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

# The policy files name the default mounts; rewrite them for other mount paths.
write_policy() {
  sed -e 's#"pki-manager-ra/#"@RA@/#g; s#"pki-manager-ssh/#"@SSH@/#g; s#"pki-manager/#"@X509@/#g' \
      -e 's#sys/mounts/pki-manager-ra"#sys/mounts/@RA@"#g; s#sys/mounts/pki-manager-ssh"#sys/mounts/@SSH@"#g; s#sys/mounts/pki-manager"#sys/mounts/@X509@"#g' \
      -e "s#@RA@#$OPENBAO_RA_MOUNT#g; s#@SSH@#$OPENBAO_SSH_MOUNT#g; s#@X509@#$OPENBAO_TRANSIT_MOUNT#g" "$POLICY_DIR/$1.hcl" \
    | bao policy write "$1" - >/dev/null
  log "policy '$1' written"
}

cmd_configure() {
  admin_token
  [ "$(seal_state)" = unsealed ] || die "OpenBao is $(seal_state)"
  for mount in "$OPENBAO_TRANSIT_MOUNT" "$OPENBAO_RA_MOUNT" "$OPENBAO_SSH_MOUNT"; do
    case "$mount" in ""|/*|*/|*//*|*[!a-zA-Z0-9_/-]*) die "invalid Transit mount path";; esac
  done
  [ "$OPENBAO_TRANSIT_MOUNT" != "$OPENBAO_SSH_MOUNT" ] && [ "$OPENBAO_TRANSIT_MOUNT" != "$OPENBAO_RA_MOUNT" ] && [ "$OPENBAO_SSH_MOUNT" != "$OPENBAO_RA_MOUNT" ] || die "use distinct Transit mounts for X.509, SSH and SCEP"
  enable_transit "$OPENBAO_TRANSIT_MOUNT" "PKI Manager X.509 keys"
  enable_transit "$OPENBAO_SSH_MOUNT" "PKI Manager SSH CA keys"
  enable_transit "$OPENBAO_RA_MOUNT" "PKI Manager SCEP RA keys"
  write_policy pki-manager-backend
  write_policy pki-manager-ra
  write_policy pki-manager-operator
  if ! bao auth list -format=json | grep -q '"approle/"'; then
    bao auth enable approle >/dev/null
    log "enabled approle auth"
  fi
  # AppRole for the OpenBao Agent (production). Short tokens; the Agent renews and
  # re-authenticates, and writes the token to the backend OPENBAO_TOKEN_FILE.
  bao write "auth/approle/role/$ROLE" \
    token_policies="pki-manager-backend,pki-manager-ra" \
    token_no_default_policy=true token_type=service \
    token_ttl=1h token_max_ttl=24h \
    secret_id_ttl=0 secret_id_num_uses=0 bind_secret_id=true >/dev/null
  # Token role for directly issued tokens (dev/test, break-glass).
  bao write "auth/token/roles/$ROLE" \
    allowed_policies="pki-manager-backend,pki-manager-ra" \
    orphan=true renewable=true token_no_default_policy=true \
    token_period="$BACKEND_TOKEN_PERIOD" >/dev/null
  log "AppRole and token role '$ROLE' written"
}

cmd_backend_token() {
  dev_only backend-token
  admin_token
  f="$SECRETS_DIR/backend-token"
  # The backend token has no `default` policy, so it cannot look itself up: the admin
  # token checks and renews it.
  if [ -s "$f" ] && bao token lookup "$(cat "$f")" >/dev/null 2>&1; then
    # Still valid: renew it to the full period, keep the file unchanged.
    bao token renew "$(cat "$f")" >/dev/null
    log "backend token in $f is valid (renewed)"
    return 0
  fi
  mkdir -p "$SECRETS_DIR"
  bao token create -role="$ROLE" -policy=pki-manager-backend -policy=pki-manager-ra \
    -display-name=pki-manager-backend -field=token > "$f.tmp"
  mv "$f.tmp" "$f"
  log "backend token written to $f (period $BACKEND_TOKEN_PERIOD, policies pki-manager-backend + pki-manager-ra)"
}

cmd_approle_credentials() {
  admin_token
  d="$SECRETS_DIR/approle"
  mkdir -p "$d"
  bao read -field=role_id "auth/approle/role/$ROLE/role-id" > "$d/role-id"
  bao write -f -field=secret_id "auth/approle/role/$ROLE/secret-id" > "$d/secret-id.tmp"
  mv "$d/secret-id.tmp" "$d/secret-id"
  log "role-id and a new secret-id written to $d (the Agent removes the secret-id after login)"
}

cmd_status() {
  bao status || true
  if [ -s "$SECRETS_DIR/backend-token" ] && { [ -n "${BAO_TOKEN:-}" ] || { [ "${PKI_MANAGER_OPENBAO_DEV:-}" = 1 ] && [ -s "$SECRETS_DIR/dev-root-token" ]; }; }; then
    admin_token
    bao token lookup "$(cat "$SECRETS_DIR/backend-token")" 2>/dev/null \
      | grep -E "^(display_name|policies|ttl|period) " || log "backend token is not valid"
  fi
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
  approle-credentials) cmd_approle_credentials ;;
  dev) dev_only dev; cmd_wait; cmd_init_dev; cmd_unseal_dev; cmd_configure; cmd_backend_token; own_secrets ;;
  status) cmd_status ;;
  *) sed -n 's/^#   //p' "$0" >&2; exit 2 ;;
esac
