---
id: TASK-173
title: >-
  KRLC-02a: Spike - prove native P-256 ECIES round-trip (node encrypt <-> Go
  decrypt with ssh_host_ecdsa_key)
status: To Do
assignee: []
created_date: '2026-07-02 04:36'
labels:
  - ssh-cert-manager
  - backend
  - crypto
  - spike
milestone: SSH KRL Client Distribution
dependencies: []
priority: high
ordinal: 1.5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GATE spike (mirrors decision-013's TASK-144) that must PASS before the KRLC-02 rebuild is committed: empirically prove a native P-256 ECIES round-trip where the BACKEND encrypts with node:crypto to a host's ECDSA nistp256 PUBLIC key and a GO program decrypts LOCALLY with the real OpenSSH private key /etc/ssh/ssh_host_ecdsa_key (parsed via golang.org/x/crypto/ssh.ParseRawPrivateKey -> *ecdsa.PrivateKey -> crypto/ecdh), with the KMS NOT involved at all. Pin the exact envelope: ECDH(P-256) -> HKDF-SHA256(salt/info) -> AES-256-GCM; wire framing ephemeral-pubkey(65B uncompressed) || nonce(12B) || ciphertext || tag(16B). Deliver reproducible scripts (a node encrypt side + a Go decrypt side), confirm loading the OpenSSH-format ecdsa host key in Go and converting the OpenSSH ecdsa-sha2-nistp256 pubkey line to an encryptable point in node, and write a checked-in wire-format spec that becomes the SINGLE interop contract for KRLC-02 (backend) and KRLC-04 (client). Record a go/no-go outcome table. If the round-trip cannot be made to interoperate, the spike says INFEASIBLE and blocks the rebuild rather than proceeding.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A node:crypto-produced ciphertext (pinned envelope) encrypted to a real /etc/ssh/ssh_host_ecdsa_key.pub is decrypted byte-exactly by a Go program using ONLY the local /etc/ssh/ssh_host_ecdsa_key, with no KMS/network call - proving cross-implementation interop
- [ ] #2 The exact ECIES envelope (curve, ECDH, HKDF params, AEAD, byte framing) is written up as a checked-in wire-format spec and is the single contract KRLC-02 and KRLC-04 implement
- [ ] #3 A reproducible go/no-go outcome is recorded (command included); if the round-trip cannot be made to work the spike declares it INFEASIBLE and flags KRLC-02/KRLC-04 as blocked
<!-- AC:END -->
