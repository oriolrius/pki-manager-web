# pki-manager-issuer

cert-manager external issuer for [PKI Manager](../..). It reconciles `cert-manager.io/CertificateRequest`
resources whose `issuerRef.group=pki-manager.issuer.io`: it sends the CSR to the PKI Manager external API and
writes the signed certificate back to the request.

Architecture follows [`cert-manager/sample-external-issuer`](https://github.com/cert-manager/sample-external-issuer).

**To install and use the issuer**, read the guide
[Issue Kubernetes certificates with cert-manager](../../docs/guides/kubernetes.md). It has the fields of
`Issuer` and `ClusterIssuer`, the Helm values and the troubleshooting table. The API that the issuer calls is
the [Integration API](../../docs/api/integrations.md). This README is for people who change the issuer.

## Develop

```
make build       # compile
make test        # unit tests
make fmt vet     # tidy + lint
make tidy        # go mod tidy
```

Run every `go` and `make` command inside `k8s/issuer/`: it is its own Go module.

## Helm chart

The chart is in `deploy/helm/pki-manager-issuer/`. CRDs ship under `crds/`: Helm installs them, but does not
upgrade them (the Helm CRD convention). After a change to a CRD, apply it with `kubectl apply`.

The controller reads the token `Secret` in this namespace:

- `Issuer`: the namespace of the Issuer.
- `ClusterIssuer`: the `--cluster-resource-namespace` flag (default: the namespace of the controller pod).

## Local kind-based E2E

Pre-reqs on host: `kind`, `kubectl`, `helm`, `docker`, running PKI Manager backend reachable from within kind.

```
make e2e-local
# follow printed steps to apply sample-clusterissuer.yaml + sample-certificate.yaml
```

## Security

Threats and an operational checklist: [docs/security.md](docs/security.md).

## Reference

- [sample-external-issuer](https://github.com/cert-manager/sample-external-issuer)
- [cert-manager external issuers](https://cert-manager.io/docs/configuration/external/)
- [kubebuilder book](https://book.kubebuilder.io/)
