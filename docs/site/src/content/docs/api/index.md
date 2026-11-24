---
title: REST API
sidebar:
  order: 1
---

- **[Call the API](/pki-manager-web/api/how-to/)**: credentials and working `curl` examples (they run in CI).
- **[Endpoints](/pki-manager-web/api/reference/)**: every operation and field, generated from the source code of
  this version.

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
  see [OIDC](/pki-manager-web/operations/oidc/).
- **`/api/v1/external`**: machine endpoints for integrations (the cert-manager issuer, SCEP, automation),
  authenticated with an integration token. See [Integrations](/pki-manager-web/guides/integrations/).
- **SSH automation endpoints** use fleet tokens (`pkimg_…`). See the
  [SSH API contract](/pki-manager-web/ssh/api-contract/).
- **`/trpc`**: the typed API used by the web UI. It is internal and can change between versions; use REST for scripts.
