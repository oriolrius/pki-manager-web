# Call the REST API
<!-- tested-with: 3.15.0 -->

Every command on this page runs in CI against a demo stack (release 3.15.0), so it works as
written. You need `curl`, `jq` and `openssl`.

The full list of endpoints, with every field, is the [API reference](https://oriolrius.github.io/pki-manager-web/api/reference/). Each instance
also serves its own Swagger UI at `/api/docs` and the document at `/api/v1/openapi.json`.

## Credentials

The API has three kinds of credential. Each one opens a different part of it.

| Credential | Looks like | Opens | You get it from |
|---|---|---|---|
| OIDC access token | a JWT (`eyJ…`) | `/api/v1/*` (management: CAs, certificates, SSH) | your identity provider |
| Integration token | `pkimg_…` | `/api/v1/external/*` (sign, revoke, status) for **one CA** | **Operations → Integrations** in the UI |
| SSH fleet token | `pkimg_…` | `/api/v1/external/ssh/*` (sign SSH certificates, KRL) | `POST /api/v1/ssh/tokens` or the SSH UI |

Send each one as `Authorization: Bearer <token>`. Without OIDC (a test install), the
management API needs no token; the integration and fleet tokens are always required.

## Set up your shell

<!-- example: skip -->
```bash
API=https://pki.example.com      # your instance, without /api/v1
TOKEN=eyJ...                     # OIDC access token (admin role for the write calls below)
INTEGRATION_TOKEN=pkimg_...      # from Operations -> Integrations, bound to one CA
```

### Get an OIDC access token for a script

Use the client credentials flow with a confidential client in your identity provider (see
[OIDC: machine-to-machine](../../OIDC.md#machine-to-machine-authentication)). With Keycloak:

<!-- example: skip -->
```bash
TOKEN=$(curl -s https://keycloak.example.com/realms/pki/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=pki-service -d client_secret="$CLIENT_SECRET" \
  | jq -r .access_token)
```

The token needs the `admin` role to create CAs and revoke; the `user` role can list, issue and
download.

## 1. List the CAs

```bash
curl -s "$API/api/v1/cas/?limit=5" -H "Authorization: Bearer $TOKEN" \
  | jq '{total: .pagination.total, cas: [.items[] | {id, subject, status}]}'
```

Lists are paged with `limit` (at most 100) and `offset`; `pagination.hasMore` says if there is more.

## 2. Create a root CA

```bash
CA_ID=$(curl -s -X POST "$API/api/v1/cas/" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "subject": {"commonName": "Example API Root CA", "organization": "Example Corp", "country": "ES"},
        "keyAlgorithm": "RSA-4096",
        "validityYears": 10
      }' | jq -r .id)
echo "CA: $CA_ID"
```

The CA key pair is made in the KMS. `keyAlgorithm` is `RSA-2048` or `RSA-4096`.

## 3. Issue a server certificate

```bash
CERT_ID=$(curl -s -X POST "$API/api/v1/certificates/" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "caId": "'"$CA_ID"'",
        "subject": {"commonName": "api.example.internal", "organization": "Example Corp", "country": "ES"},
        "certificateType": "server",
        "keyAlgorithm": "ECDSA-P256",
        "validityDays": 90,
        "sanDns": ["api.example.internal"],
        "sanIp": ["192.0.2.10"]
      }' | jq -r .id)
echo "certificate: $CERT_ID"
```

`certificateType` is `server`, `client`, `dual`, `code_signing` or `email`. The key pair is
made in the KMS too. Put the common name in `sanDns` as well: clients check the SAN, not the CN.

## 4. Download it

Downloads return JSON; the file is base64 in `data`.

```bash
curl -s "$API/api/v1/certificates/$CERT_ID/download?format=pem" -H "Authorization: Bearer $TOKEN" \
  | jq -r .data | base64 -d > api.pem
curl -s "$API/api/v1/cas/$CA_ID/download?format=pem" -H "Authorization: Bearer $TOKEN" \
  | jq -r .data | base64 -d > ca.pem
openssl x509 -in api.pem -noout -subject -ext subjectAltName,extendedKeyUsage
openssl verify -CAfile ca.pem api.pem
```

Other formats: `der`, `p12` / `pfx` and `jks-keystore` (need an export password), `key-pem`,
`full-pem`, `chain-pem`, and more; see the reference for `GET /certificates/{id}/download`.

Send the export password in the `X-Export-Password` header, never in the URL: URLs end up in
browser history and in proxy and server logs. The `password` query parameter still works but is
deprecated. Example (not run in CI; it needs a server version that reads the header):

```text
curl -s "$API/api/v1/certificates/$CERT_ID/download?format=p12" \
  -H "Authorization: Bearer $TOKEN" -H "X-Export-Password: $EXPORT_PASSWORD" \
  | jq -r .data | base64 -d > api.p12
```

## 5. Revoke it and get the new CRL

```bash
curl -s -X POST "$API/api/v1/certificates/$CERT_ID/revoke" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"reason": "superseded", "generateCrl": true}' | jq '{status, revocationDate, revocationReason}'

SERIAL=$(openssl x509 -in api.pem -noout -serial | cut -d= -f2)
CRL_URL=$(openssl x509 -in api.pem -noout -ext crlDistributionPoints | grep -o 'URI:.*' | cut -c5-)
curl -s "$CRL_URL" -o api.crl
openssl crl -in api.crl -noout -text | grep -i -A1 "$SERIAL" | head -2
openssl verify -crl_check -CAfile ca.pem -CRLfile api.crl api.pem || echo "rejected, as expected"
```

The CRL URL is written into each certificate. `reason` is one of the RFC 5280 reasons
(`unspecified`, `keyCompromise`, `superseded`, `cessationOfOperation`, …).

## 6. Sign a CSR with an integration token

Machines that make their own key send a CSR to the external API. The integration token is bound
to one CA; the request does not name the CA. The CSR key must be **RSA** (2048–8192 bits): an
ECDSA CSR is rejected today with `400 INVALID_CSR` ("Cannot read public key. OID is not RSA.").

```bash
openssl req -new -newkey rsa:2048 -nodes -keyout device.key -out device.csr \
  -subj "/CN=device-17.example.internal/O=Example Corp/C=ES" \
  -addext "subjectAltName=DNS:device-17.example.internal" \
  -addext "extendedKeyUsage=clientAuth" -addext "keyUsage=digitalSignature,keyEncipherment"

jq -n --rawfile csr device.csr '{csrPem: $csr, requestUid: "device-17-2026-11", durationDays: 30}' > sign.json
curl -s -X POST "$API/api/v1/external/sign" \
  -H "Authorization: Bearer $INTEGRATION_TOKEN" -H 'Content-Type: application/json' -d @sign.json > signed.json
jq '{idempotent, serialNumber, notAfter}' signed.json
jq -r .certificatePem signed.json | openssl x509 -noout -subject -issuer
```

`requestUid` makes the call safe to repeat: the same value returns the same certificate
(`"idempotent": true`). More in [Automate issuance](../guides/integrations.md).

## 7. Read an error

Errors have one shape: `error.code`, `error.message` and, for validation, `error.details`.

```bash
curl -s "$API/api/v1/cas/?limit=500" -H "Authorization: Bearer $TOKEN" | jq .
```

| Status | Means |
|---|---|
| `400` | the request does not match the schema (see `details`) |
| `401` | no token, or the token is not valid |
| `403` | valid token, but the role or the token scope does not allow the call |
| `404` | the id does not exist |
| `409` | conflict with the current state (for example, already revoked) |

## Next

- [API reference](https://oriolrius.github.io/pki-manager-web/api/reference/): every endpoint and field, generated from the source code.
- [SSH external API contract](../ssh-api-contract.md): fleet tokens and SSH signing.
