# Integration API reference

This foundation exposes two backend interfaces:

| Interface | Base | Authentication |
| --- | --- | --- |
| Integration management | `/trpc/integration.*` on the backend | OIDC user JWT, when configured; registration and revocation require admin |
| X.509 external issuer | `/api/v1/external` on the backend | CA-bound integration service token (`pkimg_...`), always required |

The backend Swagger UI is `/api/docs`; its generated JSON and YAML are
`/api/v1/openapi.json` and `/api/v1/openapi.yaml`. Select **integrationToken**
in Swagger for external-issuer requests; **bearerAuth** is the management OIDC JWT.
The optional SCEP gateway and its device protocol live in [`scep/`](../../scep/).

## Create and manage a service identity

In the UI, use **Operations → Integrations → Add Integration**. Choose an active
issuing CA and `kubernetes`, `scep`, or `generic`. For SCEP, create a dedicated
`scep` integration. Save its service token when it is displayed: it is not
returned by later list/detail calls. Configure it only on the gateway, never on
enrolling devices. A SCEP challenge, an integration token and an OIDC JWT are
different credentials and are not interchangeable.

Management is tRPC, not an additional REST `/integrations` resource:

| Procedure | Method | Input | Result |
| --- | --- | --- | --- |
| `integration.list` | GET | none | Array of integration identities and `certificatesCount` |
| `integration.getById` | GET | `{ "id": "INTEGRATION_ID" }` | Integration identity, usage and certificate count |
| `integration.register` | POST | `name`, `caId`, optional `description`, `kind` (default `generic`) | Identity, type and plaintext `token`, shown once |
| `integration.revoke` | POST | `{ "id": "INTEGRATION_ID" }` | `id`, `revokedAt`; the token stops authenticating |

For example, against the backend origin (without `/api/v1`):

```sh
curl -X POST "$BACKEND/trpc/integration.register" \
  -H "Authorization: Bearer $OIDC_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"scep-mdm","caId":"CA_ID","kind":"scep"}'

curl "$BACKEND/trpc/integration.list" \
  -H "Authorization: Bearer $OIDC_TOKEN"
```

tRPC wraps successful results in `result.data` and failures in `error`.
Legacy `cluster.*` procedures remain compatible; new registrations through that
adapter are Kubernetes identities and retain `k8sCertificatesCount` in responses.
The old `/clusters` page redirects to `/integrations`.

## External issuer endpoints

Every request uses `Authorization: Bearer <service-token>`. This remains required
when management OIDC is disabled. A token is scoped to its integration and bound CA.

| Method | Path relative to `/api/v1` | Behavior |
| --- | --- | --- |
| GET | `/external/health` | `status`, `integration` (`id`, `name`, `caId`, `kind`), timestamp; legacy `cluster` compatibility identity |
| GET | `/external/ca-bundle` | `caId`, `subjectDn`, `certificatePem`, `chainPem`; rejects inactive/expired CA |
| GET | `/external/certificate-status/{serial}` | `{ "active": true/false }`; checks certificate validity/revocation and CA/integration ownership |
| POST | `/external/sign` | Sign a CSR with the bound CA; idempotent within integration and CA |
| POST | `/external/revoke` | Revoke an owned certificate and publish the CA CRL; retries are idempotent |

`sign` answers `503 KEY_STORE_UNAVAILABLE` with a `Retry-After` header while OpenBao is sealed
or not reachable. It stores no certificate then: retry with the same `requestUid` (see
[Key store errors](index.md#key-store-errors)).

`sign` requires `csrPem` and `requestUid`. Optional `durationDays` defaults to 90
and must be 1–825 (other values return `400`). `certificateType` is a display hint (`server`, `client`,
`dual`), not a substitute for the CSR's key usage/EKU. Subject and SANs come from
the signed CSR; compatibility body fields `sanDns`/`sanIp` are ignored.
`csrPem` is at most 65536 characters and `requestUid` at most 256. The optional `k8sNamespace`
and `k8sResource` name the Kubernetes object that asked; they are stored only for an
integration of kind `kubernetes`.

The signing response contains `idempotent`, `id`, `serialNumber`, `certificatePem`,
`chainPem`, `notBefore`, and `notAfter`. Reusing an ID whose certificate is revoked
or expired returns 409; submit a new CSR/request ID. SCEP uses a deterministic
`scep:` ID derived from the CSR hash. Certificates belong to `integrationId`, with
sources `k8s`, `scep`, or `integration` according to the identity type.

Revocation accepts `serialNumber` and optional `reason` (default
`unspecified`). It returns the certificate ID, serial, `status: revoked`
and revocation date; an already-revoked result also has `idempotent: true`.
A different integration cannot revoke or establish renewal ownership of the
certificate, even if it uses the same issuing CA.

Expect 400 for invalid requests, 401 for invalid/revoked service tokens, 403 for
revoking another identity's certificate, 404 for missing resources, and 409 for
CA/certificate state conflicts. Key store (OpenBao) or CRL failures can return 500. Successful
certificate-status lookup of a missing or differently owned serial returns
`active: false`, rather than revealing another integration's certificate.

## Backend issuance policy and failure auditing

The external issuer accepts only SAN, keyUsage, extendedKeyUsage and
basicConstraints CSR extensions. Duplicate or unknown extensions (including
CDP, AIA and nameConstraints), CA:true, path length, keyCertSign and cRLSign are
rejected before the certificate is built and signed. The backend adds its configured CRL distribution
point itself. Accepted keys are RSA 2048–8192 bits and ECDSA P-256 or P-384; the CSR signature is verified for both. The CSR must carry a subject CN or at least one SAN: an empty subject is accepted when a SAN is present (RFC 5280), a CSR with neither is rejected with `INVALID_CSR`. CSRs and request IDs are bounded.

SCEP integrations require exactly the clientAuth EKU and at most 90 days validity.
This applies to direct API callers as well as gateway requests; a certificateType
metadata hint cannot override the CSR profile. CA validity is checked before
returning an idempotent issuance result. Requests rejected with HTTP 4xx/5xx
produce `external.reject` audit rows with route/status and known integration
identity, without tokens or raw CSR/challenge bodies. Audit-storage failures
are separately logged; response delivery and the on-response audit insert are
not one database transaction.

Repeated revocation reuses the current unexpired CA CRL if it already contains
the serial. If publication previously failed, or that CRL expired, publication
is retried. This avoids regenerating CRLs on successful sequential retries;
concurrent publication still needs coordination across backend replicas.

### Backend-owned SCEP RA

Only an active `scep` integration can call `/api/v1/external/ra/state`,
`ra/provision`, `ra/renew`, `ra/sign`, and `ra/decrypt`. Provision/renew take an
empty JSON object. Sign accepts only a base64 SHA-256 `digest`; decrypt accepts
only a base64 RSA-3072 `data` ciphertext and the required `sessionKeyLength`, and
returns the CMS content-encryption key. The
backend fixes algorithms and resolves its RA key from the integration and bound
CA. Caller-selected key identifiers are rejected. State contains public
certificates only. The RA private key is a non-exportable RSA-3072 key in an OpenBao
Transit mount of the PKI Manager build of OpenBao. Gateways need no OpenBao connectivity or
credentials. The audit rows of these calls record the `provider` of the binding (`openbao`).

A binding whose RA key is still in Cosmian KMS (made by a version before the OpenBao cutover) is
refused with `409` and the code `RA_KEY_MIGRATION_REQUIRED` until the OpenBao key migration moves
its key. A backend with no OpenBao RA configuration answers `503`.

#### RA decrypt: CMS session key length

`POST /api/v1/external/ra/decrypt` body:

| Field | Required | Value |
| --- | --- | --- |
| `data` | yes | base64 RSA-3072 PKCS#1 v1.5 ciphertext of the CMS session key (384 bytes) |
| `sessionKeyLength` | yes | the JSON integer `16`, `24` or `32` |

The SCEP gateway reads the content cipher of each device envelope after it checks
the CMS signature, and sends the key length of that cipher:

| Envelope content cipher | `sessionKeyLength` |
| --- | --- |
| AES-128-CBC, AES-128-GCM | `16` |
| DES-EDE3-CBC (3DES) | `24` |
| AES-256-CBC, AES-256-GCM | `32` |

The gateway refuses every other content cipher (for example DES-CBC or
AES-192) with a signed `CertRep` failure (`badAlg`), and it sends no RA request
for it. Its startup self-test sends `32`.

- With `sessionKeyLength`, the unwrapped key must have exactly that length.
- The field is required: without it the backend answers `400` and sends no OpenBao request.
  Gateways older than the `sessionKeyLength` change do not send it, so they cannot decrypt
  against this backend.
- The field takes only a JSON integer. A string such as `"16"`, another number,
  `null` or an unknown field gives `400 BAD_REQUEST` before the audit row and
  before any OpenBao request.
- An OpenBao unwrap error and a key of the wrong length give the same response:
  `502` with `{"error":{"code":"RA_OPERATION_FAILED","message":"RA decryption failed"}}`.
  The audit row records only the phase, the status code and the error code, never
  the ciphertext, the key or its length.

The backend sends the length to the session-key operation of the OpenBao fork, which returns a
key of exactly that length, and checks the length again.

**Upgrade: backend and gateway together.** A backend older than the `sessionKeyLength` change
rejects the field with `400`, so a new gateway against an old backend fails its startup self-test
and does not start. A gateway older than that change does not send the field, and this backend
refuses its decrypt calls with `400`. Upgrade the backend and the SCEP gateway of the same
release in one step, and roll them back together.

RA operations check integration/CA ownership and active status on every request.
Revoked RA certificates cannot sign, decrypt, or renew. Integration revocation
cannot revoke RA certificates. Audit intent must persist before any RA operation;
audit storage failure prevents OpenBao access. Lease-backed provisioning and renewal
coordinate replicas. Failed first provisioning retains a 15-minute lease. After
expiry, provision reuses recorded key IDs and resumes activation/issuance. If no
IDs were recorded, it retries allocation; an ambiguous lost OpenBao response can leave
an orphan Transit key, so reconcile the integration audit trail and the Transit keys. Renewals retain the key and public overlap
certificates. Backend migration 0011 adds this binding and lease state;
back up the database before upgrading and restore the full pre-upgrade backup
with the corresponding old images to roll back. Do not drop binding rows to
retry provisioning without reconciling the Transit keys first.

Same-key RA renewal requires a fresh certificate serial. The backend builds each RA certificate
with a new random serial; if a serial equals the previous one, it rejects the renewal and keeps
the previous binding.

RA certificates carry digitalSignature/keyEncipherment with no EKU; the clientAuth
requirement applies only to enrolled device CSRs. Anonymous rejection auditing is
capped at one row per IP per minute and 60 rows globally per minute per backend
process. Source keys expire each minute, preventing unbounded in-memory growth.
Error codes distinguish malformed CSRs from profile rejections. Already-audited
RA failures are excluded from the generic rejection hook. Authentication runs
before body validation, so anonymous selector overrides receive 401. Configure
trusted proxy handling carefully: the limiter uses Fastify's resolved request IP.
