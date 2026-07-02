---
id: TASK-168
title: >-
  KRLC-10: Reuse the SSH host key for ECIES + ensure an ecdsa-nistp256 host
  pubkey is registered
status: Done
assignee:
  - '@myself'
created_date: '2026-07-01 07:15'
updated_date: '2026-07-02 15:36'
labels:
  - ssh-cert-manager
  - automation
  - crypto
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-159
  - TASK-160
priority: medium
ordinal: 10
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In the default model the client decrypts with the host's EXISTING SSH host key (/etc/ssh/ssh_host_ecdsa_key), so NO separate ECIES keypair is generated. This task makes that path work end-to-end: verify the host has an ecdsa-sha2-nistp256 host key (sshd generates one by default) and that its PUBLIC key is registered with pki-manager - reuse opensshHostPubkey when the host registered with ecdsa, otherwise register /etc/ssh/ssh_host_ecdsa_key.pub via the KRLC-02 path. Provide an OPTIONAL `krl-client keygen` + --host-key override for operators who prefer a DEDICATED ECIES key instead of reusing the SSH host key (documented trade-off; private key 0600, never transmitted). Document the ed25519-only-host fallback (register the ecdsa host pubkey).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A host with an ecdsa-sha2-nistp256 host key whose public key is registered fetches+decrypts its KRL using only /etc/ssh/ssh_host_ecdsa_key - no dedicated-key generation and no KMS access
- [x] #2 For a host without a registered P-256 public key, onboarding surfaces a clear, actionable step (register /etc/ssh/ssh_host_ecdsa_key.pub) instead of a cryptic decrypt failure
- [x] #3 An optional dedicated-ECIES-key mode is available via --host-key (key kept 0600, never transmitted) for operators who prefer not to reuse the SSH host key
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. keygen subcommand (internal/keygen) + wire into main.go; own default path (never clobber ssh_host_ecdsa_key), 0600 priv + 0644 .pub, print pubkey + register instructions (AC#3)
2. Actionable errors: decrypt.LoadHostKey (missing/ed25519 fallback), decrypt.Open (AEAD mismatch -> register .pub), krlclient 404 hint (AC#2)
3. Tests: keygen round-trip + refuse-overwrite; decrypt message assertions; dedicated-key end-to-end run; 404 actionable message
4. README: dedicated-ECIES-key mode + ed25519 fallback docs
5. go test ./... -race + go vet
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
KRLC-10: reuse SSH host key for ECIES + ensure an ecdsa-nistp256 pubkey is registered.

## What changed
- **AC#1 (default path)**: unchanged mechanism — the client decrypts with /etc/ssh/ssh_host_ecdsa_key locally, no dedicated key, no KMS. `config.DefaultHostKey` is the SSH host key; `run.go` pipeline does fetch→local decrypt→verify→install. Covered by TestRunHappyPathUpdatedAndRedacted.
- **AC#2 (actionable onboarding)**: replaced cryptic failures with fix-naming errors:
  - `krlclient/http.go`: 404 now appends "register /etc/ssh/ssh_host_ecdsa_key.pub with pki-manager".
  - `decrypt.LoadHostKey`: missing ecdsa key (ed25519-only host) and wrong-type key now name the exact fix (ssh-keygen ecdsa / register .pub / `krl-client keygen`).
  - `decrypt.Open`: AEAD-auth failure now says the registered pubkey does not match --host-key and to register <key>.pub. (Open gained a keyPath arg for the message.)
- **AC#3 (dedicated ECIES key)**: new `internal/keygen` + `krl-client keygen` subcommand (wired in main.go). Generates an ecdsa-sha2-nistp256 keypair, private 0600 (never transmitted, refuses overwrite w/o --force, never clobbers ssh_host_ecdsa_key — default /etc/krl-client/ecies_key), prints the OpenSSH pubkey + register/run instructions. Used via existing `--host-key`.
- README: new "Decryption key (ECIES)" section (default reuse, ed25519 fallback, dedicated-key trade-off).

## Tests
go test ./... -race → all green (71). New: keygen end-to-end round-trip (encrypt to .pub → decrypt with generated key via real decrypt path), refuse-overwrite/--force, comment/stray-arg; decrypt actionable-message asserts (missing/ed25519/wrong-key); http 404 hint; run_summary surfaces actionable 404. Binary smoke-tested (ssh-keygen validates the generated pubkey; perms 0600/0644).

No new deps (golang.org/x/crypto/ssh already used). No backend changes needed — POST /api/v1/external/ssh/krl already encrypts to host.opensshHostPubkey and returns 404 ECIES_KEY_UNSUPPORTED for non-P256 keys.
<!-- SECTION:NOTES:END -->
