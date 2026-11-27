# Migration identity of scripts/migration/pki-migrate.ts (offline v3 -> OpenBao).
# A token with this policy only, no `default`, short TTL; revoke it after the run
# (openbao/scripts/bootstrap.sh migration-setup | migration-token | migration-revoke).
# Mount paths are the backend defaults; bootstrap.sh rewrites them when OPENBAO_*_MOUNT differ.
#
# It can read each mount's wrapping key, import keys (create only: the import path
# refuses an existing name), read key policies and sign a fresh challenge.
# Import parameters are closed (allowed_parameters): SSH and RA keys can only be
# imported non-exportable, no key with plaintext backup or rotation, fixed types.
# Denied by omission: export, backup, config, delete, rotate, decrypt, the RA
# session-key operation (RA unwrap checks use the runtime RA identity), the Raft
# snapshot (backups use an operator token), sys/* writes.
#
# The challenge needs `sign`, and Transit cannot scope it to the imported names: the
# token can sign with any key of these mounts while it lives. Keep its TTL short.

path "pki-manager/wrapping_key"         { capabilities = ["read"] }
path "pki-manager/keys/+"               { capabilities = ["read"] }
path "pki-manager/keys/+/import" {
  capabilities       = ["create", "update"]
  allowed_parameters = {
    "ciphertext"             = []
    "hash_function"          = ["SHA256"]
    "type"                   = ["rsa-2048", "rsa-3072", "rsa-4096", "ecdsa-p256", "ecdsa-p384"]
    "exportable"             = []
    "allow_plaintext_backup" = [false]
    "allow_rotation"         = [false]
  }
}
path "pki-manager/sign/+/+"             { capabilities = ["update"] }

path "pki-manager-ssh/wrapping_key"     { capabilities = ["read"] }
path "pki-manager-ssh/keys/+"           { capabilities = ["read"] }
path "pki-manager-ssh/keys/+/import" {
  capabilities       = ["create", "update"]
  allowed_parameters = {
    "ciphertext"             = []
    "hash_function"          = ["SHA256"]
    "type"                   = ["ecdsa-p256"]
    "exportable"             = [false]
    "allow_plaintext_backup" = [false]
    "allow_rotation"         = [false]
  }
}
path "pki-manager-ssh/sign/+/sha2-256"  { capabilities = ["update"] }

path "pki-manager-ra/wrapping_key"      { capabilities = ["read"] }
path "pki-manager-ra/keys/+"            { capabilities = ["read"] }
path "pki-manager-ra/keys/+/import" {
  capabilities       = ["create", "update"]
  allowed_parameters = {
    "ciphertext"                 = []
    "hash_function"              = ["SHA256"]
    "type"                       = ["rsa-3072"]
    "exportable"                 = [false]
    "allow_plaintext_backup"     = [false]
    "allow_rotation"             = [false]
    "allow_pkcs1v15_session_key" = [true]
  }
}
path "pki-manager-ra/sign/+/sha2-256"   { capabilities = ["update"] }

# Preflight: mount types and the token's own policies.
path "sys/internal/ui/mounts/+"         { capabilities = ["read"] }
path "auth/token/lookup-self"           { capabilities = ["read"] }
