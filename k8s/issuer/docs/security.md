# Security Notes

Threat model + hardening for the cert-manager external issuer.

## Threats

| Threat | Mitigation |
|--------|------------|
| Token theft from the Kubernetes Secret | RBAC: only the controller ServiceAccount and cluster admins can read the Secret |
| MITM between controller and PKI Manager | Require HTTPS on PKI Manager; pin via `spec.caBundle` |
| Token reuse from another cluster | The token is bound to one CA in PKI Manager; its last use is recorded, and you can revoke it at any time |
| CA compromise blast radius | One token == one CA; create separate CAs per environment |
| Replay of CSR | `request_uid = CertificateRequest.UID` enforces idempotency, repeat = same cert |
| Unauthorized revoke | `/external/revoke` checks that the calling integration issued the certificate |

## Operational checklist

- [ ] PKI Manager `/api/v1/external/*` served over TLS only
- [ ] NetworkPolicy on controller namespace restricts egress to PKI Manager IP/CIDR + DNS
- [ ] Secret holding the integration token RBAC-scoped to controller SA
- [ ] `revokeOnDelete=true` only on Issuers where lifecycle warrants it
- [ ] PKI Manager audit log retained ≥ 90d (every sign + revoke logged with the integration, request UID, subject CN, serial)
- [ ] Rotate integration tokens periodically (create a new integration, update the Secret, revoke the old integration)
- [ ] Scan controller image (cosign verify, syft SBOM)

## Standards alignment

- CIS Kubernetes Benchmark: non-root, distroless, readOnlyRootFilesystem, drop ALL capabilities
- OWASP K8s Top 10: K01 (insecure workload config) addressed via securityContext defaults; K07 (network segmentation) via optional NetworkPolicy template
- RFC 5280: cert chain returned from `/sign` includes issuing CA in `chainPem`
