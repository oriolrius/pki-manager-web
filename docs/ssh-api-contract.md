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

| Status | Meaning |
|---|---|
| `200` | new/encrypted KRL | `304` | host already current |
| `400` | malformed `host_id` | `404` | host not registered for distribution |
| `401/403` | invalid / out-of-scope token (sign/register) | `429` | rate-limited |
| `501` | ECIES path disabled | `503` | no CA / per-host KRL not initialized |

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
| `GET /ssh/host-ca-keys` | **Host-CA trust anchor** file (`/etc/ssh/ssh-host-ca.pub`) KRL signatures verify against (BLK-10) |
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
| `GET /api/v1/ssh/hosts/:id/access` | `ssh.host.access` | Who can reach this host: entitlement join (identity / via-roles / local accounts) merged with active blocks + per-host distribution state. |
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
