# Integrations and SCEP API reference

There are three separate interfaces and credentials:

| Interface | Base | Authentication |
| --- | --- | --- |
| Integration management | `/trpc/integration.*` on the backend | OIDC user JWT, when configured; registration and revocation require admin |
| X.509 external issuer | `/api/v1/external` on the backend | CA-bound integration service token (`pkimg_...`), always required |
| SCEP enrollment | `/scep` on the separate gateway | Encrypted CSR challenge; shared, Intune, or MDM webhook validation |

The backend Swagger UI is `/api/docs`; its generated JSON and YAML are
`/api/v1/openapi.json` and `/api/v1/openapi.yaml`. Select **integrationToken**
in Swagger for external-issuer requests; **bearerAuth** is the management OIDC JWT.
The gateway has a separate [OpenAPI specification](../../scep/openapi.yaml).
Do not resolve gateway URLs against the backend's `/api/v1` base.

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

`sign` requires `csrPem` and `requestUid`. Optional `durationDays` defaults to 90
and is clamped to 1–825. `certificateType` is a display hint (`server`, `client`,
`dual`), not a substitute for the CSR's key usage/EKU. Subject and SANs come from
the signed CSR; compatibility body fields `sanDns`/`sanIp` are ignored.

The signing response contains `idempotent`, `id`, `serialNumber`, `certificatePem`,
`chainPem`, `notBefore`, and `notAfter`. Reusing an ID whose certificate is revoked
or expired returns 409; submit a new CSR/request ID. SCEP uses a deterministic
`scep:` ID derived from the CSR hash. Certificates belong to `integrationId`, with
sources `k8s`, `scep`, or `integration` according to the identity type.

Revocation accepts `serialNumber` and optional `reason` (default
`cessationOfOperation`). It returns the certificate ID, serial, `status: revoked`
and revocation date; an already-revoked result also has `idempotent: true`.
A different integration cannot revoke or establish renewal ownership of the
certificate, even if it uses the same issuing CA.

Expect 400 for invalid requests, 401 for invalid/revoked service tokens, 403 for
revoking another identity's certificate, 404 for missing resources, and 409 for
CA/certificate state conflicts. KMS/CRL failures can return 500. Successful
certificate-status lookup of a missing or differently owned serial returns
`active: false`, rather than revealing another integration's certificate.

## SCEP gateway

The [gateway setup](../../scep/README.md) documents provisioning, secrets,
Intune/webhook configuration and supported certificate profiles. `/scep` supports
GET `GetCACaps`, GET `GetCACert` and GET/POST `PKIOperation`. HTTP 200 alone does
not establish enrollment success: decode the signed/encrypted SCEP `CertRep` and
check its `pkiStatus`. Shared mode rejects SAN requests; managed modes require
validation of the exact CSR and support the SAN types listed in the gateway docs.
Renewal additionally checks that the old signer is active and owned by the same
integration. Live Intune tenant/device interoperability is a separate deployment
acceptance check.
