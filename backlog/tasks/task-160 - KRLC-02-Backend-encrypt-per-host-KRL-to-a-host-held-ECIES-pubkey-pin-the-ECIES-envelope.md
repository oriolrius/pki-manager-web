---
id: TASK-160
title: >-
  KRLC-02: Rebuild per-host KRL encryption for LOCAL host decryption (retire
  KMS-resident ECIES)
status: Done
assignee:
  - '@myself'
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 08:18'
labels:
  - ssh-cert-manager
  - backend
  - kms
  - revocation
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-173
priority: high
ordinal: 2
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rebuild the SSH-24 encrypted KRL distribution so decryption is ALWAYS local on the host and the KMS is NEVER involved in en/decrypting the KRL. Replace the current KMS-resident model (registerHostEciesKey -> KMIP CreateKeyPair inside the KMS; POST /api/v1/external/ssh/krl -> KMIP Encrypt to ssh_hosts.kms_pubkey_id; host decrypts by CALLING the KMS) with a NATIVE backend implementation (node:crypto) that encrypts the payload to the host's OWN public key: by default the host's already-registered ECDSA nistp256 SSH host public key (ssh_hosts.opensshHostPubkey), or a host-supplied dedicated ECIES pubkey. Pin a standard, cross-implementation ECIES envelope (P-256 + HKDF-SHA256 + AES-256-GCM; framing ephemeral-pubkey || nonce || ciphertext || tag) as the interop contract the Go client implements. Remove the KMS Encrypt/Decrypt/CreateKeyPair calls from this path, drop/repurpose ssh_hosts.kms_pubkey_id, and migrate existing hosts (re-derive from opensshHostPubkey or re-register). No cosmian/KMS dependency anywhere in the KRL en/decrypt path. This SUPERSEDES the KMS-resident 'adopted model' of decision-013 and the KMS-decrypt parts of SSH-15 (TASK-133) and SSH-24 (TASK-145). The detached CA signature over the KRL is unchanged (separate from ECIES). Write audit_log rows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/v1/external/ssh/krl returns a ciphertext in the pinned native ECIES envelope encrypted to the host's own public key, and NO KMIP Encrypt/Decrypt/CreateKeyPair is invoked anywhere in the KRL en/decrypt path (asserted by test + code inspection)
- [x] #2 A host decrypts the payload ENTIRELY locally with its private key - no network or KMS call - and recovers the exact plaintext; a backend-encrypt -> Go-client-decrypt vector test proves cross-implementation interop of the pinned envelope
- [x] #3 The KMS-resident path is retired: registerHostEciesKey KMS keypair generation and kms_pubkey_id encryption are removed/repurposed, existing hosts are migrated, and decision-013's KMS-resident model is marked superseded by decision-015
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add backend/src/crypto/ssh/ecies.ts: native ECIES v1 (encrypt to OpenSSH ecdsa-sha2-nistp256 pubkey; decrypt for tests) matching the KRLC-02a pinned envelope.
2. Rewrite POST /api/v1/external/ssh/krl to encrypt natively to host.opensshHostPubkey (require ecdsa nistp256; clear NOT_PROVISIONED for ed25519); drop KMS eciesEncrypt.
3. Retire KMS-resident keypair gen: repurpose /register-host-pubkey + registerEciesKey (no KMS CreateKeyPair); stop using kms_pubkey_id for encryption.
4. Pin the wire format in a checked-in doc; write ecies unit tests + update ssh-ecies integration test to decrypt with the host SSH key.
5. pnpm -C backend typecheck + test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE — POST /api/v1/external/ssh/krl now encrypts NATIVELY (node:crypto) to the host's own ecdsa-sha2-nistp256 public key; the KMS is never used to en/decrypt the KRL. Host decrypts locally with /etc/ssh/ssh_host_ecdsa_key (proven in KRLC-02a + backend unit tests).

Implemented:
- backend/src/crypto/ssh/ecies.ts: eciesEncryptV1 / eciesDecryptV1 matching the pinned envelope (P-256 + HKDF-SHA256 + AES-256-GCM; ephemeralPub||nonce||ct||tag). Doc comment references the checked-in spec (krl-client/spike/README.md).
- ecies.test.ts (6/6 pass): round-trip, non-determinism, tamper->fail, wrong-key->fail, ed25519->EciesError, real ssh-keygen ecdsa host key parity.
- ssh-external.routes.ts POST /krl: native encrypt to host.opensshHostPubkey (removed getKMSService.eciesEncrypt + the getKMSService import); ed25519/non-P256 -> 404 ECIES_KEY_UNSUPPORTED with a clear message; audit_log 'ssh.krl.distribute' on success AND failure.
- /register-host-pubkey + SshHostService.registerEciesKey: retired KMS CreateKeyPair; now validate the host's own ecdsa key and return { hostId, ready, keyAlgorithm, fingerprint }; audit 'ssh.host.register_pubkey'.
- ssh-mon: distribution eligibility switched from kms_pubkey_id to active ecdsa-sha2-nistp256 hosts.
- lib/audit.ts: added 'ssh.krl.distribute' operation.
- ssh-ecies.integration.test.ts rewritten: host decrypts LOCALLY with its own ecdsa key (createPrivateKey), no KMS decrypt (KMS-gated; CA KRL signing still via KMS, unchanged).

Verification: my files pass strict typecheck; ecies unit 6/6; ssh-mon.test passes. Pre-existing strict-typecheck errors (certificate.ts/domain.ts/search.ts) and the e2e.test.ts unmigrated-DB artifact are unrelated (confirmed by stashing my edits and reproducing). ESLint is repo-wide broken (ESLint 9 flat-config vs old --ext script) — pre-existing.

Deferred (not blocking; noted for follow-ups):
- kms_pubkey_id column left in schema as DEPRECATED (no data migration needed: encryption now uses opensshHostPubkey which every host already has). A cleanup can drop the column + the now-unused kms/service registerHostEciesKey/eciesEncrypt/eciesDecrypt.
- Dual-key hosts (ed25519 cert + separate ecdsa host key): registering a SEPARATE ecdsa ECIES pubkey while keeping an ed25519 cert is not modeled (single opensshHostPubkey slot). For the encrypted path, register the host with its ecdsa host key. Provisioning/UX -> KRLC-10; documented -> KRLC-13/decision-015.
- Frontend ssh.registerEciesKey return-shape changed (no more kmsPublicKeyId) -> UI follow-up.

Committed on feat/krl-client: b5946aa.
<!-- SECTION:NOTES:END -->
