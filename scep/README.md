# SCEP device enrollment and MDM gateway

The SCEP gateway enrolls **RSA client and device certificates** through PKI Manager.
OpenBao Transit holds the registration authority (RA) and issuing CA keys. The gateway
uses the Smallstep SCEP/CMS libraries. Devices authenticate with an encrypted PKCS#10
`challengePassword`. Choose shared challenges for generic
clients, native Intune validation for managed devices, or a trusted MDM validation
webhook. See [Intune device profiles and tenant setup](docs/intune.md).

API references: [gateway OpenAPI specification](openapi.yaml) and
[integration management / backend external issuer API](../docs/api/integrations.md).
The backend Swagger UI uses the separate **integrationToken** authorization
scheme for external issuance. The gateway `/scep` protocol runs on its own server.

## Supported profile

| Operation / feature | Support |
| --- | --- |
| `GET /scep?operation=GetCACaps` | `POSTPKIOperation`, `SHA-256`, `AES`, `Renewal` |
| `GET /scep?operation=GetCACert` | DER CMS certificate bundle containing CA and RA |
| `POST /scep?operation=PKIOperation` | `application/x-pki-message` or `application/octet-stream` |
| Legacy GET `PKIOperation&message=<URL-encoded base64>` | Supported within HTTP header limits |
| Initial `PKCSReq` | Immediate signed/encrypted `CertRep` success or failure |
| `RenewalReq` / `UpdateReq` | Active, service-owned old signer plus shared challenge or fresh MDM validation |
| Request envelopes | RSA PKCS#1 v1.5 key transport; content cipher AES-128/256-CBC, AES-128/256-GCM or 3DES-CBC, DER or BER. Other ciphers get a signed `badAlg` failure before any RA decryption ([session key length](../docs/api/integrations.md#ra-decrypt-cms-session-key-length)) |
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
ECDSA. Protocol, CMS/OpenSSL, backend RA and mocked Intune contract tests run
locally. Live Intune tenant enrollment and physical Windows/Apple/Android device
interoperability still require deployment acceptance testing; they are not
claimed as completed or Microsoft certification.

## Architecture and authorization

Use a v4 backend and gateway from the same release. Create an active CA and a dedicated
**SCEP / MDM** integration under **Operations → Integrations**. Give its CA-bound
service token to the gateway. Devices receive the challenge and CA trust.

The gateway calls the backend. The backend selects the RA from the authenticated
integration, checks its CA and records the requested RA operation in the audit log.
The gateway has no OpenBao credentials. `ra.json` holds public certificate metadata.
SQLite holds the RA binding and its provisioning and renewal leases. Keep a matching
backup of the database and OpenBao storage. See [OpenBao operations](../docs/operations/openbao.md).

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
network membership, and volume to your Compose. Set `IMAGE_TAG` to the v4 release used by the backend.

```yaml
services:
  scep:
    image: ghcr.io/oriolrius/pki-manager-web/scep:${IMAGE_TAG:?Set the backend release tag}
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

Attach the gateway to `pki-network`. The backend and the OpenBao Agent use the
private key-store network. Set the OpenBao address and credentials on the backend
and Agent as described in [OpenBao operations](../docs/operations/openbao.md).

Existing-installation template: `scep/compose.yml` with
`scep/compose.env.example`. Full-stack overlay:

```sh
docker compose -f docker/docker-compose.yml -f docker/docker-compose.scep.yml --profile scep up -d --build
```

Create `docker/scep-secrets/backend-token` and `challenge` before using templates,
with ownership/read permission for UID 10001. Use a cryptographically random
32–256-byte challenge, for example `openssl rand -hex 32`.
`serve` provisions automatically in Compose; manual `command: [provision]` is
optional and idempotent against the backend binding.

## RA key in OpenBao

1. On first provisioning, the backend records a generated key name and version in SQLite
   before it creates the RSA-3072 key in Transit. The key policy permits PKCS#1 v1.5
   session-key transport and denies private-key export, plaintext backup and deletion.
   A retry after the 15-minute provisioning lease expires reuses the recorded name.
2. The RA key signs a PKCS#10 request. The backend builds the RA certificate, and Transit
   signs it with the issuing CA. Renewal keeps the bound RA key and version and checks the
   public key against the previous certificate.
3. The gateway calls `ra/sign` with a SHA-256 digest. For `ra/decrypt`, it reads the
   content cipher from the verified CMS envelope and sends the corresponding
   `sessionKeyLength`. The backend calls the fork's session-key endpoint with the bound key
   version. See the [backend RA API](../docs/api/integrations.md#backend-owned-scep-ra)
   for request fields, supported lengths and errors.

The backend uses the dedicated Transit mount `pki-manager-ra` by default, with its own
credential: the AppRole `pki-manager-ra`, delivered by the Compose service `openbao-agent-ra`
(profile `scep`) to the backend `OPENBAO_RA_TOKEN_FILE`. The X.509/SSH backend token has no
right on the RA mount, and the RA token has none on the X.509 and SSH mounts. Without the RA
credential, the RA endpoints answer 503. The configuration, AppRoles and policies live with the
OpenBao deployment ([OpenBao operations](../docs/operations/openbao.md)). Omit the obsolete
`SCEP_RA_KEY_PROVIDER` setting on v4.

### Upgrade a v3 binding

Keep matching backups of the v3 backend database, its key store and the public RA
metadata. A binding that still references a Cosmian key returns HTTP 409 with
`RA_KEY_MIGRATION_REQUIRED` when the backend checks that binding. Reinstalling the gateway
or replacing `ra.json` cannot transfer the key. Complete the key migration and verify the RA
public key and certificate chain before resuming enrollment. A key that requires rotation
needs a replacement RA and client trust checks. See [OpenBao operations](../docs/operations/openbao.md).

Use the matching v4 gateway. A gateway that omits `sessionKeyLength` receives HTTP 400
from the backend on decryption.

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
and mocked Intune contracts. The live tests are opt-in and skip unless their URL
variable is set:

| Test | Variables | Checks |
|---|---|---|
| `TestLiveBackendRABoundary` | `SCEP_TEST_BACKEND_URL`, `SCEP_TEST_TOKEN_FILE` | backend-mediated RA signatures/decryption; caller key IDs rejected |
| `TestLiveManagedProfileWithKMS` | `SCEP_TEST_BACKEND_URL`, `SCEP_TEST_TOKEN_FILE` | managed SANs, key-rotating renewal and revocation (MDM approval is a test double) |
| `TestLiveEnrollment` | `SCEP_TEST_SERVER_URL`, `SCEP_TEST_CHALLENGE_FILE` | black-box enrollment through a running gateway |
| `TestLiveEnrollmentAndRenewal` | `SCEP_TEST_SERVER_URL`, `SCEP_TEST_CHALLENGE_FILE` | black-box `PKCSReq` and key-rotating `RenewalReq` through a running gateway, for AES-128/256 CBC/GCM envelopes (16- and 32-byte session keys) |

`SCEP_TEST_TOKEN_FILE` holds the `scep` integration token. The RA is read from the
backend, so no RA state file is needed. Run against a disposable backend and OpenBao instance:

```sh
SCEP_TEST_BACKEND_URL=http://127.0.0.1:52081 \
SCEP_TEST_TOKEN_FILE=/secure/test-token go test -run 'TestLive(BackendRABoundary|ManagedProfileWithKMS)' -v
```

Live tests create real certificates. Use an isolated CA. The live renewal test covers
AES-128 and AES-256. The CMS parser tests cover the 24-byte 3DES key size.
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
calls the backend or OpenBao. The backend separately bounds anonymous rejection
audit rows; that does not replace ingress rate limiting. Non-loopback backend
URLs must use HTTPS, including on Docker networks, so proxy configuration cannot
expose service tokens in plaintext.
