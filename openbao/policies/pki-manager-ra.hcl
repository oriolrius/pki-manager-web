# Runtime policy of the SCEP RA credential (AppRole and token role pki-manager-ra) on the
# RA mount (OPENBAO_RA_MOUNT). Only the backend RA client uses this token
# (OPENBAO_RA_TOKEN_FILE). Same rules as scep/README.md "RA key in OpenBao": create and
# read RA keys, sign pre-hashed SHA-256, recover CMS session keys (fork operation).
#
# Denied by omission: every path of the X.509 and SSH mounts (the backend token,
# policy pki-manager-backend, has those and nothing here), key configuration, rotate,
# trim, export, backup, decrypt, import, deletion, sys/*, auth/* except renew-self.
# Never attach it together with pki-manager-backend: one token for both would let an
# X.509/SSH caller recover SCEP session keys.

path "pki-manager-ra/keys/+" {
  capabilities = ["create", "update", "read"]
}
path "pki-manager-ra/sign/+/sha2-256" {
  capabilities = ["update"]
}
path "pki-manager-ra/session-key/pkcs1v15/+" {
  capabilities = ["update"]
}

# The RA Agent renews only the token obtained from its own AppRole login.
path "auth/token/renew-self" {
  capabilities = ["update"]
}
