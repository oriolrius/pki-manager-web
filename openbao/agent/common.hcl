# Settings shared by the two OpenBao Agents of PKI Manager (production path; Compose
# services `openbao-agent` and `openbao-agent-ra`). Each Agent loads this file and its
# own file: `-config=common.hcl -config=agent.hcl` (X.509 + SSH) or
# `-config=common.hcl -config=agent-ra.hcl` (SCEP RA). Guide: docs/operations/openbao.md

vault {
  address = "https://openbao:8200"
  ca_cert = "/openbao/tls/ca.pem"
}
