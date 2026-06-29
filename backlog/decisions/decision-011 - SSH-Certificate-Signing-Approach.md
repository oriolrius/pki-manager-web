---
id: decision-011
title: SSH Certificate Signing Approach
date: '2026-06-29 15:48'
status: Proposed
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
("Cosmian rejects EC Sign") is unverified here and is contradicted by the PoC. This decision is
therefore settled empirically by the SSH-SENS spike (TASK-117) against the live KMS, and binds
the signer (SSH-03 / TASK-120) and the pinned detached-signature format (SSH-04 / TASK-121).

## Decision

Prefer the NON-exportable signing path and keep SSH CA keys `--sensitive true`. The SSH-SENS
spike probes the live KMS for: (a) KMIP-JSON Sign on a sensitive ECDSA-P256 key; (b) Cosmian
native `ec sign` on the same; (c) whether a non-sensitive EC key exports in a Node-importable
layout (SEC1/PKCS#8, with a normalization helper if needed).

- If (a) OR (b) yields a usable signature, adopt the non-exportable native-sign path; the CA
  key never leaves KMS.
- In-memory export-and-sign is a documented DOWNGRADE adopted ONLY if both Sign paths are
  proven impossible, and then with: the exported buffer zeroized after one op, a named risk
  owner, and a loud audit + alert on every CA-key export.

`kmsService.signRaw(keyId, data, {hash, format})` (SSH-03) is the single function whose body
differs between the two modes; all callers (cert signer, KRL detached signature) are unchanged
across the swap. The pinned detached-signature format (DER vs raw r||s) is fixed in SSH-04 so
the KRL service (SSH-21) and the deferred puller (SSH-24) share one verifier regardless of
whether the signature came from Node export-and-sign or Cosmian native `ec sign`. Status stays
Proposed until the SSH-SENS spike records its result.

## Consequences

- Security posture matches the PoC: a non-exportable CA key bounds the blast radius of a
  backend compromise to time-limited signing, not permanent key theft.
- A single seam (`signRaw`) means the signing backend can change without touching cert/KRL
  callers, and CRL signing can later adopt the same seam.
- The spike skips (not fails) when `KMS_URL` is unreachable, so CI without a KMS is unaffected.
- If export-and-sign is unavoidable, the residual risk is explicit, owned, and loudly audited
  rather than silent — and the decision records the exact KMS key-creation flags so issuance
  does not fail at runtime against a sensitive key.

## Related tasks

- TASK-117 (SSH-SENS) — the empirical spike that decides this.
- TASK-120 (SSH-03) — the `signRaw` seam + SSH ECDSA signer.
- TASK-121 (SSH-04) — pins the detached-signature format end-to-end.
