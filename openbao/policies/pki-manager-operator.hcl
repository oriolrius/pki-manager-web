# Operator policy for `bootstrap.sh configure` once the root token is revoked:
# manage the PKI Manager mounts, policies, AppRole role and token roles, issue and revoke
# migration tokens, read status.
# It cannot read or use keys (no paths under the mounts themselves).

path "sys/mounts/pki-manager" { capabilities = ["create", "read", "update"] }
path "sys/mounts/pki-manager-ssh" { capabilities = ["create", "read", "update"] }
path "sys/mounts/pki-manager-ra" { capabilities = ["create", "read", "update"] }
path "sys/mounts" { capabilities = ["read"] }
path "sys/auth/approle" { capabilities = ["create", "read", "update", "sudo"] }
path "sys/auth" { capabilities = ["read"] }
path "sys/policies/acl/pki-manager-*" { capabilities = ["create", "read", "update", "list"] }
path "auth/approle/role/pki-manager-backend" { capabilities = ["create", "read", "update"] }
path "auth/approle/role/pki-manager-backend/role-id" { capabilities = ["read"] }
path "auth/approle/role/pki-manager-backend/secret-id" { capabilities = ["update"] }
path "auth/approle/role/pki-manager-backend/secret-id/lookup" { capabilities = ["update"] }
path "auth/approle/role/pki-manager-backend/secret-id-accessor/destroy" { capabilities = ["update"] }
path "auth/token/roles/pki-manager-backend" { capabilities = ["create", "read", "update"] }
# Migration window (`bootstrap.sh migration-token` / `migration-revoke`): issue tokens from
# the migration token role only, and revoke a token by accessor. The role fixes the
# policy (pki-manager-migration), the 8h ceiling and "not renewable".
path "auth/token/roles/pki-manager-migration" { capabilities = ["create", "read", "update"] }
path "auth/token/create/pki-manager-migration" { capabilities = ["update"] }
path "auth/token/lookup-accessor" { capabilities = ["update"] }
path "auth/token/revoke-accessor" { capabilities = ["update"] }
path "sys/health" { capabilities = ["read", "sudo"] }
path "sys/seal-status" { capabilities = ["read"] }
path "sys/storage/raft/snapshot" { capabilities = ["read"] }
