# Operator policy for `bootstrap.sh configure` once the root token is revoked:
# manage the PKI Manager mounts, policies, AppRole role and token role, read status.
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
path "auth/token/roles/pki-manager-backend" { capabilities = ["create", "read", "update"] }
path "sys/health" { capabilities = ["read", "sudo"] }
path "sys/seal-status" { capabilities = ["read"] }
path "sys/storage/raft/snapshot" { capabilities = ["read"] }
