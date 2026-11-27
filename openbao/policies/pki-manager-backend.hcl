# Runtime policy of the PKI Manager backend on its X.509 and SSH mounts. Attach it with pki-manager-ra; never with `default` or root.
#
# `+` matches one path segment, so `keys/<name>/config` is only reachable through the
# rule below, which accepts `deletion_allowed` and nothing else: the backend cannot turn
# on `exportable` or `allow_plaintext_backup`, which are irreversible.
#
# Denied by omission: wrapping_key, keys/<name>/import and import_version (only the
# migration token, policy pki-manager-migration, imports keys), backup/, restore/,
# rotate, trim, decrypt/, encrypt/, rewrap/, random/, sys/*, auth/*.
# The mount path is the backend OPENBAO_TRANSIT_MOUNT value.

# Create (generate) and read keys; delete a key whose deletion was allowed first.
path "pki-manager/keys/+" {
  capabilities = ["create", "update", "read", "delete"]
}

# Allow deletion, nothing else, before a delete. `[]` = any value of this one
# parameter (OpenBao compares listed values as strings, and JSON `true` is a boolean);
# every other parameter of keys/<name>/config is refused.
path "pki-manager/keys/+/config" {
  capabilities       = ["update"]
  allowed_parameters = {
    "deletion_allowed" = []
  }
}

# Sign: sign/<name> and sign/<name>/<hash>.
path "pki-manager/sign/+" {
  capabilities = ["update"]
}
path "pki-manager/sign/+/+" {
  capabilities = ["update"]
}

# Export a private key for PKCS#12/JKS/PEM downloads. OpenBao refuses it for keys
# created with exportable=false (CA keys unless ALLOW_CA_KEY_EXPORT, SSH CA keys).
path "pki-manager/export/signing-key/+" {
  capabilities = ["read"]
}
path "pki-manager/export/signing-key/+/+" {
  capabilities = ["read"]
}


# The SSH CA uses a version-pinned P-256 key and signs with SHA-256.
path "pki-manager-ssh/keys/+" {
  capabilities = ["create", "read", "update"]
}
path "pki-manager-ssh/sign/+/sha2-256" {
  capabilities = ["update"]
}

# The Agent renews only the token obtained from its own AppRole login.
path "auth/token/renew-self" {
  capabilities = ["update"]
}
