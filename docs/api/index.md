# REST API

- **[Call the API](how-to.md)**: credentials and working `curl` examples (they run in CI).
- **[Endpoints](https://pki-manager.oriolrius.cat/api/reference/)**: every operation and
  field, generated from the source code of the documented version.
- **[Integration API](integrations.md)**: service identities, tokens and the external issuer endpoints.

Every PKI Manager instance also serves its own API description. Replace `https://pki.example.com`
with the URL of your instance.

| What | Path |
|---|---|
| Swagger UI (try requests in the browser) | `/api/docs` |
| OpenAPI document, JSON | `/api/v1/openapi.json` |
| OpenAPI document, YAML | `/api/v1/openapi.yaml` |

```bash
curl -s https://pki.example.com/api/v1/openapi.json | jq '.info.title, (.paths | length)'
```

`info.version` of the OpenAPI document is the PKI Manager release version (for example `3.17.0`).
`info.license` is `Apache-2.0`, with its SPDX identifier. `GET /api/v1/health` also returns the
release version in its `version` field.

## API surfaces

- **`/api/v1`**: management REST API. Authenticate with an OIDC access token (`Authorization: Bearer <jwt>`),
  see [OIDC login](../operations/oidc.md).
- **`/api/v1/external`**: machine endpoints for integrations (the cert-manager issuer, SCEP, automation),
  authenticated with an integration token. See [Integration API](integrations.md).
- **SSH automation endpoints** use fleet tokens (`pkimg_…`). See the
  [SSH API contract](../ssh/api-contract.md).
- **`/trpc`**: the typed API used by the web UI. It is internal and can change between versions; use REST for scripts.

## Endpoints that need no credentials

These paths are public on purpose. Clients and hosts must reach them to check certificates.

| Path | What it serves |
|---|---|
| `/health`, `/api/v1/health` | Liveness of the backend |
| `/api/docs`, `/api/v1/openapi.json`, `/api/v1/openapi.yaml` | The API description |
| `/cas/<caId>.pem` (also `.crt`, `.der`, `.cer`) | A CA certificate |
| `/crl/<caId>.crl` (PEM), `/crl/<caId>.der` | The CRL of a CA |
| `/ssh/...`, `/krl/...` | SSH trust files and KRLs, see the [SSH API contract](../ssh/api-contract.md#public-download-endpoints-no-auth) |

## Key store errors

X.509 operations that use a private key (CA and certificate creation, renewal, CRL generation,
key downloads) need OpenBao. When OpenBao cannot serve them, or an object is not in it, the REST
API and the external API answer with one of these codes. The body is the usual
`{ "error": { "code", "message" } }`, with a fixed message and no OpenBao detail.

| HTTP | `error.code` | Meaning | What the client does |
|---|---|---|---|
| 503 | `KEY_STORE_UNAVAILABLE` | OpenBao is sealed, not initialised, not reachable, or refuses the backend token | Retry after the `Retry-After` header (30 seconds) |
| 409 | `KEY_MIGRATION_REQUIRED` | The key or certificate of this object is still a Cosmian KMS id | An operator runs the [key migration](../operations/openbao-migration.md) |
| 409 | `KEY_STATE_CONFLICT` | The key is revoked, destroyed or was never completed | Do not retry the same request |
| 403 | `KEY_NOT_EXPORTABLE` | The private key was created non-exportable | The key cannot be downloaded |
| 403 | `KEY_EXPORT_DENIED` | OpenBao refused the export (key policy or token policy) | An operator checks the key and the token policy |

The tRPC API returns the same cases as `SERVICE_UNAVAILABLE` (with `Retry-After`), `CONFLICT` and
`FORBIDDEN`, and the code above in `error.data.appCode`.

A create request that got `503` made no CA and no certificate: send it again after the wait. Bulk issue, revoke,
renew and delete report the message in the result of each row. A bulk download fails as a whole
with `503`.

`/health` and `/api/v1/health` stay liveness checks: they answer `200` while OpenBao is sealed.
The reason for a `503` is in the operator diagnostics:

```bash
curl -s https://pki.example.com/api/v1/diagnostics/key-store -H "Authorization: Bearer $ADMIN_TOKEN"
# {"provider":"openbao","configured":true,"state":"sealed","checkedAt":"..."}
```

`state` is `ready`, `sealed`, `uninitialized`, `unauthorized` (the token file is missing or
OpenBao refuses the token) or `unavailable` (no answer). `configured` is `false` when the OpenBao
settings are missing or invalid. The route needs the `admin` role when OIDC is on. The web UI
reads the same data with the tRPC query `dashboard.keyStoreStatus`.
