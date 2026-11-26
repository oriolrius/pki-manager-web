---
id: decision-018
title: 018 - Replace Cosmian KMS with a KeyStore abstraction backed by OpenBao Transit
date: '2026-11-24T17:09:00Z'
status: Accepted
---
## Context

The following assessment predates acceptance. The implementation plan below governs delivery.

PKI Manager keeps every private key (and, today, every certificate) in a **Cosmian KMS**
(now "Eviden KMS"), spoken to as KMIP 2.1 JSON over HTTP (`backend/src/kms/`). We like its
features but not its licence. This record captures (1) what the code really uses the KMS
for, (2) the licence problem, (3) the alternatives, (4) a full Cosmian vs OpenBao feature
comparison, and (5) the proposed design and migration.

### 1. Licence problem (verified)

`Cosmian/kms` `LICENSE` (branch `develop`, read 2026-11-24):

- **BUSL-1.1**, Licensed Work = Cosmian KMS **4.11.3 or later**.
- Additional Use Grant: production use only if total use **≤ 2 vCPU on VMs or 1 physical
  core on bare metal**, and **not offered to third parties**.
- Change Date: 4 years after each version is published → **MPL-2.0**.
- Otherwise: buy a commercial licence or stop using it.

Production (`pki-kms` on **k5**, bare-metal Xeon E-2236, 6 cores / 12 threads, KMS 5.24.0)
runs the container **without a CPU limit**, so current use is probably **outside** the grant.
(This is a reading of the licence text, not legal advice.)

### 2. What the code uses the KMS for (code audit)

About 100 call sites in 12 files. Grouped by function:

| # | Function | Where | Cosmian coupling |
|---|---|---|---|
| A | **X.509 certificate building** via KMIP `Certify`: DN field by field (`CertificateSubjectCn`…, plus 16 empty "required" fields), extensions as an OpenSSL `v3_ca` string in the Cosmian vendor attribute `x509-extension`, validity in vendor attribute `requested_validity_days`, CSR mode with `CertificateRequestValue` + `preserveCsrKey` | `kms/client.ts:422-961`; callers `ca.service`, `certificate.service`, `trpc/procedures/certificate.ts`, `rest/routes/bulk.routes.ts`, `rest/routes/external.routes.ts`, `ra.service` | **Very high**: 100 % vendor-specific |
| B | **Certificate store**: `certificate_authorities` has **no `certificate_pem`** column (CA cert exists only in the KMS); `certificates.kms_certificate_id` is `NOT NULL`; many paths call `getCertificate()` | `db/schema.ts:20,65`, `server.ts:108`, `crl.service.ts:169`, routes | High, easy to miss |
| C | **Key-pair generation**: RSA-2048/3072/4096, ECDSA P-256/P-384 | `createKeyPair` | Low |
| D | **Private-key export** (PKCS#8): leaf PKCS#12/JKS/PEM bundles **and CA keystores** (`ca.routes.ts:957,1006`) | `getPrivateKey`, ~25 call sites | Low |
| E | **CRL signing**: exports the CA key, signs `TBSCertList` with `nodeCrypto.sign` | `crl.service.ts:226`, `crypto/crl.ts:223` (decision-010) | Low |
| F | **Non-exportable SSH CA keys**: ECDSA P-256 `Sensitive=true` + `Activate`, KMIP `Sign` → DER, `SignatureVerify` probe | `ssh-ca.service`, `ssh-cert.service`, `ssh-krl.service`, `ssh-host-krl.service` (decision-011) | Medium |
| G | **SCEP RA key**: RSA-3072 `Sensitive=true`, `Sign` over `DigestedData` (PKCS#1 v1.5) and **`Decrypt` RSA PKCS#1 v1.5** (CMS key transport) | `ra.service.ts:69-176`, `scep/remote_ra.go` | Medium |
| H | Key links (`PublicKeyLink` / `PrivateKeyLink`), revoke, destroy | `getCertificatePrivateKeyId`, `getPublicKeyIdForPrivateKey`, `destroyKey` | Low |
| — | **Dead code**: `createEcEncryptionKeyPair` / `ecEncrypt` / `ecDecrypt` (ECIES is local since decision-015); only `ssh-host.service.ts:423` still destroys a legacy `kmsPubkeyId` | `kms/client.ts:1110-1158` | Remove |

Security facts found during the audit:

- **X.509 CA keys are exportable** (CRL generation and CA PKCS#12/JKS export read them). The
  KMS does **not** make X.509 CA keys non-exportable; only SSH CA keys (F) and the RA key (G) are.
- **Production KMS has no authentication** (runbook: "it has no authentication";
  `KMS_API_KEY` empty). Network isolation (`pki_net`, no host port) is the only control.
- Keys sit **unwrapped** in the KMS SQLite (`/docker-data/pki/kms`, `0700 root`); no HSM, no
  key wrapping configured.
- decision-010 (RSA/ECDSA `Sign` not usable) is **stale**: decision-011 proved ECDSA `Sign` on
  5.24, and `ra.service` uses RSA `Sign` with `DigestedData` (tested on 5.28.0).

Conclusion: what we really get from Cosmian is **A + B** (certificate building and storage)
and **non-exportable keys in a separate process (F, G)**. That is the value and the lock-in.

### 3. Alternatives considered

| Option | Licence | Verdict |
|---|---|---|
| **OpenBao** (Vault fork, Linux Foundation), Transit engine | **MPL-2.0** (verified) | **Chosen** (see §4, §Decision) |
| HashiCorp Vault | BUSL-1.1 | Same licence problem. Rejected |
| SoftHSM2 / YubiHSM 2 / Nitrokey HSM 2 via PKCS#11 (`pkcs11js`, MIT) | BSD-2 / hardware | Covers every operation incl. RSA PKCS#1 v1.5 decrypt. SoftHSM is a **library loaded in the backend process** → no process isolation, no auth, no audit. Keep as a secondary adapter / real-hardware path |
| Kryoptic (Red Hat, PKCS#11 in Rust) | GPL-3.0+ | Same in-process issue + GPL. Rejected |
| PyKMIP | Apache-2.0 | Unmaintained, no `Certify`, Python. Rejected |
| step-ca, EJBCA CE | Apache-2.0 / LGPL | Full CAs, not key stores; overlap the whole product. Rejected |
| AWS / GCP / Azure KMS | Proprietary SaaS | Not self-hosted; no RSA PKCS#1 v1.5 decrypt on AWS. Rejected |
| Keep Cosmian: commercial licence, or pin CPU to fit the grant | Commercial / BUSL | Possible short-term mitigation; keeps the lock-in |

### 4. Feature comparison: Cosmian (Eviden) KMS vs OpenBao

Legend: ✅ yes · ⚠️ partial / with conditions · ❌ no · — not applicable.
Source column: **V** = verified in source/docs/LICENSE on 2026-11-24 · **C** = verified in our
code or a spike · **D** = vendor docs/README, not tested by us · **?** = not verified.

#### 4.1 Licence, project, operations

| Feature | Cosmian / Eviden KMS | OpenBao | Src |
|---|---|---|---|
| Licence | BUSL-1.1 (≤2 vCPU / 1 core prod grant, no 3rd-party offering) → MPL-2.0 after 4 y | MPL-2.0 | V |
| Governance | Single vendor (Cosmian Tech SAS, now part of Eviden) | Linux Foundation community project | V/D |
| Language | Rust | Go | V |
| Current release | 5.29.0 packages (we run 5.24.0 prod, 5.28.0 dev) | v2.7.3 (2026-11-19) | V |
| Container image | `ghcr.io/cosmian/kms` | `ghcr.io/openbao/openbao` / `quay.io/openbao/openbao` | D |
| Web UI | ✅ | ✅ | D |
| CLI | ✅ `ckms` | ✅ `bao` (Vault-CLI compatible) | D |
| Terraform / OpenTofu | ✅ Cosmian provider | ✅ (Vault provider is API-compatible) | D |
| OpenAPI spec | ✅ OpenAPI 3.1 + Swagger UI | ✅ OpenAPI generated from paths | D |
| Metrics / tracing | ✅ OpenTelemetry | ✅ Prometheus telemetry | D |
| FIPS 140-3 | ✅ FIPS mode (default build) | ❌ no validation | D |
| Reproducible builds / SBOM | ✅ Nix, SBOM, CBOM | ⚠️ SBOM in releases | D/? |

#### 4.2 Storage, HA, sealing

| Feature | Cosmian / Eviden KMS | OpenBao | Src |
|---|---|---|---|
| Storage backends | SQLite, PostgreSQL, MySQL/MariaDB/Percona, Redis+Findex | Integrated Raft, PostgreSQL, PebbleDB, in-memory | V |
| High availability | ✅ HA mode + cluster coordination | ✅ Raft cluster, active/standby | V |
| Multi-region active-active | ✅ PostgreSQL+Spock, MySQL Galera | ⚠️ not active-active (Raft is single-leader) | D |
| Encryption of stored keys | ⚠️ only with HSM key wrapping (our prod: unwrapped SQLite) | ✅ always: barrier encryption under the root key | C/D |
| Seal / unseal | ❌ no seal concept | ✅ Shamir, static, transit, **PKCS#11**, **KMIP**, AWS/Azure/GCP/OCI/OVH/AliCloud/Securosys/Tencent | V |
| Backup | DB-level backup | Raft snapshots; per-key `backup`/`restore` in Transit | V |
| Automatic DB migrations | ✅ | ✅ | D |

#### 4.3 Authentication, authorisation, audit

| Feature | Cosmian / Eviden KMS | OpenBao | Src |
|---|---|---|---|
| Auth methods | JWT/OIDC, TLS client certs, API token (our prod: **none**) | token, AppRole, JWT/OIDC, TLS cert, Kubernetes, LDAP, Kerberos, RADIUS, userpass, login MFA | V (OpenBao) / D (Cosmian) |
| Authorisation model | Per-object access rights (owner grants ops to users) | Path-based ACL policies (HCL), CEL, control groups, resource quotas, profiles | V/D |
| Multi-tenancy | Per-user ownership | ✅ Namespaces | V |
| Audit log | Server logs | ✅ Audit devices (file / syslog / socket), HMAC-ed secrets | D |
| Response wrapping | ❌ | ✅ | V |
| Our current exposure | No auth, network isolation only | Would require AppRole/token → strictly better | C |

#### 4.4 Key types and algorithms

| Feature | Cosmian / Eviden KMS | OpenBao Transit | Src |
|---|---|---|---|
| RSA 2048 / 3072 / 4096 | ✅ | ✅ `rsa-2048/3072/4096` | C / V |
| ECDSA P-256 / P-384 / P-521 | ✅ (we use P-256/P-384) | ✅ `ecdsa-p256/p384/p521` | C / V |
| Ed25519 | ✅ | ✅ | D / V |
| secp256k1 | ✅ (non-FIPS) | ❌ | D / V |
| AES / ChaCha20 symmetric | ✅ AES (+ others) | ✅ AES-128/256-GCM96, ChaCha20-Poly1305, XChaCha20-Poly1305 | D / V |
| HMAC keys | ✅ | ✅ | D / V |
| Post-quantum | ✅ Covercrypt (+ others, not verified) | ✅ ML-DSA-44/65/87 | D / V |
| Format-preserving encryption (FF1) | ✅ (non-FIPS) | ❌ (transform engine is Vault Enterprise) | D |
| OpenPGP keys | ✅ (non-FIPS) | ❌ | D |

#### 4.5 Key lifecycle

| Feature | Cosmian / Eviden KMS | OpenBao Transit | Src |
|---|---|---|---|
| Generate key pair server-side | ✅ `CreateKeyPair` | ✅ `transit/keys/:name` | C / V |
| Non-exportable private key | ✅ `Sensitive=true` (export → `DENIED`) | ✅ `exportable=false` (default) | C / V |
| Exportable private key | ✅ `Get` PKCS#8 `AsRegistered` | ✅ `exportable=true` (irreversible) + `transit/export/signing-key` | C / V |
| Secure (wrapped) export to another instance | ✅ KMIP key wrapping | ✅ "Securely export key" (BYOK export) | D / V |
| Import (BYOK) private key | ✅ KMIP `Import`/`Register` | ✅ `keys/:name/import` (RSA-OAEP wrapped), RSA + ECDSA | D / V |
| Import public key only | ✅ | ✅ | D / V |
| Key states (PreActive / Active / Deactivated / Compromised) | ✅ full KMIP state machine (must `Activate`) | ⚠️ no states; versions + `min_decryption_version` / `min_encryption_version` | C / V |
| Key versions / rotation | ✅ re-key + scheduled auto-rotation policy | ✅ versioned key ring, `rotate`, `auto_rotate_period`, `trim` | D / V |
| Revoke | ✅ KMIP `Revoke` (reason codes) | ❌ no revoke; disable versions / delete | C / V |
| Destroy | ✅ `Destroy` (after revoke) | ✅ delete (needs `deletion_allowed=true`), soft delete + restore | C / V |
| Object links (cert ↔ private ↔ public) | ✅ KMIP `Link` attributes | ❌ one named key holds both halves; links live in our DB | C / V |
| Tags / custom attributes / `Locate` search | ✅ tags, vendor attributes, `Locate` | ⚠️ key name + list; metadata in our DB | C / V |

#### 4.6 Cryptographic operations

| Feature | Cosmian / Eviden KMS | OpenBao Transit | Src |
|---|---|---|---|
| ECDSA sign, DER output | ✅ KMIP `Sign` (hashes server-side) | ✅ `transit/sign`, `marshaling_algorithm=asn1` (DER, default) | C / V |
| ECDSA sign over pre-computed hash | ✅ `DigestedData` | ✅ `prehashed=true` | C / V |
| RSA PKCS#1 v1.5 sign (with DigestInfo) | ✅ `DigestedData` + `PKCS1v15` (5.28; not on 5.24 per decision-010) | ✅ `signature_algorithm=pkcs1v15` + `prehashed=true` | C / V |
| RSA-PSS sign | ✅ | ✅ (default `pss`) | D / V |
| Server-side signature verify | ✅ `SignatureVerify` | ✅ `transit/verify` | C / V |
| **RSA PKCS#1 v1.5 decrypt** (SCEP CMS key transport) | ✅ (`ra.service`, 5.28) | ❌ **OAEP-SHA256 only**, and only `vault:v1:` ciphertext (`sdk/helper/keysutil/policy.go:1214`) | C / V |
| RSA-OAEP encrypt/decrypt | ✅ | ⚠️ yes, but in Transit's own envelope format | D / V |
| ECIES | ✅ | ❌ | D / V |
| Data keys, random bytes, hash, HMAC | ✅ | ✅ | D / V |
| Batch operations | ✅ KMIP batch | ✅ `batch_input` | D / V |
| Sign a CSR with a stored key | ✅ | ✅ Transit "Sign CSR" + "Set certificate chain" | D / V |

#### 4.7 PKI and SSH features

| Feature | Cosmian / Eviden KMS | OpenBao | Src |
|---|---|---|---|
| Issue X.509 certificate from a stored key | ✅ KMIP `Certify` (what we use, item A) | ❌ in Transit; ✅ in the **PKI engine** (with its own keys) | C / V |
| Certificate object storage | ✅ (item B) | ❌ in Transit; ✅ in PKI engine | C / V |
| Root / intermediate CA | ✅ | ✅ PKI engine, cross-sign | D / V |
| CRL / delta CRL | ? (we build CRLs locally) | ✅ PKI engine: CRL + delta CRL | ? / V |
| OCSP responder | ? | ✅ PKI engine | ? / V |
| ACME | ? | ✅ PKI engine | ? / V |
| EST (RFC 7030) / SCEP (RFC 8894) | ✅ (per README, develop) | ❌ (not in OpenBao PKI docs) | D / V |
| PKCS#12 export | ✅ | ❌ (we build PKCS#12 ourselves already) | D / C |
| Issuance policies | ❌ | ✅ CEL policies in PKI engine | V |
| SSH CA signing | ⚠️ raw `Sign` (we build OpenSSH certs ourselves) | ✅ SSH engine (signed certificates, OTP); or raw Transit sign | C / V |
| SSH KRL | ❌ (we build KRLs ourselves) | ? | C / ? |

#### 4.8 HSM and external integrations

| Feature | Cosmian / Eviden KMS | OpenBao | Src |
|---|---|---|---|
| HSM-backed keys | ✅ key wrapping by Proteccio, Crypt2pay, Utimaco, SmartCard-HSM/Nitrokey HSM 2, SoftHSM2, AWS/Azure/GCP Cloud HSM | ✅ **External Keys** plugins: PKCS#11, Securosys, Transit — for PKI and Transit engines | V |
| HSM mechanisms through external keys | — | ⚠️ `CKM_ECDSA`, `CKM_EDDSA`, `CKM_ML_DSA`, `CKM_RSA_PKCS_PSS`, `CKM_RSA_PKCS_OAEP`, `CKM_AES_GCM` — **no `CKM_RSA_PKCS` (v1.5)** → HSM-backed RSA X.509 CAs would sign RSA-PSS only | V |
| KMIP server (clients connect to it) | ✅ KMIP 1.0–2.1 binary + JSON TTLV | ❌ (KMIP only as a seal *client*) | V |
| PKCS#11 provider for clients | ✅ PKCS#11 v3.0 module (LUKS, VeraCrypt…) | ❌ | D |
| Cloud key integrations | ✅ AWS XKS v2, Azure EKM, Google Workspace CSE, Microsoft 365 DKE | ❌ | D |
| Database TDE | ✅ Oracle, SQL Server EKM, MongoDB, MySQL, Percona, EDB | ⚠️ via KMIP-less plugins only; databases engine issues DB credentials | D |
| Kubernetes | ✅ K8s KMS provider plugin (etcd encryption) | ✅ Kubernetes auth + secrets engine; K8s KMS via third-party plugins | D |
| Other secret engines | — | ✅ KV, databases, LDAP, RabbitMQ, TOTP, identity, cubbyhole | V |
| Can back the other product | — | Cosmian can act as OpenBao **auto-unseal / KV** backend | D |

#### 4.9 Fit for PKI Manager (items A–H of §2)

| Need | Cosmian today | OpenBao Transit | Action if OpenBao |
|---|---|---|---|
| A. Build X.509 certs | `Certify` | ❌ | Build TBS locally (node-forge), sign via `KeyStore.sign` |
| B. Store certs | KMS objects | ❌ | `certificate_pem` in SQLite (new column on CAs, backfill certs) |
| C. Generate RSA/ECDSA keys | ✅ | ✅ | — |
| D. Export leaf / CA keys | ✅ | ✅ only if `exportable=true` | Preserve authorized leaf and CA exports. |
| E. Sign CRL | export + local sign | ✅ `sign` prehashed | CA key no longer leaves the store (improvement) |
| F. Non-exportable SSH CA, DER ECDSA | ✅ | ✅ | `crypto/ssh/sign.ts` DER→r‖s unchanged |
| G. SCEP RA sign | ✅ | ✅ pkcs1v15 prehashed | — |
| G. SCEP RA decrypt PKCS#1 v1.5 | ✅ | ❌ | Add the session-key operation to the fork. Keep the RA key non-exportable. |
| H. Links / revoke / destroy | ✅ | ⚠️ | Links in DB; destroy = delete |
| Auth to the key store | none in prod | ✅ AppRole | New secret: AppRole role/secret id |
| Licence fits k5 prod | ❌ probably not | ✅ | — |

## Decision

Accepted on 2026-11-26. Replace Cosmian with the PKI Manager fork of OpenBao.
Use existing Transit operations for key management and signing. Add the missing
SCEP session-key operation in the fork. Keep the RA private key inside OpenBao.
PKI Manager owns certificate construction, CRLs, certificate storage and links.

The fork retains MPL-2.0 for covered source. Separate original downstream files use
Apache-2.0. Preserve existing PKI Manager features, including authorized CA and
leaf exports. A later change to export policy requires a separate decision.

## Consequences

The fork needs its own release and update process. PKI Manager needs a gateway
change, an adapter, a certificate backfill and a verified migration for each key
class. Keep Cosmian in service until the fork passes the live application suites
and a restore rehearsal. Acceptance of this decision records the direction.
It does not record a production cutover.

See the [implementation plan](../docs/doc-012%20-%20OpenBao-fork-and-PKI-Manager-migration-plan.md) for the source references, tests,
cutover criteria and rollback limits. The comparison above records the options
assessed before acceptance, including alternatives for SCEP that the fork replaces.

## Sources

- Cosmian KMS LICENSE: https://raw.githubusercontent.com/Cosmian/kms/develop/LICENSE
- Cosmian / Eviden KMS README: https://github.com/Cosmian/kms/blob/develop/README.md
- OpenBao Transit API: https://openbao.org/api-docs/secret/transit
- OpenBao RSA decrypt (OAEP only): https://github.com/openbao/openbao/blob/main/sdk/helper/keysutil/policy.go
- OpenBao External Keys / PKCS#11 plugin: https://github.com/openbao/openbao/tree/main/website/content/docs/api/system/external-keys/plugins
- OpenBao PKI API: https://github.com/openbao/openbao/blob/main/website/content/docs/api/secret/pki.mdx
- pkcs11js: https://npmjs.com/package/pkcs11js · Kryoptic: https://lib.rs/crates/kryoptic
