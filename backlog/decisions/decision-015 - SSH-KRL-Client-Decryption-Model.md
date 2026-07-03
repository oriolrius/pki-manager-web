---
id: decision-015
title: SSH KRL Client Decryption Model
date: '2026-07-02 16:21'
status: Accepted
---
## Supersession

This decision **SUPERSEDES the KMS-resident "adopted model" of
[decision-013 — SSH KRL Distribution](decision-013%20-%20SSH-KRL-Distribution.md)**.
decision-013's spike (TASK-144) proved a *KMS-resident* ECIES scheme was viable — the
host's key lived **inside** the Cosmian KMS and the host decrypted by **calling the KMS**.
The KRL Client Distribution milestone (doc-007, KRLC-01..KRLC-14) instead ships a
**local-key** model: decryption never touches the KMS. decision-013 stays valid for its
GUARANTEED-revocation floor — the bare, CA-signed, TLS-served public KRL (SSH-22 /
TASK-142) — which is unchanged and remains the primary revocation mechanism. Only its
KMS-resident *confidentiality* path is retired here.

## Context

SSH revocation ships in two layers. The floor (decision-013, unchanged) is the **bare
CA-signed + TLS-served public KRL** (SSH-22 / TASK-142): sshd reads `RevokedKeys` bytes
directly and verifies no KRL signature, so integrity rests on TLS + `0444 root:root` perms

+ short cert TTLs. The second layer adds **confidentiality** of the revocation set by
  encrypting a per-host KRL payload to each host.

decision-013 built that second layer as **KMS-resident ECIES**: `registerHostEciesKey`
generated the host's ECIES keypair *inside* the Cosmian KMS, the backend encrypted to that
KMS-held pubkey (`ssh_hosts.kms_pubkey_id`), and the host decrypted **by calling the KMS**
with its private-key id. That coupling has three problems for a host agent:

- **Every host needs live KMS access** to decrypt — an operational and blast-radius cost
  for what is only a confidentiality gain over the already-guaranteed bare KRL.
- **Cosmian's ECIES is opaque and version-specific** — a native Go client cannot reproduce
  or verify the envelope, so decryption *must* be delegated back to the KMS.
- **The host already holds a perfectly good P-256 keypair** — its OpenSSH ECDSA host key
  (`/etc/ssh/ssh_host_ecdsa_key`), whose public half pki-manager already stores as
  `ssh_hosts.opensshHostPubkey` at host registration. Reusing it needs no new key material
  and no registration step.

The user's bash prototype already decrypted **locally** against the reused SSH host key.
KRLC promotes that model to a production `krl-client` Go binary (doc-007).

## Decision

1. **Decryption is ALWAYS local.** The KMS is **never** used to en/decrypt the KRL. The
   host decrypts entirely in-process with a host-held private key — no per-host KMS access,
   no `cosmian`/`openssl` shell-outs.
2. **The backend encrypts NATIVELY (`node:crypto`) to the host's OWN public key.** By
   default that key is the **reused SSH host key** at pki-manager's canonical path
   `/etc/ssh/ssh_host_ecdsa_key` (an ECDSA nistp256 key), whose public half is already
   stored as `ssh_hosts.opensshHostPubkey` — so **no new key registration** is needed for
   hosts that registered with an ecdsa key. A dedicated ECIES key remains available via the
   client's `--host-key` override (trade-off in §Consequences).
3. **All client on-host path defaults derive from `backend/src/services/ssh-config.ts`**,
   the declared single source of truth for every on-host path, so the client, the generated
   `60-ssh-ca.conf` drop-in, and the Ansible role can never disagree:
   | Client flag                           | Default                         | `ssh-config.ts` constant                |
   | ------------------------------------- | ------------------------------- | ----------------------------------------- |
   | `--host-key` (ECIES = SSH host key) | `/etc/ssh/ssh_host_ecdsa_key` | `hostKeyPathFor('ecdsa-sha2-nistp256')` |
   | `--ca-pubkey` (KRL-sig trust)       | `/etc/ssh/ssh-user-ca.pub`    | `USER_CA_PATH`                          |
   | `--krl-file` (install target)       | `/etc/ssh/revoked_keys`       | `REVOKED_KEYS_PATH`                     |
4. **The envelope is a pinned, standard, cross-impl ECIES scheme:** P-256 ECDH +
   HKDF-SHA256 + AES-256-GCM, framing `ephemeral-pubkey || nonce || ciphertext || tag`.
   A **native, documented** scheme (not Cosmian's opaque ECIES) is **REQUIRED** because
   local decryption means a std-lib Go client must byte-match the backend's output; the
   contract is pinned by encrypt→decrypt golden vectors (KRLC-02a gate spike, KRLC-11).
5. **This is a rebuild, not an add-on (KRLC-02, blocking).** KRLC-02 replaces the
   KMS-resident encrypt path with a native backend encrypt-to-`opensshHostPubkey`, and
   **retires** the KMS `CreateKeyPair`/`Encrypt`/`Decrypt` path plus `ssh_hosts.kms_pubkey_id`,
   **migrating existing hosts** off the KMS-resident model. This retires the KMS-decrypt
   parts of SSH-15 (TASK-133) and SSH-24 (TASK-145), which shipped Done under decision-013.
6. **P-256 constraint.** ECIES here needs P-256, so the host must have an ecdsa host key
   (`sshd` generates one by default). An ed25519-cert host registers its
   `/etc/ssh/ssh_host_ecdsa_key.pub` so it can still decrypt. Reusing the SSH host key for
   ECIES is a deliberate trade-off (below), overridable with `--host-key`.
7. **Client security posture (fail-closed).** Before installing, the client:
   **verifies the detached CA signature** (DER ECDSA-P256 over `sha256(krl)`, OpenSSH
   `ca.pub` parsed via `ssh.ParseAuthorizedKey` → `ecdsa.VerifyASN1`; a `null` signature
   installs only under explicit `--allow-unsigned`); enforces **host-id binding**
   (payload `host_id` must equal this host); enforces **anti-rollback** by comparing
   the monotonic version number read from the **CA-signed OpenSSH KRL header** (not
   the former unsigned JSON `krl_number`, which a compromised server could inflate to
   replay an old signed KRL — TASK-175) against the installed number persisted in
   `--state-dir`, rejecting anything not strictly newer; and installs **atomically**
   `0444 root:root`. Signature is verified **before** install, never after.

## Consequences

- **No revocation is ever blocked on the KMS.** The guaranteed floor (bare served KRL,
  decision-013 / SSH-22) is untouched; the local-key path only adds confidentiality of the
  revocation set, so retiring the KMS-resident path costs **no revocation capability**.
- **Hosts no longer need KMS access** to consume encrypted KRLs — smaller blast radius and
  a self-contained static binary (std-lib crypto/HTTP + `golang.org/x/crypto/ssh`).
- **Migration is required and stateful:** SSH-15/SSH-24 shipped the KMS-resident model, so
  KRLC-02 must migrate existing hosts (`kms_pubkey_id` → native encrypt-to-`opensshHostPubkey`)
  and the native envelope must be proven to round-trip backend→Go-client **before** cutover
  (KRLC-02a gate spike; KRLC-02 vector-test AC).
- **SSH-host-key reuse is a trade-off:** it avoids a second keypair and a registration step,
  but couples KRL confidentiality to the host key's lifecycle (host-key rotation requires
  re-registering the ecdsa pubkey). Operators who want isolation use a dedicated ECIES key
  via `--host-key`.
- **Provisioning is one flag:** because every default derives from `ssh-config.ts`, a host
  provisioned from the `60-ssh-ca.conf` drop-in needs only `--server-url`.

### Open caveats (deferred / backend)

- **Host-CA vs User-CA KRL asymmetry.** The encrypted `/krl` endpoint currently resolves the
  host's **Host CA** and serves *that* CA's KRL, but sshd checks `RevokedKeys` against the
  **user** certificates presented at login and so semantically wants the **User-CA** KRL.
  Until reconciled (fix the endpoint to serve the User-CA KRL, or accept Host-CA behavior),
  the client must not be presented as a drop-in for the User-CA bundle cron. The README
  documents this as a `WARNING`; the guaranteed mechanism remains the bare served KRL + short
  TTLs.
- **Telemetry not updated on 304.** `ssh_hosts.last_krl_fetch_at` refreshes only on a `200`;
  a well-behaved conditional client that only ever gets `304` can fall into ssh-mon's "stale"
  bucket. Open question: force periodic unconditional `200`s client-side, or bump the
  telemetry timestamp on `304` server-side.

## Related tasks

- **doc-007** — SSH KRL Client Distribution Milestone (KRLC-01..KRLC-14 + KRLC-02a spike).
- **TASK-142 (SSH-22)** — the guaranteed bare/served public KRL (decision-013 floor, unchanged).
- **TASK-173 (KRLC-02a)** — gate spike proving native P-256 ECIES round-trip; pins the envelope.
- **TASK-160 (KRLC-02)** — rebuild backend encryption to local decryption; retires the KMS-resident path.
- **TASK-162 (KRLC-04)** — native-Go local ECIES decrypt against the host-held private key.
- **TASK-163 (KRLC-05)** — payload validation: host_id / valid_until / version + sha256 + anti-rollback.
- **TASK-164 (KRLC-06)** — detached CA-signature verification (ECDSA-P256/SHA-256/DER, OpenSSH `ca.pub`).
- **TASK-168 (KRLC-10)** — reuse the SSH host key for ECIES; ensure an ecdsa-nistp256 host pubkey is registered.
- **TASK-133 (SSH-15) / TASK-145 (SSH-24)** — the KMS-resident host-pubkey registration + puller, whose KMS-decrypt path is retired here.
- **decision-013** — SSH KRL Distribution (KMS-resident adopted model **superseded** by this decision).
- **decision-012** — SSH Data Model and KRL State.
