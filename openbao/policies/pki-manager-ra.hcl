# Runtime policy of the PKI Manager backend on the SCEP RA mount (OPENBAO_RA_MOUNT).
# Same rules as scep/README.md "RA key in OpenBao": create and read RA keys, sign
# pre-hashed SHA-256, recover CMS session keys (fork operation). Key configuration,
# rotate, trim, export, backup, decrypt and deletion stay denied.

path "pki-manager-ra/keys/+" {
  capabilities = ["create", "update", "read"]
}
path "pki-manager-ra/sign/+/sha2-256" {
  capabilities = ["update"]
}
path "pki-manager-ra/session-key/pkcs1v15/+" {
  capabilities = ["update"]
}
