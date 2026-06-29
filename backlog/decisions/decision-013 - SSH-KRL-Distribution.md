---
id: decision-013
title: SSH KRL Distribution
date: '2026-06-29 15:48'
status: Proposed
---
## Context

SSH revocation needs a delivery mechanism. The guaranteed, always-available path is the BARE
CA-signed-and-TLS-served public KRL: sshd reads `RevokedKeys` bytes directly and does NOT verify
any KRL signature (technical-reference §7.1), so integrity on the public path rests on TLS +
0444 root-owned file perms, with short TTLs (+1w users, +52w hosts) as the PRIMARY revocation
mechanism. This is implemented by SSH-22 (TASK-142) and is fully functional revocation on its
own — it depends on none of the encrypted-distribution machinery.

A second, stronger-confidentiality path is per-host ECIES distribution: encrypt the KRL payload
to each host's own key so the revocation set is not publicly readable. This depends on three
Cosmian capabilities that are referenced-but-not-functional in `client.ts` and unverified for
nistp256: REGISTER of an externally-supplied EC public key as a KMS object, locate-by-tag, and
`ec encrypt`/`ec decrypt` (ECIES) round-trip — including a host decrypting a Cosmian-produced
ciphertext (cross-implementation ECIES compatibility is version-specific).

## Decision

- The bare CA-signed + TLS-served public KRL (SSH-22 / TASK-142) is the GUARANTEED revocation
  mechanism and ships unconditionally.
- Per-host ECIES distribution (host-pubkey registration SSH-15 / TASK-133, and the encrypted
  sidecar + host-side puller SSH-24 / TASK-145) is IN v1 scope but GATED on the SSH-23 spike
  (TASK-144) empirically proving, against the live KMS for nistp256: external-pubkey Register,
  locate-by-tag, AND a host decrypting a Cosmian-encrypted ciphertext.
- If the SSH-23 spike DISPROVES any of those capabilities, the ECIES path is INFEASIBLE (not
  merely degraded): SSH-15 and SSH-24 are DROPPED, and revocation falls back to the bare served
  KRL (SSH-22) with no functional gap.
- The single seam that changes if Cosmian later gains the capability is the KMS client's
  Register/Locate/Encrypt/Decrypt wrappers, added by SSH-23 ONLY if the spike proves they work.
  Status stays Proposed until the SSH-23 spike records its outcome.

## Consequences

- Revocation is never blocked on unverified KMS features; the always-available bare KRL is the
  floor.
- The ECIES path only adds CONFIDENTIALITY of the revocation set (it hides WHICH keys are
  revoked), a bounded gain, so dropping it costs no revocation capability.
- The 404-vs-200 host_id oracle on the ECIES endpoint (registered-or-not) is documented in
  SSH-MON as an accepted, bounded disclosure.
- Host-pubkey registration (SSH-15) is fingerprint-bound to the just-signed cert so a
  mis-binding surfaces as "KRL-undeliverable" rather than silently breaking emergency revocation.

## Related tasks

- TASK-142 (SSH-22) — the guaranteed bare/served public KRL.
- TASK-144 (SSH-23) — the v1 GATE spike whose outcome decides the ECIES path.
- TASK-133 (SSH-15) — host-pubkey KMS registration, gated on SSH-23.
- TASK-145 (SSH-24) — the encrypted distribution sidecar + puller, gated on SSH-23.
