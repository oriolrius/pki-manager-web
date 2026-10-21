# SCEP device enrollment and MDM gateway

Optional SCEP endpoint for **RSA client/device certificates**, backed by
PKI Manager and Cosmian KMS. It uses the Smallstep SCEP/CMS libraries, not a custom
ASN.1 protocol implementation. No OIDC login is required on the device: enrollment
uses an encrypted PKCS#10 `challengePassword`. Choose shared challenges for generic
clients, native Intune validation for managed devices, or a trusted MDM validation
webhook. See [Intune device profiles and tenant setup](docs/intune.md).

## Supported profile

| Operation / feature | Support |
| --- | --- |
| `GET /scep?operation=GetCACaps` | `POSTPKIOperation`, `SHA-256`, `AES` |
| `GET /scep?operation=GetCACert` | DER CMS certificate bundle containing CA and RA |
| `POST /scep?operation=PKIOperation` | `application/x-pki-message` |
| Legacy GET `PKIOperation&message=<URL-encoded base64>` | Supported within HTTP header limits |
| Initial `PKCSReq` | Immediate signed/encrypted `CertRep` success or failure |
| `RenewalReq` / `UpdateReq` | Managed modes: fresh MDM validation plus active, service-owned old signer |
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

Run one gateway instance per dedicated issuing CA. In PKI Manager create an active
CA, then create a dedicated **cluster/service token** bound to that CA (the existing
Clusters UI/API). This token allows `/api/v1/external/ca-bundle` and `/sign`; it is
separate from OIDC access tokens. Keep it inside the gateway. Devices receive only
the enrollment challenge and CA trust, never the backend or KMS token.

`provision` creates a Sensitive RSA-3072 RA key in KMS with Sign/Decrypt usage,
requests an RA certificate from the bound CA, and writes **only the public
certificate and KMS key ID** to `ra.json`. No CA/RA private key is exported or
persisted on the gateway. Signing and decryption are checked against the KMS at
startup, and the backend must confirm the RA is active and service-owned. The existing backend signs device CSRs, retains certificate metadata and
records issuance in `audit_log`. Because this reuses the external-issuer API,
certificates currently appear with its `k8s` source label and service identity.

**Shared mode only:** use a separate CA and a random, protected challenge: anyone possessing this shared
challenge can request a client certificate for an arbitrary CN within this
profile. It is not a single-use enrollment token or proof of a device's name.
Changing the challenge and restarting the gateway stops its further use; already
issued certificates require normal revocation. A new token is needed if the
service identity is revoked. Do not change its CA binding in place.

Valid signatures, CSR proof of possession and the configured enrollment authority
are checked before issuance. Managed SANs are authorized against the exact CSR;
the gateway does not substitute device identities itself. Exact CSR retries use the backend's deterministic `requestUid`; revoked
or expired certificates are not returned by that retry path. The gateway checks
the issuing CA before every enrollment, including retries. RA/CA expiry prevents
further requests. Renewals also check the old signer against the backend for
ownership, expiry and revocation. Run a single replica: backend requestUid creation is not a
cross-process transaction lock.

## Docker setup

The gateway is an optional overlay; normal PKI Manager startup is unchanged.
The SCEP GitHub workflow builds an image on pull requests and publishes
`ghcr.io/<owner>/pki-manager-web/scep:latest` after merge to `main`, plus version
images for release tags. The overlay builds locally by default, so a branch can
be tested before any image is published. Published images currently target
`linux/amd64`; client device operating systems are independent of that server
architecture. Set `SCEP_IMAGE` to your published GHCR version to use a release
image, then pull it and start with `--no-build` using the same overlay files.
The default image name is `pki-manager-scep:local` for local branch builds.
Use a backend built from the same change, which includes enrollment-state checks.
Cosmian KMS **5.24.0** was used for integration testing. Keep your existing KMS
configuration/version migration procedure; the overlay does not upgrade it.

1. Create a dedicated CA and CA-bound cluster/service token in PKI Manager.
2. Prepare secret files from the repository root:

   ```sh
   umask 077
   mkdir -p docker/scep-secrets
   openssl rand -hex 32 > docker/scep-secrets/challenge
   touch docker/scep-secrets/backend-token docker/scep-secrets/kms-api-key
   ```

   Enter the service token in `backend-token` using your secure editor. Enter the
   KMS API key in `kms-api-key`, or leave this file empty for an unauthenticated
   internal development KMS. These files are ignored by Git. Provision the
   challenge securely to devices as their CSR `challengePassword`.

   Compose file-backed secrets retain host ownership. Make them readable by the
   container's UID 10001, for example after editing:

   ```sh
   sudo chown 10001:10001 docker/scep-secrets/*
   sudo chmod 0400 docker/scep-secrets/*
   ```

3. Start the existing backend/KMS stack using its documented configuration, then
   build and provision the SCEP RA once:

   ```sh
   cd docker
   docker compose -f docker-compose.yml -f docker-compose.scep.yml --profile scep build scep
   docker compose -f docker-compose.yml -f docker-compose.scep.yml --profile scep run --rm scep provision
   docker compose -f docker-compose.yml -f docker-compose.scep.yml --profile scep up -d scep
   ```

   Provision refuses to overwrite existing RA state. `scep-state` is a persistent
   Docker volume; keep its public metadata together with your KMS backups. A
   partial provisioning failure may leave an orphaned RA key/certificate in KMS:
   investigate the KMS audit trail before retrying. The gateway never exports a
   private key to recover from failures.

4. Verify internally:

   ```sh
   curl -f 'http://127.0.0.1:8085/scep?operation=GetCACaps'
   curl -f 'http://127.0.0.1:8085/scep?operation=GetCACert' -o /tmp/scep-ca-ra.p7b
   openssl pkcs7 -inform DER -in /tmp/scep-ca-ra.p7b -print_certs -noout
   ```

5. Expose **only `/scep`** through your TLS reverse proxy. For example, a host-based
   nginx proxy can forward it to the loopback-bound gateway:

   ```nginx
   location = /scep {
       client_max_body_size 1m;
       proxy_read_timeout 180s;
       proxy_pass http://127.0.0.1:8085;
   }
   ```

   For a proxy in a container, attach it to the same private Docker network and use
   `http://scep:8085`. Set the device's SCEP URL to
   `https://your-pki-host.example/scep`. Do not put interactive OIDC middleware in
   front of this path. Keep backend/KMS inaccessible from devices and apply
   connection/rate limits at the reverse proxy. The service limits message size
   to 1 MiB and concurrent requests to eight; enrollment is serialized.

Changing `SCEP_EXTERNAL_PORT` or `SCEP_VALIDITY_DAYS` in `docker/.env` customizes the
port/leaf duration. Compose secret source paths may be changed through
`SCEP_BACKEND_TOKEN_FILE`, `SCEP_CHALLENGE_FILE`, and `SCEP_KMS_API_KEY_FILE`.
They are resolved relative to `docker/docker-compose.yml`.

The RA has the configured issuance duration too (90 days by default). Monitor its
expiry. To replace it, stop the gateway, archive its old public `ra.json`, then
run `provision` and start again; revoke/retire the old RA certificate and KMS key
through your normal process. Existing device certificates do not depend on the
RA's continued validity. Clients must rediscover CA/RA certificates after RA
replacement. Do not delete the KMS key before retaining required metadata.

## Local development and configuration

Go 1.27.3 is used in CI and Docker. Copy `.env.example` to your local `.env`, edit
paths, and explicitly export/load these values in your shell. The executable does
not automatically source `.env` files.

```sh
cd scep
go mod download
go build -o scep-server .
./scep-server provision
./scep-server serve
```

| Variable | Default / requirement |
| --- | --- |
| `SCEP_AUTH_MODE` | `shared`, `intune`, or `webhook`; default `shared` |
| `SCEP_BACKEND_URL` | `http://127.0.0.1:52081`; existing PKI backend |
| `SCEP_BACKEND_TOKEN` or `_FILE` | Required CA-bound service token |
| `SCEP_KMS_URL` | `http://127.0.0.1:42998` |
| `SCEP_KMS_API_KEY` or `_FILE` | Optional, according to KMS policy |
| `SCEP_CHALLENGE` or `_FILE` | Shared mode only; 32–256 bytes |
| `SCEP_STATE_FILE` | `./data/ra.json`; public RA metadata |
| `SCEP_LISTEN` | `:8085`; use loopback when running outside Docker |
| `SCEP_VALIDITY_DAYS` | `90`, allowed 1–365 |

Do not set a secret and its `_FILE` variant together. Secret values, requests and
challenge passwords are not logged. JSON events on stderr record enrollment
success/rejection and provisioning; forward those to your log collector. Protect
KMS/backend credentials as high-privilege service credentials. Internal HTTP is
intended for a private trusted network; use HTTPS URLs for remote services. The
HTTP clients refuse redirects and preserve TLS verification.

A CSR must include `challengePassword` and `extendedKeyUsage=clientAuth`. Optional
keyUsage is limited to `digitalSignature,keyEncipherment`; explicit CA:false is
preserved without duplicating basicConstraints. Managed SANs are retained in the
issued certificate. DNS/IP/email are indexed in existing backend metadata; URI/UPN
remain in the certificate and are not new dedicated GUI fields. Configure the device's
SCEP client to use RSA and this profile. A plain CSR or a REST `/sign` request is
not a SCEP enrollment: the device must sign and encrypt the SCEP CMS envelope.
CA trust must be established out of band, even though GetCACert is public.

## Tests

```sh
cd scep
go mod verify
go test -race ./...
go vet ./...
```

Unit/protocol tests cover signed/encrypted enrollment, HTTP discovery, legacy GET,
challenge rejection, signature/CSR key binding, managed SAN policy, renewal, request limits,
signed failure replies and the KMS adapter. Tests use ephemeral **client/test**
keys; production RA keys stay in KMS.

Opt-in checks create real keys/certificates, so use an isolated test KMS/CA:

```sh
SCEP_TEST_KMS_URL=http://127.0.0.1:42998 go test -run TestLiveKMS -v
SCEP_TEST_SERVER_URL=http://127.0.0.1:8085/scep \
  SCEP_TEST_CHALLENGE_FILE=/secure/path/to/test-challenge \
  go test -run TestLiveEnrollment -v
```

The KMS test verifies Sign/Decrypt and denial of private-key export. The live
server test verifies CA/RA discovery, authenticated enrollment, a CA-signed
certificate for the client's original key, and an idempotent retry.

## Other MDM providers

`SCEP_AUTH_MODE=webhook` enables the managed profile without claiming compatibility
with a specific MDM product. Set an HTTPS `SCEP_MDM_VALIDATION_URL` and a protected
`SCEP_MDM_VALIDATION_TOKEN` (or `_FILE`, minimum 32 bytes). Requests use bearer
service authentication and contain `transactionId`, `certificateRequest` (base64
DER PKCS#10) and `csrSha256` (hex SHA-256). The validator must inspect the complete
CSR, verify its dynamic challenge and MDM policy, and return:

```json
{"approved": true, "csrSha256": "THE_EXACT_REQUEST_CSR_HASH"}
```

Only HTTP 200 plus both exact approval fields authorizes issuance. Rejection,
timeouts, invalid JSON or a different hash fail closed. A webhook that always
returns approval is not a valid MDM integration. Fresh validation is required on
every renewal too; certificate-only renewal without a challenge is unsupported.
This adapter does not invent a third party's revocation API; use the backend's
CA-bound `/api/v1/external/revoke` integration and CRL distribution as appropriate.

For Docker, add `docker/docker-compose.mdm.yml` after the base SCEP overlay, set
`SCEP_MDM_VALIDATION_URL`, and prepare `docker/scep-secrets/mdm-validation-token`
with UID/GID 10001 and mode 0400. As with Intune mode, the base challenge file may
be empty and is not an authorization fallback. Do not combine the Intune and
webhook overlays: select one enrollment authority per gateway.
