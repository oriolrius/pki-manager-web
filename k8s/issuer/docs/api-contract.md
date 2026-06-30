# External Issuer API Contract (TASK-109.01)

The contract between the cert-manager external issuer controller (`k8s/issuer`) and the PKI
Manager backend. All routes are served under `/api/v1/external` by
`backend/src/rest/routes/external.routes.ts`; the controller's typed client is
`k8s/issuer/internal/issuer/signer/signer.go`. This documents the **as-built** contract.

## Authentication

- **Scheme:** `Authorization: Bearer <cluster-token>` on every request (RFC 7235).
- **Token:** issued once when a cluster is registered in PKI Manager (`cluster.register`),
  format `pkimg_<base64url>`. Stored hashed (SHA-256, looked up by a 12-char prefix and
  compared with `timingSafeEqual`); revocable.
- **Scope:** a token is bound to exactly **one CA** (`clusters.ca_id`). All operations act on
  that CA only; a cluster can sign against and revoke only certificates under its CA.
- **Failures:** missing/invalid/revoked token → `401 UNAUTHORIZED` (`{error:{code,message}}`).
- **Transport:** intended to run over TLS. The controller can pin the server with
  `spec.caBundle` (PEM) on the Issuer/ClusterIssuer.

## Standard error response

Every non-2xx response has the shape:

```json
{ "error": { "code": "MACHINE_CODE", "message": "human readable" } }
```

The controller surfaces `code` + `message` on the CertificateRequest/Issuer status. Whether a
call should be **retried** is derived from the HTTP status + code:

| HTTP | code | Retryable | Meaning |
|------|------|-----------|---------|
| 400 | `BAD_REQUEST` | no | required field missing (`csrPem`/`requestUid`/`serialNumber`) |
| 400 | `INVALID_CSR` | no | CSR fails to parse/verify, or has no CN |
| 401 | `UNAUTHORIZED` | no (until token fixed) | missing/invalid/revoked token |
| 403 | `FORBIDDEN` | no | cluster tried to revoke a cert it did not issue |
| 404 | `CA_NOT_FOUND` / `NOT_FOUND` | no | CA (or cert) not found |
| 409 | `CA_NOT_ACTIVE` | no | bound CA is revoked/disabled |
| 409 | `CA_EXPIRED` | no | bound CA past `notAfter` |
| 5xx | `SIGN_FAILED` / (transport) | **yes** | KMS/backend transient failure — safe to retry (idempotent, see below) |

> Note: retryability is conveyed by status+code semantics above, not a literal `retryable`
> JSON field. The controller already treats network/5xx errors as retryable (requeue) and
> 4xx as terminal.

## Idempotency

`POST /sign` is idempotent on **`requestUid`** (the controller passes the
`CertificateRequest.UID`). A repeat call with the same `requestUid` from the same cluster
returns the previously issued certificate with `"idempotent": true` and does **not** sign
again. `POST /revoke` is idempotent on serial: revoking an already-revoked cert returns
`"idempotent": true`. This makes retries (controller requeues) safe.

## Endpoints

### `GET /api/v1/external/health`
Liveness + cluster identity probe (used by the Issuer reconciler to set `Ready`).

Response `200`:
```json
{ "status": "ok",
  "cluster": { "id": "uuid", "name": "string", "caId": "uuid" },
  "timestamp": "RFC3339" }
```
The controller compares `cluster.caId` to the Issuer's `spec.caId`; a mismatch →
`Ready=False, Reason=CAIDMismatch`.

### `GET /api/v1/external/ca-bundle`
The cluster CA's certificate/chain (PEM).

Response `200`:
```json
{ "caId": "uuid", "subjectDn": "string", "certificatePem": "PEM", "chainPem": "PEM" }
```
Errors: `404 CA_NOT_FOUND`. (Defined on the client as `CABundle()`; not currently called by
the controllers — the chain is returned inline by `/sign`.)

### `POST /api/v1/external/sign`
Sign a CSR with the cluster CA.

Request:
```json
{ "csrPem": "PEM (required)",
  "requestUid": "string (required, idempotency key = CertificateRequest.UID)",
  "durationDays": 90,                 // optional; clamped to [1, 825]; default 90
  "certificateType": "server|client|dual",  // optional; recorded for display only
  "k8sNamespace": "string",           // optional, audit metadata
  "k8sResource": "string",            // optional, audit metadata
  "sanDns": ["..."], "sanIp": ["..."] // optional; DEPRECATED/ignored — see below
}
```
Response `200`:
```json
{ "idempotent": false,
  "id": "uuid", "serialNumber": "hex",
  "certificatePem": "PEM", "chainPem": "PEM",
  "notBefore": "RFC3339", "notAfter": "RFC3339" }
```
Signing semantics (see [k8s-csr-signing.md](../../../docs/k8s-csr-signing.md)): the CSR is
signed by the CA **inside the Cosmian KMS** (the CA private key never leaves the KMS), and the
issued certificate uses the **CSR's own public key**. The CSR is authoritative for subject,
SAN, keyUsage and extendedKeyUsage (Cosmian copies them); the backend only adds
`basicConstraints=CA:FALSE`. The `sanDns`/`sanIp` request fields are therefore ignored — SANs
must be in the CSR. `certificateType` no longer drives usages (the CSR does); it is stored for
display only.

Errors: `400 BAD_REQUEST`, `400 INVALID_CSR`, `404 CA_NOT_FOUND`, `409 CA_NOT_ACTIVE`,
`409 CA_EXPIRED`, `500 SIGN_FAILED`.

### `POST /api/v1/external/revoke`
Revoke a previously issued certificate by serial.

Request: `{ "serialNumber": "hex (required)", "reason": "string (optional)" }`
Response `200`: `{ "id": "uuid", "serialNumber": "hex", "status": "revoked", "revocationDate": "RFC3339" }`
(adds `"idempotent": true` if already revoked).
Errors: `400 BAD_REQUEST`, `403 FORBIDDEN` (not the issuing cluster), `404 NOT_FOUND`.

> Revocation currently flips DB status + records `revocationDate`/`reason`. Publishing a
> signed CRL is a separate, not-yet-implemented backend concern.
