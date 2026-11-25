# SSH Certificate Manager — External API Contract

Reference for the **automation / external** SSH endpoints that the Ansible
`ssh_host_cert` role and CI call, plus the **public** trust-material and KRL
download endpoints. (The operator-facing CRUD lives under `/api/v1/ssh` and is
OIDC-authenticated; it is documented in Swagger at `/api/docs`.)

The handlers send errors in the standard shape: `{"error": {"code": "...", "message": "..."}}`.
One exception: a body that does not match the route's JSON schema (for example, a missing
required field) is refused by Fastify before the handler runs. That `400` has Fastify's own
shape: `{"statusCode": 400, "code": "FST_ERR_VALIDATION", "error": "Bad Request", "message": "..."}`.

### Errors of the token-scoped endpoints

Every endpoint under `/api/v1/external/ssh/` except `/krl` checks the fleet token first:

| Status | Code | Cause |
|---|---|---|
| `401` | `UNAUTHORIZED` | no `Authorization: Bearer` header, or the token is unknown or revoked |
| `403` | `FORBIDDEN` | the token's op-set does not include the operation of this endpoint |
| `429` | `RATE_LIMITED` | more than 120 requests with this token in a fixed 60-second window (in-memory, per backend process) |

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
  "opensshHostPubkey": "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBMJpWK6CqtAoS4olpmTzXiTn/IZvxFmJxzfxCp1zai3lkeBwDIGSQkxOPhH2C7KjDD2SbxHzE6bT08vlnIBg5wM= root@server",
  "validForSeconds": 31536000 }                    # optional (default +52w)
```
→ `200 { "hostId", "certOpenssh", "serial", "keyId", "validBefore" }`.
The host is auto-registered on first call. `source = automation`.

The host key must be `ecdsa-sha2-nistp256` (the content of `/etc/ssh/ssh_host_ecdsa_key.pub`).
The same key is the subject of the host certificate and the key that the encrypted KRL
(`POST /krl`) is encrypted to, and ECIES needs a P-256 key. Any other key type is refused
with `400 SSH_ERROR`:

```json
{"error":{"code":"SSH_ERROR","message":"SSH host keys must be ecdsa-sha2-nistp256 — paste /etc/ssh/ssh_host_ecdsa_key.pub (got 'ssh-ed25519'). The host certificate and encrypted KRL distribution both require a P-256 key."}}
```

| Status | Code | Cause |
|---|---|---|
| `400` | `VALIDATION_ERROR` | the body fails the Zod schema (for example, an invalid `fqdn`) |
| `400` | `SSH_ERROR` | the service refused or failed: host key not `ecdsa-sha2-nistp256`, not an OpenSSH public key, host offboarded, no active Host CA in the token's zone, KMS error. `message` gives the cause. |

Plus the token errors above and the Fastify schema `400`.

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
User keys can be `ssh-ed25519` or `ecdsa-sha2-nistp256`.

| Status | Code | Cause |
|---|---|---|
| `400` | `VALIDATION_ERROR` | the body fails the Zod schema (for example, an invalid principal name or CIDR) |
| `403` | `TOKEN_LIMIT` | the request is outside the token limits (see below) |
| `400` | `SSH_ERROR` | the service refused or failed: not an OpenSSH public key, identity disabled, identity not entitled to a requested principal, no active User CA in the token's zone, KMS error. `message` gives the cause. |

Plus the token errors above and the Fastify schema `400`.

**Token limits (optional, set at mint time).** A `sign-user` token can carry:

| Limit | Mint field | Effect on `sign-user` |
|---|---|---|
| Allowed principals | `allowedPrincipals: string[]` — names that exist in the token zone's principal catalog | Every requested principal must be in the list (`P@<host>` is accepted when `P` is). Otherwise `403 TOKEN_LIMIT`. |
| Max certificate lifetime | `maxValidForSeconds: number` | `validForSeconds` above it → `403 TOKEN_LIMIT`. Without `validForSeconds` the cert gets `min(604800, maxValidForSeconds)`. |

A refused request writes an `ssh.external.sign` audit row with `status: failure`
and creates nothing. Tokens minted without limits (including every token minted
before this feature) keep the old behaviour: any principal, any lifetime, in the
token's zone. The Fleet tokens page shows them as **Unrestricted**.
Minting limits on a token without `sign-user`, or a principal not in the zone
catalog, is refused (`400`).

```http
POST /api/v1/ssh/tokens          # OIDC (operator) — or trpc.ssh.token.mint
{ "name": "ci-deploy", "userCaId": "…", "opSet": ["sign-user"],
  "allowedPrincipals": ["deployer"], "maxValidForSeconds": 900 }
```

### `POST /api/v1/external/ssh/register-host-pubkey`
Token op: `register-host-pubkey`. Confirms that the host can receive the encrypted KRL. No new
key is made: the host key on file (from `sign-host`) is the ECIES key.
```http
{ "fqdn": "server.example.com" }                 # "host_id" is accepted as an alias
```
→ `200 { "hostId", "ready", "keyAlgorithm", "fingerprint" }`.

| Status | Code | Cause |
|---|---|---|
| `501` | `NOT_IMPLEMENTED` | the backend does not run with `SSH_ECIES_ENABLED=true` |
| `400` | `VALIDATION_ERROR` | no `fqdn`, or not a valid host name |
| `404` | `NOT_FOUND` | no host with this FQDN in the token's zone |
| `409` | `ECIES_KEY_UNSUPPORTED` | the host key on file is not `ecdsa-sha2-nistp256`, or the host has no key |

Plus the token errors above.

### `GET /api/v1/external/ssh/hosts/:fqdn/auth-principals`
Token op: `get-principals`. Returns the host's rendered `AuthorizedPrincipalsFile`
map (the host is looked up by FQDN **in the token's zone**):
```json
{ "hostId": "…", "fqdn": "server.example.com",
  "directive": "AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u",
  "files": { "root": "ops\nops@server.example.com\n" },
  "sha256": "<64 lowercase hex>",
  "stale": true }
```
`files` maps each local account to the verbatim contents of
`/etc/ssh/auth_principals/<account>`. `stale` is `true` when these files
changed (a mapping was added or removed) after the last confirmed push. A host
certificate issue/renew never makes a host stale.

| Status | Code | Cause |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `:fqdn` is not a valid host name |
| `404` | `NOT_FOUND` | no host with this FQDN in the token's zone |
| `400` | `SSH_ERROR` | the render failed; `message` gives the cause |

Plus the token errors above.

**Canonical `sha256`** (stable; automation computes it the same way): for each
account in ascending byte order of its name, append
`UTF-8(account) || 0x00 || UTF-8(file contents, verbatim) || 0x00`; take the
SHA-256 of the concatenation, lowercase hex. No accounts → SHA-256 of the empty
string (`e3b0c442…b855`). Python:
```python
h = hashlib.sha256()
for account in sorted(files):
    h.update(account.encode() + b"\0" + files[account].encode() + b"\0")
h.hexdigest()
```

### `POST /api/v1/external/ssh/hosts/:fqdn/principals-pushed`
Token op: `get-principals`. Call it **after** the files from the GET above are
installed on the host. Echo the `sha256` of the files you installed:
```http
{ "sha256": "<64 hex>" }                         # a "sha256:" prefix is accepted
```
→ `200 { "hostId", "fqdn", "lastPrincipalPushAt", "sha256" }` — the host is no
longer stale.
→ `409 { "error": { "code": "SHA256_MISMATCH", … }, "currentSha256": "<64 hex>" }`
when the hash is not the hash of the **current** render (the mappings changed
after your GET): nothing changes; fetch again, install, acknowledge again.


| Status | Code | Cause |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `:fqdn` is not a valid host name, or `sha256` is not 64 hex characters |
| `404` | `NOT_FOUND` | no host with this FQDN in the token's zone |
| `409` | `SHA256_MISMATCH` | the hash is not the hash of the current render (see above) |
| `400` | `SSH_ERROR` | the acknowledgement failed; `message` gives the cause |

Plus the token errors above. Every attempt writes an `ssh.principal.mark_pushed` audit row (success or failure).

### `POST /api/v1/external/ssh/krl`  *(ECIES path; no token)*
```http
Content-Type: application/json
If-None-Match: sha256:<local revoked_keys hash>

{ "host_id": "server.example.com" }        # optional "zone" (id or slug) when the FQDN exists in several zones
```
→ `304` (X-KRL-Version, no body) when current, or `200` `application/octet-stream`
carrying an **ECIES ciphertext** only the host can decrypt. Inner payload:
`{ krl, ca_signature, krl_version, valid_until, host_id }`.

Since BLK-06 (decision-016) the payload source is the **composed per-host KRL**
(host-CA revocations ∪ all user-CA revocations ∪ resolved per-host access
blocks), signed with the **Host-CA** key (trust anchor `/etc/ssh/ssh-host-ca.pub`,
`GET /ssh/host-ca-keys`). Behavior is gated by `SSH_HOST_KRL_SERVE`
(default **on**; `false` rolls back to the legacy per-CA payload — safe in both
directions because KRL numbers are globally monotonic across lineages). On a
host's **first** fetch the composed row is generated synchronously; if that
generation fails the endpoint answers `503 NO_KRL` (**no per-CA fallback**) and
pullers keep their last-good KRL. Both 200 and 304 stamp the host's
`last_krl_fetch_at` telemetry.

This endpoint has no token, so it never returns `401` or `403`.

| Status | Code | Meaning |
|---|---|---|
| `200` | | the encrypted KRL (`application/octet-stream`, header `X-KRL-Version`) |
| `304` | | `If-None-Match` equals the current version: the host is current |
| `429` | `RATE_LIMITED` | more than 120 requests from this IP address in a fixed 60-second window |
| `501` | `NOT_IMPLEMENTED` | the backend does not run with `SSH_ECIES_ENABLED=true` |
| `400` | `VALIDATION_ERROR` | no `host_id` in the body, or not a valid host name |
| `404` | `NOT_FOUND` | the `zone` is unknown; the host is not registered or has no host key; the host is offboarded |
| `409` | `AMBIGUOUS_HOST` | the FQDN exists in several zones: send `zone` |
| `503` | `NO_KRL` | the per-host KRL is not initialized (its first generation failed), or no KRL exists (legacy per-CA path) |
| `503` | `NO_CA` | legacy per-CA path only (`SSH_HOST_KRL_SERVE=false`): no active Host CA in the host's zone |
| `404` | `ECIES_KEY_UNSUPPORTED` | the host key on file cannot receive ECIES (it is not P-256) |
| `500` | `ENCRYPT_FAILED` | the ECIES encryption failed for another reason |

The two encryption failures write an `ssh.krl.distribute` audit row with `status: failure`.

Retryability: sign/register are **idempotent with an `Idempotency-Key`** and safe
to retry; without it a retry mints a new serial. `/krl` is always safe to retry.

## Public download endpoints (no auth)

| Endpoint | Returns |
|---|---|
| `GET /ssh/cas/:id/ca.pub` | a CA's OpenSSH public key |
| `GET /ssh/zones/:zone/trusted-user-ca-keys` | `TrustedUserCAKeys` file for a zone (its active/rotating User CAs) |
| `GET /ssh/trusted-user-ca-keys` | Deprecated: same file for the default zone only |
| `GET /ssh/zones/:zone/cert-authority?pattern=*.example.com` | a `@cert-authority` known_hosts line for a zone |
| `GET /ssh/cert-authority?pattern=*.example.com` | Deprecated: same line for the default zone only |
| `GET /ssh/hosts/:id/cert.pub` | a host's current certificate |
| `GET /ssh/hosts/:id/sshd-config` | the host's `sshd_config` drop-in |
| `GET /ssh/zones/:zone/host-ca-keys` | Zone-scoped Host-CA trust anchor (same format as below) |
| `GET /ssh/host-ca-keys` | Deprecated (default zone): **Host-CA trust anchor** file (`/etc/ssh/ssh-host-ca.pub`) KRL signatures verify against (BLK-10) |
| `GET /krl/:caId.bin` | the **bare** KRL bytes for `RevokedKeys` (ETag / `If-None-Match` → 304) |
| `GET /krl/:caId.json` | the bare KRL + detached CA signature + version (for the puller) |
| `GET /krl/hosts/:hostId.bin` | the **composed per-host** KRL bytes (`:hostId` = host id or fqdn; same ETag/304/last-good semantics). **Gated `SSH_HOST_KRL_PUBLIC`, default OFF** — enabling leaks per-host deny intel unauthenticated. |
| `GET /krl/hosts/:hostId.json` | composed per-host KRL + detached Host-CA signature + version (same gate) |

### KRL trust model (important)

OpenSSH KRLs are **natively unsigned** — `sshd` does **not** verify any signature
on a `RevokedKeys` file. Integrity of the public bare KRL (`/krl/:caId.bin`)
therefore rests on **TLS + `0444` root-owned file perms**, with short certificate
TTLs (+1w users, +52w hosts) as the **primary** revocation mechanism. The detached
CA signature served alongside (`/krl/:caId.json`, and inside the ECIES payload) is
an **extra** guarantee verified only by the optional puller, not by `sshd`.

## Operator block API (OIDC, `/api/v1/ssh`)

The per-host access-block surface (BLK-08). tRPC twins live under
`trpc.ssh.block.*` / `trpc.ssh.host.access`; both share the same Zod schemas and
the SSH-34 fail-closed posture (403 when OIDC is off without
`ALLOW_UNAUTHENTICATED_SSH_CA=true`). Same tier as host revoke/offboard.

| Endpoint | tRPC twin | Semantics |
|---|---|---|
| `POST /api/v1/ssh/blocks` `{hostId, identityId, reason?}` | `ssh.block.block` | Block the identity on that host only; synchronously regenerates the host's composed KRL. Response carries `warnings.sharedKeyCollisions` (fingerprint over-block) and the fresh `krl`. |
| `POST /api/v1/ssh/blocks/unblock` `{hostId, identityId}` | `ssh.block.unblock` | Lift the block (row kept for audit). Symmetric: enforced on the host's next pull, shown as *Lifting* until the post-lift version lands. |
| `GET /api/v1/ssh/hosts/:id/access` | `ssh.host.access` | Who can reach this host: identities with a live user certificate whose principals (`P` or `P@<fqdn>`) map to an account here, plus grantees of a mapped principal — each entry has `source`: `certificate` \| `grant` \| `both` (`null` for a block-only row), `viaRoles`, `localAccounts` — merged with active blocks + per-host distribution state. Same zone only. |
| `GET /api/v1/ssh/hosts/:id/blocks` | `ssh.block.listForHost` | Block history (active + lifted) with superseded-by-offboard annotation. |
| `GET /api/v1/ssh/identities/:id/blocks` | `ssh.block.listForIdentity` | The identity's active blocks as `{hostId, fqdn, state}` tuples (Users-page pills). |
| `GET /api/v1/ssh/blocks/fleet` | `ssh.block.fleetDistribution` | Per-host `{blockCount, state, krlNumber, lastKrlFetchAt}` fleet propagation view (KRL page). |

Distribution state values: `effective` (served version matches the composed
head — *"served to host puller at \<time\>", not confirmation of install*),
`pending`, `lifting`, `unknown` (no usable ECIES registration ⇒ blocks cannot
land via ECIES), plus the distinct `unsignedLatest` cause (KMS signing failed;
`krl-client` hosts fail-stale on last-good until a signed row lands).

### Environment gates

| Variable | Default | Effect |
|---|---|---|
| `SSH_HOST_KRL_SERVE` | `true` | ECIES `/krl` serves the composed per-host KRL; `false` = legacy per-CA payload (rollback switch). |
| `SSH_HOST_KRL_PUBLIC` | `false` | Enables `GET /krl/hosts/:hostId.bin|.json`. Public-path hosts only receive blocks when this is on AND their fetch URL is switched. |
