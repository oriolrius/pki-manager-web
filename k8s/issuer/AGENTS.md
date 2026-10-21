# PKI Manager External Issuer - Codex Instructions

This is a standalone Go 1.23 controller-runtime module, not part of the TypeScript workspace.
It implements cert-manager `Issuer` and `ClusterIssuer` CRDs in
`pki-manager.issuer.io/v1alpha1` and asks the backend to sign CertificateRequests.

## Commands

Run all Go and Make commands from `k8s/issuer/`:

- `make build`, `make test`, `make fmt`, `make vet`, and `make tidy` are the normal checks.
- `make e2e-in-cluster` runs the full kind test stack.
- `make docker-build` creates the issuer image; the Helm chart is in `deploy/helm/pki-manager-issuer/`.

## Reconciliation Contract

Issuer reconciliation loads its token Secret, calls external `/health`, and reports readiness.
The token is scoped to a CA: a token CA ID mismatch must leave the issuer unready and must never
sign. CertificateRequests require cert-manager approval before signing. Signing is idempotent
through the request UID; optional delete finalization calls external `/revoke`.

`internal/issuer/signer/signer.go` owns the typed HTTP contract. It sends the cluster token as
Bearer auth and supports a pinned CA bundle. Keep backend and signer request/response behavior
in sync when changing the external API. CRD upgrades require separately applying the CRDs;
Helm upgrades intentionally do not upgrade them.
