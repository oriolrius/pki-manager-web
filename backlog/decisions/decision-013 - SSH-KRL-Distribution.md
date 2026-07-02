---
id: decision-013
title: SSH KRL Distribution
date: '2026-06-29 15:48'
status: Accepted
---
> [!IMPORTANT]
> **Partially SUPERSEDED by [decision-015 — SSH KRL Client Decryption Model](decision-015%20-%20SSH-KRL-Client-Decryption-Model.md).**
> The KMS-resident ECIES *adopted model* below — the host's ECIES key living inside the
> Cosmian KMS and the host decrypting **via the KMS** — is retired by the KRL Client
> Distribution milestone (doc-007, KRLC-02) in favour of **local-key** decryption: the
> backend encrypts natively (`node:crypto`) to the host's own SSH host key and the host
> decrypts in-process, never calling the KMS. **Still in force:** the GUARANTEED bare
> CA-signed + TLS-served public KRL (SSH-22 / TASK-142) below is unchanged and remains the
> primary revocation mechanism.

## Spike outcome (TASK-144, reproducible — `KMS_URL=… npx tsx src/kms/spike-ssh-ecies.ts`)

ECIES is **VIABLE** against the live Cosmian KMS for nistp256 — all probes PASS:

| Probe | Result |
|---|---|
| Register a per-host EC keypair tagged by host_id | PASS (KMS-resident model) |
| Locate-by-tag | PASS (resolves the host's key) |
| `ec encrypt` → `ec decrypt` round-trip | PASS (plaintext recovered exactly) |
| KMIP-JSON `Encrypt`/`Decrypt` (no CLI dependency) | PASS — ECIES round-trips via pure KMIP |

**Adopted model** *(SUPERSEDED by decision-015 — local-key decryption; retained for history)***:** the host's ECIES key is a **KMS-resident** EC P-256 keypair tagged
by host (matching `host_puller.sh` `HOST_PRIV_KEY_ID`); the backend stores the public
key id on `ssh_hosts.kms_pubkey_id` at registration, so no locate-by-tag is needed at
distribution time. The backend ECIES-encrypts via KMIP `Encrypt` (no CLI dependency);
the host decrypts via the KMS with its private key id. SSH-15 and SSH-24 proceed.

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
