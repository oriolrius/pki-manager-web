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
