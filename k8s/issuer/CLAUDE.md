# k8s/issuer — PKI Manager cert-manager External Issuer

Standalone **Go** controller-runtime project (its own module, not the TS backend) acting as
a [cert-manager external issuer](https://cert-manager.io/docs/configuration/external/). It
defines `Issuer`/`ClusterIssuer` CRDs and signs cert-manager `CertificateRequest`s by
calling the PKI Manager backend REST API. See the root `CLAUDE.md` for repo-wide rules.

## What it is

- Module `github.com/oriolrius/pki-manager-issuer`, Go 1.23. Deps: controller-runtime 0.20,
  cert-manager 1.16 APIs, k8s 0.32.
- CRDs in group `pki-manager.issuer.io/v1alpha1`: `Issuer` (namespaced) + `ClusterIssuer`
  (cluster-scoped), sharing `IssuerSpec`.
- `main.go` runs three reconcilers: `IssuerReconciler` for `Issuer` and for `ClusterIssuer`,
  plus `CertificateRequestReconciler` (handles only CRs with `issuerRef.group == pki-manager.issuer.io`).

`IssuerSpec`: `url` (PKI Manager base, `^https?://`), `caId` (CA UUID; must match the
token's bound CA), `authSecretRef` (key defaults to `token`), `caBundle?` (PEM for TLS),
`certificateType?` (`server|client|dual`, default `dual`), `revokeOnDelete?` (default false).
ClusterIssuer Secret namespace = `--cluster-resource-namespace`.

## Reconcile flow

- **Issuer**: load Secret → `GET /api/v1/external/health` → set `Ready` (`SecretMissing` /
  `Unreachable` / `CAIDMismatch` when `health.cluster.caId != spec.caId` / `Verified`).
  Requeue 5 min when Verified/CAIDMismatch, 30 s on SecretMissing/Unreachable.
- **CertificateRequest**: ignore non-matching group; **require cert-manager Approval** (1.16+)
  before signing; compute `durationDays` (default 90) + `certType`; `POST /sign`; write
  `Status.Certificate`/`Status.CA` + serial annotation; `revokeOnDelete` finalizer calls `/revoke`.

## Signer — `internal/issuer/signer/signer.go`

Typed `net/http` client; auth `Authorization: Bearer <token>`. Endpoints under `baseURL`:
`GET /api/v1/external/health` (readiness, returns `cluster.caId`), `POST /api/v1/external/sign`
(body `csrPem`, `requestUid`=CR UID idempotency key, `durationDays`, `certificateType`,
`k8sNamespace`, `k8sResource`), `POST /api/v1/external/revoke` (`serialNumber` + `reason`).
`/ca-bundle` is defined but unused. `WithCABundle()` pins TLS; default timeout 30 s. The
JSON contract here is read from the Go structs; the server side lives in the TS backend.

## Build / deploy (from `k8s/issuer/`)

| Command | Does |
|---|---|
| `make build` / `test` / `fmt` / `vet` / `tidy` | `go build`/`test`/… |
| `make docker-build` | `docker build -t $(IMG) .` (default `ghcr.io/oriolrius/pki-manager-issuer:dev`) |
| `make e2e-in-cluster` | full kind e2e (KMS + backend + issuer + cert-manager); see `test/e2e/in-cluster/README.md` |

`Dockerfile`: static `golang:1.23` build → distroless nonroot (UID 65532), binary `/manager`.
Install via Helm chart `deploy/helm/pki-manager-issuer/`:

```bash
helm upgrade --install pki-manager-issuer deploy/helm/pki-manager-issuer \
  -n pki-manager-issuer --create-namespace
```

Then create a `Secret` (key `token` = cluster token from the PKI Manager UI) and an
`Issuer`/`ClusterIssuer` (samples in `test/e2e/sample-*.yaml`; guide `docs/install.md`).

## Gotchas

- **Approval gate**: cert-manager 1.16+ won't sign until the CR is `Approved`; the default
  approver doesn't auto-approve external groups — grant approve RBAC on `signers.cert-manager.io`
  or approve manually (the e2e README patches CR status by hand).
- **Token ↔ CA binding**: token `caId` ≠ `spec.caId` → Issuer `Ready=False, CAIDMismatch`, never signs.
- **CRD upgrades**: editing `crds/issuers.yaml` needs manual `kubectl apply` — `helm upgrade` skips CRDs.
- Run all `go`/`make` commands from inside `k8s/issuer/` — it's its own module.
