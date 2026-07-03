# Per-Host Access Blocks — Operator Guide & Cutover Runbook

Implements [decision-016 — Per-Host User Access Blocks](../../backlog/decisions/decision-016%20-%20Per-Host-User-Access-Blocks-SSH.md)
(milestone doc: [doc-008](../../backlog/docs/doc-008%20-%20SSH-Host-Access-Blocks-Milestone.md)).
"Block **this user** on **this host**" is one reversible, audited click; the
mechanism is a **composed per-host KRL**:

```
KRL(host Y) =   host-CA revocation set
              ∪ all user-CA revocation sets
              ∪ resolve(active blocks on Y)   ← serials of unexpired certs + key fingerprints
```

Blocks are **not** revocations — the blocked identity's certificates stay valid
on every other host. sshd re-reads `RevokedKeys` on every auth attempt
(fail-closed, no reload), so a block lands on the host's **next KRL pull**.

## How each client verifies (and what unsigned means)

The composed KRL is signed with the **Host-CA** key. The trust anchor is
`/etc/ssh/ssh-host-ca.pub` (`GET /ssh/host-ca-keys`), installed by the Ansible
role.

| Client | Trust anchor | Unsigned-KRL posture (KMS signing failed) |
|---|---|---|
| `krl-client` (Go) | `--ca-pubkey`, **default `/etc/ssh/ssh-host-ca.pub`** | **Rejects** (exit 4) and keeps last-good — fail-stale — unless run with `--allow-unsigned` |
| `host_puller.sh` | `CA_PUBLIC_KEY_ID` = Host CA KMS key id | Verifies only when a signature is present; **installs** unsigned KRLs (deny availability wins) |

An unsigned latest KRL is surfaced in the UI state pill as `(unsigned)` and in
the audit log (`ssh.host_krl.generate`, status `failure`, `signError`). Fix the
KMS, then any block/unblock or the hourly lazy regen produces a signed row.

## Cutover runbook (existing fleet → per-host KRLs)

Preconditions (pinned by [doc-008 baseline](../../backlog/docs/doc-008%20-%20SSH-Host-Access-Blocks-Milestone.md)):
every `krl-client` host runs a **post-TASK-175 build** (anti-rollback = strict
monotonic check on the signed KRL header number).

1. **Trust anchor first — before anything else.** Run the `ssh_host_cert` role
   (or manually install `GET /ssh/host-ca-keys` →
   `/etc/ssh/ssh-host-ca.pub`, mode 0444) on **every** host. Hosts verifying
   against the User CA (`/etc/ssh/ssh-user-ca.pub` — the pre-BLK-10 krl-client
   default) will fail-verify every pull once the composed KRL is served, and
   blocks silently never land.
2. **Canary.** Start the backend with `SSH_HOST_KRL_SERVE=true` (the default)
   in a staging/canary scope, or keep `SSH_HOST_KRL_SERVE=false` fleet-wide and
   flip it on a canary instance. On the canary host run the puller once and
   check: exit 0, `/etc/ssh/revoked_keys` replaced, and the host shows
   **Effective** on the KRL page.
3. **Cutover.** Enable `SSH_HOST_KRL_SERVE=true` (default) for the deployment.
   Each host's **first** fetch synchronously generates its composed KRL, whose
   header number is drawn from the **global** allocator — always above any
   per-CA number the host has installed, so the switch is accepted, never
   rejected as rollback. If that first generation fails the endpoint answers
   `503 NO_KRL` (**no per-CA fallback**): pullers keep last-good and retry on
   the next interval.
4. **Verify.** KRL page: every active host shows Blocks/State columns; healthy
   hosts converge to **Effective** within one pull interval (≤15 min).
   `trpc.ssh.mon.metrics`: `hostsWithoutHostKrl` → 0, `stalePullingHosts`
   stays 0, `hostKrlsPastNextUpdate` transiently non-zero is fine (lazy regen).

### Rollback / recovery

- **Switch-back is safe by construction**: set `SSH_HOST_KRL_SERVE=false` and
  regenerate the per-CA KRL(s) (UI "Generate KRL" or any revocation). The
  global allocator numbers the new per-CA rows above every per-host row, so
  clients accept them. Serving a **stale** per-CA row (lower number) is
  rejected by `krl-client` as rollback (exit 8) — hosts keep last-good; that is
  the tested, intended behavior, not an outage.
- **Last-resort recovery** (e.g. a host restored from an old image with a
  future-numbered state): delete the krl-client state dir
  (`/var/lib/krl-client`) — the next pull re-validates from scratch against the
  then-current signed KRL. Do this per host, deliberately; it removes the
  anti-rollback anchor for one pull.

### Public-path hosts (no ECIES)

Hosts fetching the public bare KRL only receive blocks when **both**:
1. the deployment sets `SSH_HOST_KRL_PUBLIC=true` (default **off** — the
   per-host KRL leaks deny intel unauthenticated), and
2. the host's fetch URL is switched from `/krl/<caId>.bin` to
   `/krl/hosts/<fqdn>.bin` (one line in the Ansible role:
   `ssh_host_cert_krl_fetch_url`).

Until both happen, such hosts show **Unknown** state and the UI warns at block
time that the block will NOT be enforced there.

## Residual limitations (accepted, decision-016)

- **≤1 pull interval** (median ≈7.5 min at the default 15-min timer) before a
  host enforces a block or an unblock — irreducible in a pull model; the same
  bound as all KRL revocation today.
- **New-key race (v1)**: a blocked identity that still holds issuance rights
  can rotate keys → new cert → connect to the blocked host **inside the pull
  gap**. The server-side artifact updates immediately (issuance trigger), but a
  host is only as fresh as its last pull — and a host that *never* pulls never
  enforces. Closed by construction only by the **optional flag-gated issuance
  gate** (BLK-13, `SSH_BLOCK_ISSUANCE_GATE`); if you need zero-window blocks,
  enable it and re-push the principals files once.
- **Effective means "ciphertext served"**, not "verified installed". True
  install confirmation would need a puller callback — out of scope. Tooltips
  say exactly this.
- **Fingerprint over-blocking**: blocking an identity denies every public key
  ever certified for it — if another identity shares a key (anti-pattern), that
  identity is denied on that host too. Detected and warned at block time.
- **Offline hosts keep their last KRL**: visible via `stalePullingHosts`,
  never shown as Effective.

## Audit trail

Every mutation writes `audit_log` rows: `ssh.host.block` / `ssh.host.unblock`
(`{identityId, hostId, reason}`, success **and** failure) and
`ssh.host_krl.generate` (per generated row; failure rows carry `signError`).
