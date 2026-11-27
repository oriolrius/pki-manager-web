# OpenBao Agent for the SCEP RA keys (Compose service `openbao-agent-ra`, profile `scep`;
# load it after common.hcl). It logs in with the AppRole `pki-manager-ra` (policy
# pki-manager-ra only: the RA mount, no X.509 or SSH path), renews the token, logs in
# again at its max TTL, and writes the token to the file that only the backend RA client
# reads (OPENBAO_RA_TOKEN_FILE). Installations without SCEP do not run it.
# Guide: docs/operations/openbao.md

pid_file = "/tmp/openbao-agent-ra.pid"

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    config = {
      role_id_file_path   = "/openbao/approle-ra/role-id"
      secret_id_file_path = "/openbao/approle-ra/secret-id"
      remove_secret_id_file_after_reading = false
    }
  }

  sink "file" {
    config = {
      path = "/openbao/token-ra/ra-token"
      mode = 0400
    }
  }
}
