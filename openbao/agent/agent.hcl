# OpenBao Agent for the PKI Manager backend X.509 and SSH keys (Compose service
# `openbao-agent`; load it after common.hcl). It logs in with the AppRole
# `pki-manager-backend` (policy pki-manager-backend only), renews the token, logs in again
# when the token reaches its max TTL, and writes the token to the file the backend reads
# on every call (OPENBAO_TOKEN_FILE). The backend never holds the AppRole credentials.
# SCEP RA keys use another Agent and AppRole: agent-ra.hcl. Guide: docs/operations/openbao.md

pid_file = "/tmp/openbao-agent.pid"

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    config = {
      role_id_file_path   = "/openbao/approle/role-id"
      secret_id_file_path = "/openbao/approle/secret-id"
      # Keep the secret-id so the Agent can log in again after a restart. The files are
      # read-only for the Agent user and never mounted into the backend.
      remove_secret_id_file_after_reading = false
    }
  }

  sink "file" {
    config = {
      path = "/openbao/token/backend-token"
      mode = 0400
    }
  }
}
