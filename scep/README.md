# SCEP device enrollment and MDM gateway

Optional SCEP endpoint for **RSA client/device certificates**, backed by
PKI Manager and Cosmian KMS. It uses the Smallstep SCEP/CMS libraries, not a custom
ASN.1 protocol implementation. No OIDC login is required on the device: enrollment
uses an encrypted PKCS#10 `challengePassword`. Choose shared challenges for generic
clients, native Intune validation for managed devices, or a trusted MDM validation
webhook. See [Intune device profiles and tenant setup](docs/intune.md).

API references: [gateway OpenAPI specification](openapi.yaml) and
[integration management / backend external issuer API](../docs/api/integrations.md).
The backend Swagger UI uses the separate **integrationToken** authorization
scheme for external issuance. The gateway `/scep` protocol runs on its own server.

## Supported profile

| Operation / feature | Support |
| --- | --- |
| `GET /scep?operation=GetCACaps` | `POSTPKIOperation`, `SHA-256`, `AES` |
| `GET /scep?operation=GetCACert` | DER CMS certificate bundle containing CA and RA |
| `POST /scep?operation=PKIOperation` | `application/x-pki-message` |
| Legacy GET `PKIOperation&message=<URL-encoded base64>` | Supported within HTTP header limits |
| Initial `PKCSReq` | Immediate signed/encrypted `CertRep` success or failure |
| `RenewalReq` / `UpdateReq` | Active, service-owned old signer plus shared challenge or fresh MDM validation |
| Response cryptography | SHA-256/RSA PKCS#1 signatures; AES-256-CBC envelopes |
| Device keys | RSA, 2048–8192 bits; signer and CSR must use the same key |
| CSR identity | Nonempty CN, maximum 128 bytes; managed modes support DNS, IP, email, URI and Microsoft UPN SANs |
| Certificate profile | Required `clientAuth` EKU; optional digitalSignature/keyEncipherment KU and CA:false |
| CertPoll, GetCert, GetCRL, GetNextCACert | Not supported; not advertised |
| SANs in shared mode, CA:true, other EKUs or extensions | Rejected |

The native Intune adapter follows Microsoft's published third-party SCEP SDK HTTP
contract: OAuth app authentication, Graph service discovery, full-CSR challenge
validation, issuance notifications, and durable revocation polling. Intune mode
never falls back to the shared challenge. It targets the commercial Microsoft
cloud. This is not Windows NDES and does not require an AD CS private key export.

The device profile is EAP-TLS client authentication, not server certificates or
ECDSA. Protocol, CMS/OpenSSL, KMS/backend, and mocked Intune contract tests run
locally. Live Intune tenant enrollment and physical Windows/Apple/Android device
interoperability still require deployment acceptance testing; they are not
claimed as completed or Microsoft certification.

## Architecture and authorization

Deploy [integration foundation #18](https://github.com/oriolrius/pki-manager-web/pull/18)
first. Create an active CA and a dedicated **SCEP / MDM** integration under
**Operations → Integrations**, then give its CA-bound service token to the gateway.
Devices receive only the challenge and CA trust.

The gateway communicates exclusively with the existing backend. It has **no KMS
client, KMS credentials, private keys, or KMS object identifiers**. The backend
provisions a Sensitive RSA-3072 RA key and fixes its CA, subject, extensions and
algorithms. `/api/v1/external/ra/*` resolves the key from the authenticated
integration; callers cannot select another key. Every RA operation checks the
integration/CA/RA state and persists audit intent before contacting KMS.

`ra.json` contains public certificates only. Backend database migrations retain
the authoritative RA binding and provisioning/renewal leases. Back up the backend
DB and KMS together. Interrupted provisioning retains a 15-minute backend lease. After expiry,
provisioning reuses recorded keys; if no key was recorded, allocation can retry.
An ambiguous lost KMS response can leave an orphan: reconcile KMS objects against
the integration audit trail.
Deleting gateway state does not create another RA.

RA renewal runs on startup and hourly, during the last third of its lifetime.
It uses the same backend-owned key and publishes new public metadata atomically;
still-valid previous RA certificates support cached recipients. An expired,
otherwise active RA can recover through backend renewal. A revoked RA/token/CA
fails closed and requires administrative action. This does not schedule client
renewal: configure SCEP renewal in each client/MDM profile. Handle key compromise
and key rotation separately.

Shared mode permits a dynamic CN only. O/OU/C/ST/L must exactly match the optional
`SCEP_SHARED_SUBJECT` JSON map; absent configuration means CN only. SANs are
rejected in shared mode. Anyone holding the shared challenge can choose a CN;
use a dedicated CA and rotate the challenge if compromised. Managed modes validate
the exact CSR through Intune or a trusted webhook. Renewals retain the previous
subject and SANs, check active ownership, and revalidate enrollment authorization.

Requests use an immutable RA/chain snapshot under a short lock. Discovery
(GetCACaps/GetCACert) uses public state without backend calls. Request cancellation
propagates to RA sign/decrypt. Temporary startup renewal failures retain a valid
current RA and retry hourly; an expired/invalid RA still fails closed.

Requests are bounded before occupying an issuance slot. Remote calls do not hold
the global issuance mutex. Identical CSRs serialize within one gateway; deploy
one gateway replica because device-issuance requestUid uniqueness is not enforced
across backend replicas. RA provisioning/renewal itself uses database leases.
Transient revocation failures retain the Intune journal for retry; RA serials are
protected from integration-token revocation.

## Docker / Arcane: one additional container

Use one existing Compose project and its existing `.env`. Add this service,
network membership, and volume to your Compose. Replace the image tag with a
build containing this change and foundation #18 in the backend.

```yaml
services:
  scep:
    image: ghcr.io/tilwegener/pki-manager-web/scep:${IMAGE_TAG:-dev}
    restart: unless-stopped
    command: [serve]
    user: "10001:10001"
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    tmpfs: [/tmp]
    networks: [pki-network]
    environment:
      SCEP_BACKEND_URL: ${SCEP_BACKEND_URL:?HTTPS backend URL required}
      SCEP_BACKEND_TOKEN: ${SCEP_BACKEND_TOKEN:?required}
      SCEP_AUTH_MODE: shared
      SCEP_CHALLENGE: ${SCEP_CHALLENGE:?required}
      SCEP_AUTO_PROVISION: "true"
      SCEP_RA_AUTO_RENEW: "true"
      SCEP_STATE_FILE: /data/ra.json
      SCEP_VALIDITY_DAYS: "90"
    volumes: [scep-state:/data]
    ports: ["127.0.0.1:8086:8085"]
volumes:
  scep-state:
```

The backend container listens on port `3000`, but non-loopback HTTP backend URLs
are rejected. Set `SCEP_BACKEND_URL` to the HTTPS API address provided by your
existing PKI reverse proxy (including its valid certificate trust). Alternatively,
a gateway running on the backend host can use a loopback HTTP endpoint. Put the
SCEP endpoint behind HTTPS with rate/body/time limits. Change the loopback bind
only if your reverse proxy requires it. Do not expose backend RA endpoints to
devices. Secret files are also supported through `SCEP_BACKEND_TOKEN_FILE` and
`SCEP_CHALLENGE_FILE` (set either value or file, never both).

Keep KMS on a **separate internal network shared only with the backend**. Attach
the backend to both that network and `pki-network`; attach the gateway only to
`pki-network`. The full stack in `docker/docker-compose.yml` implements this.
For an existing installation remove all `SCEP_KMS_*` settings and KMS secret
mounts, and separate the networks accordingly. KMS credentials belong only in the
backend configuration. No additional backend container or `.env` is needed.

Existing-installation template: `scep/compose.yml` with
`scep/compose.env.example`. Full-stack overlay:

```sh
docker compose -f docker/docker-compose.yml -f docker/docker-compose.scep.yml --profile scep up -d --build
```

Create `docker/scep-secrets/backend-token` and `challenge` before using templates,
with ownership/read permission for UID 10001. Use a cryptographically random
32–256-byte challenge, e.g. `openssl rand -hex 32`. No KMS secret file is needed.
`serve` provisions automatically in Compose; manual `command: [provision]` is
optional and idempotent against the backend binding.

Cosmian KMS **5.28.0** is pinned and tested. Before upgrading an existing 5.12
installation, follow [the KMS backup/migration runbook](../DEPLOYMENT.md#kms-upgrade-backup-before-recreating-the-container).
KMS 5.24 reuses serials for the same key and cannot support safe RA renewal;
5.28 generates fresh serials. The explicit config mounts `/cosmian-kms/sqlite-data` and is selected with
`COSMIAN_KMS_CONF`; mounting an unrelated directory does not persist keys.

### Migration from the earlier direct-KMS gateway

Back up the backend database, KMS data, and old public RA metadata. Deploy the
new backend first, then the gateway. Existing gateway key IDs are **never adopted
from a file or request**. The backend provisions a new, integration-bound RA;
clients must rediscover GetCACert before enrollment. Retire old RA certificates
through the administrative UI once their recipients no longer need them. Keep
orphan/failed-provisioning cleanup an explicit operator task.

## Configuration

| Variable | Default / requirement |
| --- | --- |
| `SCEP_AUTH_MODE` | `shared`, `intune`, or `webhook`; default `shared` |
| `SCEP_BACKEND_URL` | `http://127.0.0.1:52081` |
| `SCEP_BACKEND_TOKEN` or `_FILE` | Required dedicated SCEP integration token |
| `SCEP_CHALLENGE` or `_FILE` | Shared mode only; 32–256 bytes |
| `SCEP_SHARED_SUBJECT` | Optional fixed DN map, e.g. `{"O":"Example","C":"DE"}` |
| `SCEP_STATE_FILE` | `./data/ra.json`; public metadata |
| `SCEP_AUTO_PROVISION` | `false` in binary; `true` in Compose |
| `SCEP_RA_AUTO_RENEW` | `true`; startup and hourly |
| `SCEP_LISTEN` | `:8085` |
| `SCEP_VALIDITY_DAYS` | `90`; allowed 1–90, limited by CA lifetime |

For local use explicitly load `scep/.env.example` settings into the process;
the binary does not load `.env` itself. Backend tokens are privileged service
credentials. Use TLS or a protected private network for backend communication.

## Validation

```sh
cd scep
go test -race ./...
go vet ./...
go build .
```

Tests cover protocol/CMS/OpenSSL, identity policy, backend RA adapters, renewal,
and mocked Intune contracts. For an isolated real backend/KMS:

```sh
SCEP_TEST_BACKEND_URL=http://127.0.0.1:52081 \
SCEP_TEST_TOKEN_FILE=/secure/test-token go test -run TestLiveBackendRABoundary -v
```

This checks real backend-mediated RA signatures/decryption and rejects caller
key IDs. Live enrollment tests create real certificates; use an isolated CA.
Live Intune/device acceptance remains a deployment-specific check.

## Other MDM providers

See [native Intune setup](docs/intune.md). Generic webhook configuration is in
`.env.mdm.example`; its validator must authorize the exact CSR, including subject,
SANs, EKU and challenge.

### Required gateway rate limiting

A rate-limiting reverse proxy or ingress **is a deployment requirement**. Anonymous
PKIOperation requests can consume RA decrypt/sign operations before a challenge
can be checked. Limit PKIOperation by source and globally, cap concurrent upstream
requests and body size (1 MiB), and enforce read/header timeouts. For example, in
nginx `http` context define:

```nginx
limit_req_zone $binary_remote_addr zone=scep_per_ip:10m rate=5r/m;
limit_req_zone $server_name zone=scep_global:1m rate=30r/m;
limit_conn_zone $server_name zone=scep_connections:1m;
```

Apply this in the TLS server's exact `/scep` location:

```nginx
location = /scep {
    limit_req zone=scep_per_ip burst=5 nodelay;
    limit_req zone=scep_global burst=10 nodelay;
    limit_req_status 429;
    limit_conn scep_connections 8;
    client_max_body_size 1m;
    client_body_timeout 10s;
    proxy_read_timeout 180s;
    proxy_pass http://127.0.0.1:8086;
}
```

Tune these example limits for the enrollment fleet. Ensure the proxy sees trusted
source addresses, and prevent direct access to the published gateway port. These
limits apply to discovery too in this simple example; discovery itself no longer
uses backend or KMS resources. The backend separately bounds anonymous rejection
audit rows; that does not replace ingress rate limiting. Non-loopback backend
URLs must use HTTPS, including on Docker networks, so proxy configuration cannot
expose service tokens in plaintext.
