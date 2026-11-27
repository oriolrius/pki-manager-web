# Migration identity of scripts/migration/pki-migrate.ts (offline v3 -> OpenBao).
# A token with this policy only, no `default`, short TTL; revoke it after the run.
# Mount paths are the backend defaults; replace them when OPENBAO_*_MOUNT differ.
#
# It can read each mount's wrapping key, import keys (create only: the import path
# refuses an existing name), read key policies and sign a fresh challenge.
# Denied by omission: export, backup, config, delete, rotate, decrypt, the RA
# session-key operation (RA unwrap tests use the runtime identity), sys/* writes.

path "pki-manager/wrapping_key"         { capabilities = ["read"] }
path "pki-manager/keys/+"               { capabilities = ["read"] }
path "pki-manager/keys/+/import"        { capabilities = ["create", "update"] }
path "pki-manager/sign/+/+"             { capabilities = ["update"] }

path "pki-manager-ssh/wrapping_key"     { capabilities = ["read"] }
path "pki-manager-ssh/keys/+"           { capabilities = ["read"] }
path "pki-manager-ssh/keys/+/import"    { capabilities = ["create", "update"] }
path "pki-manager-ssh/sign/+/+"         { capabilities = ["update"] }

path "pki-manager-ra/wrapping_key"      { capabilities = ["read"] }
path "pki-manager-ra/keys/+"            { capabilities = ["read"] }
path "pki-manager-ra/keys/+/import"     { capabilities = ["create", "update"] }
path "pki-manager-ra/sign/+/+"          { capabilities = ["update"] }

# Preflight: mount types and the token's own policies.
path "sys/internal/ui/mounts/+"         { capabilities = ["read"] }
path "auth/token/lookup-self"           { capabilities = ["read"] }
