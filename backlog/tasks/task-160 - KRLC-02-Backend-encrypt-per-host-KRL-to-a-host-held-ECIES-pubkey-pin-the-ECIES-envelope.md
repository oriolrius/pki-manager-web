---
id: TASK-160
title: >-
  KRLC-02: Rebuild per-host KRL encryption for LOCAL host decryption (retire
  KMS-resident ECIES)
status: To Do
assignee: []
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 04:15'
labels:
  - ssh-cert-manager
  - backend
  - kms
  - revocation
milestone: SSH KRL Client Distribution
dependencies: []
priority: high
ordinal: 2
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rebuild the SSH-24 encrypted KRL distribution so decryption is ALWAYS local on the host and the KMS is NEVER involved in en/decrypting the KRL. Replace the current KMS-resident model (registerHostEciesKey -> KMIP CreateKeyPair inside the KMS; POST /api/v1/external/ssh/krl -> KMIP Encrypt to ssh_hosts.kms_pubkey_id; host decrypts by CALLING the KMS) with a NATIVE backend implementation (node:crypto) that encrypts the payload to the host's OWN public key: by default the host's already-registered ECDSA nistp256 SSH host public key (ssh_hosts.opensshHostPubkey), or a host-supplied dedicated ECIES pubkey. Pin a standard, cross-implementation ECIES envelope (P-256 + HKDF-SHA256 + AES-256-GCM; framing ephemeral-pubkey || nonce || ciphertext || tag) as the interop contract the Go client implements. Remove the KMS Encrypt/Decrypt/CreateKeyPair calls from this path, drop/repurpose ssh_hosts.kms_pubkey_id, and migrate existing hosts (re-derive from opensshHostPubkey or re-register). No cosmian/KMS dependency anywhere in the KRL en/decrypt path. This SUPERSEDES the KMS-resident 'adopted model' of decision-013 and the KMS-decrypt parts of SSH-15 (TASK-133) and SSH-24 (TASK-145). The detached CA signature over the KRL is unchanged (separate from ECIES). Write audit_log rows.
<!-- SECTION:DESCRIPTION:END -->
