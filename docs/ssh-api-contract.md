# SSH Certificate Manager — External API Contract

Reference for the **automation / external** SSH endpoints that the Ansible
`ssh_host_cert` role and CI call, plus the **public** trust-material and KRL
download endpoints. (The operator-facing CRUD lives under `/api/v1/ssh` and is
OIDC-authenticated; it is documented in Swagger at `/api/docs`.)

All error responses use the standard shape: `{"error": {"code": "...", "message": "..."}}`.

## Authentication

| Surface | Auth |
|---|---|
| `POST /api/v1/external/ssh/*` (sign/register) | **Fleet bearer token** — `Authorization: Bearer pkimg_…`. Stored server-side only as a SHA-256 hash; one token scoped to a CA pair + op-set. Always over TLS; rate-limited per token. |
| `POST /api/v1/external/ssh/krl` | **None** — ECIES means only the target host can decrypt the response. |
| `GET /ssh/*`, `GET /krl/:caId.*` (public downloads) | **None** — trust material is public by design (like X.509 `/crl`). |

Mint a token from the UI or `trpc.ssh.token.mint`; the plaintext is shown **once**.

## Automation endpoints (token-scoped)

### `POST /api/v1/external/ssh/sign-host`
Sign a node's host key. Idempotent on the `Idempotency-Key` header.

```http
POST /api/v1/external/ssh/sign-host
Authorization: Bearer pkimg_…
Idempotency-Key: <host>-<pubkey-fingerprint>      # optional but recommended
Content-Type: application/json

{ "fqdn": "server.example.com",
  "addresses": ["10.0.0.5"],
  "opensshHostPubkey": "ssh-ed25519 AAAA… root@server",
  "validForSeconds": 31536000 }                    # optional (default +52w)
```
→ `200 { "hostId", "certOpenssh", "serial", "keyId", "validBefore" }`.
The host is auto-registered on first call. `source = automation`.

### `POST /api/v1/external/ssh/sign-user`
```http
{ "subject": "ci@pipeline",
  "sshPublicKey": "ssh-ed25519 AAAA…",
  "principals": ["deployer"],
  "extensions": ["permit-pty"],                    # optional whitelist
  "forceCommand": "/usr/bin/rsync …",              # optional critical option
  "sourceAddress": "10.0.0.0/8",                   # optional, validated CIDR list
  "validForSeconds": 604800 }                      # optional (default +1w)
```
→ `200 { "identityId", "certOpenssh", "serial", "keyId", "validBefore" }`.

### `POST /api/v1/external/ssh/register-host-pubkey`
Register the host's ECIES key (enables encrypted KRL delivery). Returns `501`
unless the backend runs with `SSH_ECIES_ENABLED=true`.
```http
{ "fqdn": "server.example.com" }
```
→ `200 { "hostId", "kmsPublicKeyId", "hostPrivKeyId" }`
(`hostPrivKeyId` configures the puller's `HOST_PRIV_KEY_ID`).

### `POST /api/v1/external/ssh/krl`  *(ECIES path; no token)*
```http
Content-Type: application/json
If-None-Match: sha256:<local revoked_keys hash>

{ "host_id": "server.example.com" }
```
→ `304` (X-KRL-Version, no body) when current, or `200` `application/octet-stream`
carrying an **ECIES ciphertext** only the host can decrypt. Inner payload:
`{ krl, ca_signature, krl_version, valid_until, host_id }`.

| Status | Meaning |
|---|---|
| `200` | new/encrypted KRL | `304` | host already current |
| `400` | malformed `host_id` | `404` | host not registered for distribution |
| `401/403` | invalid / out-of-scope token (sign/register) | `429` | rate-limited |
| `501` | ECIES path disabled | `503` | no CA / no KRL yet |

Retryability: sign/register are **idempotent with an `Idempotency-Key`** and safe
to retry; without it a retry mints a new serial. `/krl` is always safe to retry.

## Public download endpoints (no auth)

| Endpoint | Returns |
|---|---|
| `GET /ssh/cas/:id/ca.pub` | a CA's OpenSSH public key |
| `GET /ssh/trusted-user-ca-keys` | `TrustedUserCAKeys` file (all active/rotating User CAs) |
| `GET /ssh/cert-authority?pattern=*.example.com` | a `@cert-authority` known_hosts line |
| `GET /ssh/hosts/:id/cert.pub` | a host's current certificate |
| `GET /ssh/hosts/:id/sshd-config` | the host's `sshd_config` drop-in |
| `GET /krl/:caId.bin` | the **bare** KRL bytes for `RevokedKeys` (ETag / `If-None-Match` → 304) |
| `GET /krl/:caId.json` | the bare KRL + detached CA signature + version (for the puller) |

### KRL trust model (important)

OpenSSH KRLs are **natively unsigned** — `sshd` does **not** verify any signature
on a `RevokedKeys` file. Integrity of the public bare KRL (`/krl/:caId.bin`)
therefore rests on **TLS + `0444` root-owned file perms**, with short certificate
TTLs (+1w users, +52w hosts) as the **primary** revocation mechanism. The detached
CA signature served alongside (`/krl/:caId.json`, and inside the ECIES payload) is
an **extra** guarantee verified only by the optional puller, not by `sshd`.
