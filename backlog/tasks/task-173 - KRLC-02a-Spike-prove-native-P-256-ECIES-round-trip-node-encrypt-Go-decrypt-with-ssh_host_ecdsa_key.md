---
id: TASK-173
title: >-
  KRLC-02a: Spike - prove native P-256 ECIES round-trip (node encrypt <-> Go
  decrypt with ssh_host_ecdsa_key)
status: Done
assignee: []
created_date: '2026-07-02 04:36'
updated_date: '2026-07-02 07:47'
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
- [x] #1 A node:crypto-produced ciphertext (pinned envelope) encrypted to a real /etc/ssh/ssh_host_ecdsa_key.pub is decrypted byte-exactly by a Go program using ONLY the local /etc/ssh/ssh_host_ecdsa_key, with no KMS/network call - proving cross-implementation interop
- [x] #2 The exact ECIES envelope (curve, ECDH, HKDF params, AEAD, byte framing) is written up as a checked-in wire-format spec and is the single contract KRLC-02 and KRLC-04 implement
- [x] #3 A reproducible go/no-go outcome is recorded (command included); if the round-trip cannot be made to work the spike declares it INFEASIBLE and flags KRLC-02/KRLC-04 as blocked
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
OUTCOME: GO (feasible). Native local ECIES decrypt PROVEN end-to-end.

What was validated (krl-client/spike/, reproducible via ./run.sh):
- Backend side (Node, encrypt.mjs): node:crypto encrypts a payload to a host's OpenSSH ecdsa-sha2-nistp256 PUBLIC key (parsed SSH-wire -> JWK -> KeyObject).
- Host side (Go, decrypt.go): decrypts LOCALLY with the OpenSSH PRIVATE key /etc/ssh/ssh_host_ecdsa_key via ssh.ParseRawPrivateKey -> *ecdsa.PrivateKey.ECDH() -> crypto/ecdh. NO KMS, NO network, NO cosmian CLI.
- Round-trip: recovered plaintext is byte-identical (same SHA-256).
- Negatives (compiled binary, true exit codes): tampered ciphertext -> exit 4; wrong host key -> exit 4; ed25519 key (not P-256) -> exit 3.

PINNED WIRE FORMAT (ECIES v1) — the interop contract for KRLC-02 (backend) and KRLC-04 (client):
  envelope = ephemeralPub(65B, SEC1 uncompressed 0x04||X||Y) || nonce(12B) || ciphertext(N) || tag(16B)
  shared = ECDH(ephemeralPriv, recipientPub)  # 32B X-coordinate only (node crypto.diffieHellman == go ecdh)
  key    = HKDF-SHA256(ikm=shared, salt="pki-manager-krl-ecies-v1", info=ephemeralPub(65B), L=32)
  ct||tag = AES-256-GCM(key, nonce, plaintext, aad=<empty>)
Hardening TODO for KRLC-02: consider binding host_id/krl_version into GCM AAD (spike used empty AAD).

BUILD-COMPAT FINDING (feeds KRLC-01): golang.org/x/crypto v0.50.0 requires Go >= 1.25 (go mod tidy silently bumps the toolchain). Client targets Go 1.23 (like k8s/issuer) -> pin an older line; spike uses x/crypto v0.31.0 (needs Go 1.20), builds clean on 1.23, go vet ok.

Artifacts: krl-client/spike/{encrypt.mjs,decrypt.go,run.sh,go.mod,go.sum,README.md}.
CONCLUSION: KRLC-02 and KRLC-04 are UNBLOCKED; the pinned envelope is the contract to implement on both sides.
<!-- SECTION:NOTES:END -->
