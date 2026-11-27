# OpenBao server for PKI Manager: one node, integrated (Raft) storage, TLS, file audit.
# The same file serves the dev stack, the test stacks and the Compose deployment.
# Production differences live outside it: real TLS certificates, Shamir key holders,
# AppRole + OpenBao Agent for the backend. Guide: docs/operations/openbao.md
#
# Mounted read-only at /openbao/config. Paths below are inside the container.

ui = false

# Integrated storage cannot use mlock safely; containers also lack IPC_LOCK by default.
disable_mlock = true

listener "tcp" {
  address         = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  tls_cert_file   = "/openbao/tls/server.pem"
  tls_key_file    = "/openbao/tls/server-key.pem"
  tls_min_version = "tls12"
}

storage "raft" {
  path    = "/openbao/data"
  node_id = "openbao-1"
}

# Override with BAO_API_ADDR / BAO_CLUSTER_ADDR when the service name differs.
api_addr     = "https://openbao:8200"
cluster_addr = "https://openbao:8201"

# Every request and response, with secret values HMAC-ed. Declarative, so the backend
# token never needs sys/audit. Rotate the file with logrotate + SIGHUP.
audit "file" "file" {
  description = "PKI Manager audit log"
  options {
    file_path = "/openbao/logs/audit.log"
    mode      = "0600"
  }
}
