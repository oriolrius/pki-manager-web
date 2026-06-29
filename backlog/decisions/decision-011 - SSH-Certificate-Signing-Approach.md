---
id: decision-011
title: SSH Certificate Signing Approach
date: '2026-06-29 15:48'
status: Accepted
---
## Context

The SSH Certificate Manager milestone signs OpenSSH host and user certificates (and the
detached KRL signature) with KMS-held ECDSA-P256 CA keys. The source ssh-certs PoC creates
both CA keys `--sensitive true` (NON-exportable, kms-sign.sh:38) and signs via
PKCS#11/ssh-agent so the CA key NEVER leaves the Cosmian KMS; its distributor signs KRLs with
Cosmian native `ec sign` over nistp256. The synthesized design originally proposed in-memory
export-and-sign (`getPrivateKey` → Node `crypto.sign`), the very path the PoC avoids, which
widens any backend RCE / heap-dump from time-bounded signing access to permanent CA-key theft.

There is no `signRaw` seam on this branch yet (crl.service is still a placeholder), so this
milestone AUTHORS the raw-signing primitive rather than reusing one. The export justification
("Cosmian rejects EC Sign") is **disproven** here. This decision is settled empirically by the
SSH-SENS spike (TASK-117, `backend/src/kms/spike-ssh-sign.ts`) run against the live KMS at
`http://wsl.ymbihq.local:42998` (Cosmian KMS), and binds the signer (SSH-03 / TASK-120) and the
pinned detached-signature format (SSH-04 / TASK-121).

## Spike results (TASK-117, reproducible — `KMS_URL=… npx tsx src/kms/spike-ssh-sign.ts`)

| Probe | Result |
|---|---|
| (a) KMIP-JSON `Sign` on a `Sensitive=true` ECDSA-P256 key | **PASS** — returns a DER/ASN.1 ECDSA signature (~72 B, `30 46…`); KMS hashes SHA-256 server-side; validated by KMIP `SignatureVerify`. CA key never leaves KMS. |
| (b) Cosmian native `cosmian kms ec sign` on the same key | **PASS** — byte-compatible DER signature; also `SignatureVerify`-valid. |
| (c) Non-sensitive EC key: KMIP `Get` (PKCS#8) → Node `createPrivateKey` + sign | **PASS** — exported key imports directly into Node `crypto` (the fallback works, but is NOT adopted). |
| (d) `Get` (export) of a `Sensitive=true` private key | **DENIED** — `Sensitive: DENIED`. Non-exportability confirmed. |

Non-obvious KMS mechanics the spike pinned (carried into SSH-05/SSH-10/SSH-03):

1. **Key lifecycle:** `CreateKeyPair` yields **PreActive** keys; `Sign`/`SignatureVerify` reject
   them with `Item_Not_Found: no valid key for id` until both the private and public key are
   **`Activate`d**. CA creation MUST issue `Activate` after `CreateKeyPair`.
2. **EC create recipe (pure KMIP-JSON, no CLI):** `CryptographicAlgorithm=ECDSA`,
   `CryptographicDomainParameters.RecommendedCurve="P256"` (NOT `P_256`/`P-256`/`secp256r1` —
   those are rejected), `CryptographicUsageMask=3` (Sign|Verify — without a Sign usage the key
   signs nowhere even once Active), `Sensitive=true`.
3. **Sign call:** `CryptographicParameters {CryptographicAlgorithm=ECDSA, HashingAlgorithm=SHA256}`
   + `Data` as a hex `ByteString` → `SignResponse.SignatureData` (hex DER).
4. **Signature format from the KMS is DER/ASN.1.** OpenSSH in-cert signatures need DER → fixed-width
   `r||s` → ssh-string-wrapped mpints (SSH-03); SSH-04 pins the detached format.
5. **EC public key from KMIP `Get` is NOT a Node-importable SPKI** (local `createPublicKey`
   fails `DECODER unsupported`); server-side `SignatureVerify` is authoritative for now, and
   SSH-02/SSH-10 must convert the EC point to SPKI / the `ecdsa-sha2-nistp256 AAAA…` OpenSSH line.
6. The same KMS advertises `Encrypt`/`Decrypt`/`Locate`/`Register`/`SignatureVerify` over
   KMIP-JSON — de-risking the SSH-23 ECIES + SSH-15 host-pubkey-register path (verify in SSH-23).

## Decision

ADOPT the **non-exportable** signing path. SSH CA keys are created `Sensitive=true` (and
`Activate`d), and `kmsService.signRaw()` signs via **KMIP-JSON `Sign`** — chosen over the
Cosmian CLI because it needs no `cosmian` binary in the backend container and reuses the
existing `KMSClient` HTTP/KMIP transport. The CA private key never leaves the KMS.

In-memory export-and-sign is **NOT adopted** (both Sign paths work). It remains documented only
as an emergency fallback; were it ever needed it would require buffer zeroization after one op,
a named risk owner, and a loud audit + alert on every CA-key export.

`kmsService.signRaw(keyId, data, {hash, format})` (SSH-03) is the single seam; all callers (cert
signer, KRL detached signature) are unchanged if the backend ever swaps. SSH-04 pins the
detached-signature format (DER) so the KRL service (SSH-21) and the puller (SSH-24) share one
verifier.

## Consequences

- Security posture matches the PoC: a non-exportable CA key bounds a backend compromise to
  time-limited signing, not permanent key theft. `getPrivateKey()` is not on the SSH signing path.
- SSH-05/SSH-10 must add `Sensitive=true` + `Activate` + `RecommendedCurve="P256"` +
  `CryptographicUsageMask=3` to the KMIP `CreateKeyPair` (the existing `createKeyPair` does none
  of these). SSH-03 must DER→`r||s` convert. SSH-02/SSH-10 must convert the EC public key.
- A single seam (`signRaw`) means CRL signing (TASK-110-series, other branch) can later adopt it.
- The spike skips (exit 0) when `KMS_URL` is unreachable, so CI without a KMS is unaffected.

## Related tasks

- TASK-117 (SSH-SENS) — the empirical spike that decided this. **Done.**
- TASK-120 (SSH-03) — the `signRaw` seam + SSH ECDSA signer (DER→r||s).
- TASK-121 (SSH-04) — pins the detached-signature format end-to-end.
- TASK-122 (SSH-05) / TASK-127 (SSH-10) — must create CA keys Sensitive + Active per the recipe above.
