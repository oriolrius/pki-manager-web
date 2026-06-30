# Decision 010 — CRL Signing Approach: Export CA Key vs KMIP Sign

- **Status:** Accepted
- **Date:** 2026-06-29
- **Task:** TASK-110 (milestone: CRL Signing & Distribution)
- **Deciders:** Backend / PKI

## Context

CRL signing was unimplemented: `crl.service.ts` stored `crl_pem = ''` and the public
`GET /crl/:caId.crl` returned 503. The CA private key lives in the **Cosmian KMS**
(TASK-109.22), so signing a CRL faces the same fork as certificate signing:

- **(a) KMIP `Sign`** over the DER-encoded `TBSCertList` — the CA key never leaves the
  KMS. This is the security-preferred option and the documented default for TASK-110.
- **(b) Export the CA key** via the KMIP `Get` (KMS `getPrivateKey`) and sign offline with
  `node-forge` — simpler, reuses the existing `crypto/crl.ts` CRL builder, but the CA
  private key transits backend memory.

For certificates the project uses a third option that has no CRL analogue: the KMIP
`Certify` operation, which signs an X.509 **certificate** server-side. CRLs are not
certificates, so `Certify` cannot produce them.

## Investigation (the spike)

`backend/src/kms/spike-crl-sign.ts` probed a live **Cosmian KMS 5.24.0** for the KMIP
`Sign` operation:

1. `Query(QueryOperations)` **advertises** both `Sign` and `SignatureVerify`.
2. But `Sign` against a freshly created **RSA-2048** private key returns
   `422 Item_Not_Found: Sign: no valid key for id: <id>`.
3. The same `Sign` against an **ECDSA P-256** private key fails identically.
4. Re-creating the RSA key with the explicit KMIP `Sign` usage-mask bit does not help.

**Conclusion:** Cosmian 5.24 exposes `Sign`/`SignatureVerify` only for its
post-quantum / Covercrypt key types, **not** for the classical RSA/ECDSA keys our CAs
use. Option (a) is therefore **not viable** with the KMS we run. (A raw-RSA-via-`Decrypt`
trick to emulate signing was considered and rejected as fragile and padding-dependent.)

## Decision

**Adopt approach (b): export the CA private key from the KMS for the duration of a CRL
build and sign the `TBSCertList` with `node-forge` (`crypto/crl.ts`).**

This is **consistent with the existing codebase**, not a new weakening: `getPrivateKey`
is already used by `ca.routes.ts` (PKCS#12/PEM bundle export), `bulk.routes.ts`, and
`certificate.routes.ts`. The strict "CA key stays in the KMS" guarantee already applies
only to the external `/sign` Certify path, which is unaffected by this decision.

## Threat-model rationale

- The CA private key is exported **in memory only**, for the duration of one CRL
  generation, and is never written to disk or returned to any client.
- Every export is recorded in `audit_log` via `kms.get_private_key` (success and
  failure), and CRL generation writes its own `crl.generate` audit row.
- The exposure window is identical to existing CA-bundle/keystore export paths, so the
  blast radius is unchanged from the already-accepted baseline.
- In the dev KMS, keys are returned `AsRegistered` (unwrapped); a production deployment
  can wrap exports, but the signing code path is the same.

## Consequences / future path

- `crl.service.ts` calls `kmsService.getPrivateKey(ca.kmsKeyId, ca.id)` and
  `generateCRL()` to produce a real, openssl-verifiable X.509 v2 CRL (TASK-111).
- If a future Cosmian release implements `Sign` for RSA/ECDSA — or if CA keys move to a
  post-quantum scheme that `Sign` already supports — CRL signing can switch to option (a)
  by replacing the `getPrivateKey` + `node-forge` block with a KMS `sign()` call, with no
  change to callers or the served CRL format.

## Verification

The chosen approach produces a valid CRL (TASK-110 AC#2): `openssl crl -noout -text`
parses it and `openssl` verifies its signature against the issuing CA certificate. See
TASK-111 for the implementation and its tests.
