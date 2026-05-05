# Security Notes

Threat model + hardening for the cert-manager external issuer.

## Threats

| Threat | Mitigation |
|--------|------------|
| Token theft from cluster Secret | RBAC: only controller SA + cluster-admins read Secret. Use `imagePullSecret`-style scoped Roles |
| MITM between controller and PKI Manager | Require HTTPS on PKI Manager; pin via `spec.caBundle` |
| Token reuse from different cluster | Token bound to single CA in PKI Manager; rate limit + last_seen audit |
| CA compromise blast radius | One token == one CA; create separate CAs per environment |
| Replay of CSR | `request_uid = CertificateRequest.UID` enforces idempotency, repeat = same cert |
| Unauthorized revoke | `/external/revoke` checks cert was issued by the calling cluster |

## Operational checklist

- [ ] PKI Manager `/api/v1/external/*` served over TLS only
- [ ] NetworkPolicy on controller namespace restricts egress to PKI Manager IP/CIDR + DNS
- [ ] Secret holding cluster token RBAC-scoped to controller SA
- [ ] `revokeOnDelete=true` only on Issuers where lifecycle warrants it
- [ ] PKI Manager audit log retained ≥ 90d (every sign + revoke logged with cluster id, request UID, subject CN, serial)
- [ ] Rotate cluster tokens periodically (revoke old, register new, update Secret)
- [ ] Scan controller image (cosign verify, syft SBOM)

## Standards alignment

- CIS Kubernetes Benchmark: non-root, distroless, readOnlyRootFilesystem, drop ALL capabilities
- OWASP K8s Top 10: K01 (insecure workload config) addressed via securityContext defaults; K07 (network segmentation) via optional NetworkPolicy template
- RFC 5280: cert chain returned from `/sign` includes issuing CA in `chainPem`
