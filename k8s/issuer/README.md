# pki-manager-issuer

cert-manager external issuer for [PKI Manager](../..). Reconciles `cert-manager.io/CertificateRequest` resources whose `issuerRef.group=pki-manager.issuer.io` by submitting the CSR to the PKI Manager external API and writing the signed certificate back to the request.

Architecture follows [`cert-manager/sample-external-issuer`](https://github.com/cert-manager/sample-external-issuer).

## CRDs

- `Issuer` (namespaced)
- `ClusterIssuer` (cluster-scoped)

Both share `IssuerSpec`:

| Field | Required | Description |
|-------|----------|-------------|
| `url` | yes | PKI Manager base URL |
| `caId` | yes | UUID of the CA to issue from (matches token's bound CA) |
| `authSecretRef` | yes | Secret holding `token` key (or `key` override) |
| `caBundle` | no | PEM CA bundle used to verify TLS to PKI Manager |
| `certificateType` | no | `server` / `client` / `dual` (default `dual`) |
| `revokeOnDelete` | no | Add finalizer to revoke when CR is deleted (default `false`) |

`Secret` lookup namespace:
- `Issuer`: same namespace as Issuer
- `ClusterIssuer`: `--cluster-resource-namespace` flag (default = controller pod namespace)

## Develop

```
make build       # compile
make test        # unit tests
make fmt vet     # tidy + lint
make tidy        # go mod tidy
```

## Deploy via Helm

```
helm upgrade --install pki-manager-issuer deploy/helm/pki-manager-issuer \
  --namespace pki-manager-issuer --create-namespace
```

CRDs ship under `deploy/helm/pki-manager-issuer/crds/` — Helm installs (but does not upgrade) them per the Helm CRD convention.

## Local kind-based E2E

Pre-reqs on host: `kind`, `kubectl`, `helm`, `docker`, running PKI Manager backend reachable from within kind.

```
make e2e-local
# follow printed steps to apply sample-clusterissuer.yaml + sample-certificate.yaml
```

## Reference

- [sample-external-issuer](https://github.com/cert-manager/sample-external-issuer)
- [cert-manager external issuers](https://cert-manager.io/docs/configuration/external/)
- [kubebuilder book](https://book.kubebuilder.io/)
