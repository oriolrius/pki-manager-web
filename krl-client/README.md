# krl-client

Host-side puller that keeps a machine's OpenSSH KRL (`RevokedKeys` /
`/etc/ssh/revoked_keys`) current. Each run POSTs the per-host encrypted endpoint,
**decrypts the payload locally** with the host's own ECDSA host key, verifies the
CA signature, and atomically installs the KRL. Designed to run from cron or a
systemd timer.

Decryption is **always local** — the host's private key never leaves the box and
there is no KMS mode.

> [!IMPORTANT]
> **A clock synced via NTP is a hard prerequisite**, and the encrypted endpoint
> currently serves the **Host-CA** KRL while sshd's `RevokedKeys` semantically
> wants the **User-CA** KRL. Read [Operational caveats](#operational-caveats)
> before deploying.

## Contents

- [Build](#build) · [Quick start](#quick-start) · [Enable sequence](#enable-sequence)
- [Decryption key (ECIES)](#decryption-key-ecies) · [How a run works](#how-a-run-works)
- [Configuration](#configuration) · [Logging & observability](#logging--observability)
- [Exit codes](#exit-codes) · [Scheduling (systemd / cron)](#scheduling-systemd--cron)
- [Operational caveats](#operational-caveats)

## Build

```bash
make build         # dist/krl-client
make build-static  # CGO_ENABLED=0 linux/amd64 release binary (dist/krl-client-linux-amd64)
make test          # go test ./... -race
```

## Quick start

A host provisioned from pki-manager's generated `60-ssh-ca.conf` sshd drop-in
already has the host key, the User-CA public key, and the `RevokedKeys` path in
their canonical locations, so it needs only the server URL:

```bash
krl-client --server-url https://pki.example.com
```

There is also a `krl-client(8)` man page — render it straight from the tree with
`man ./packaging/krl-client.8`, or install it (see [below](#install)).

## Enable sequence

End-to-end, **reusing the host's existing `ecdsa-sha2-nistp256` key — no keygen**:

1. **Register the host** with pki-manager (creates its `ssh_hosts` record).
2. **Issue a host certificate.** pki-manager signs the host key and generates the
   `60-ssh-ca.conf` sshd drop-in; provision that drop-in to
   `/etc/ssh/sshd_config.d/60-ssh-ca.conf`. It pins the canonical on-host paths
   this client defaults to.
3. **Register the host's ECIES public key.** The backend encrypts the KRL to the
   host's `ecdsa-sha2-nistp256` **public** key, so it must be on file. Host
   registration stores it when the host registers with its ecdsa key; if it is
   missing the `/krl` endpoint returns **404** and this client prints the exact
   fix. Register it once:

   ```bash
   cat /etc/ssh/ssh_host_ecdsa_key.pub      # hand this to the pki-manager operator
   ```

   Hosts that ship with **only an ed25519** host key must first generate an ecdsa
   one (see [Decryption key](#decryption-key-ecies)).
4. **Enable the encrypted path on the backend:** it must run with
   `SSH_ECIES_ENABLED=true`, otherwise `/krl` returns **501** (feature disabled →
   exit code `9`).
5. **Install the binary + scheduler** (see [Scheduling](#scheduling-systemd--cron)),
   then confirm one run succeeds:

   ```bash
   krl-client --server-url https://pki.example.com --dry-run --verbose
   ```

Once a real (non-`--dry-run`) run has installed the KRL, tell sshd to pick it up:

```bash
sshd -t && systemctl reload ssh      # validate config, then reload (no dropped sessions)
```

## Decryption key (ECIES)

The KRL payload is encrypted to a P-256 public key and **decrypted locally** — the
private key never leaves the host and the KMS is never contacted.

**Default — reuse the SSH host key.** The client decrypts with the host's existing
`ecdsa-sha2-nistp256` host key (`/etc/ssh/ssh_host_ecdsa_key`); `sshd` generates
one by default. Nothing extra is generated. The host's **public** key must be
registered with pki-manager (host registration already stores it when the host
registered with its ecdsa key). If it isn't, register it once:

```bash
# on the host
cat /etc/ssh/ssh_host_ecdsa_key.pub      # hand this to the pki-manager operator
```

**ed25519-only hosts.** Some hosts ship with only an ed25519 host key, which
cannot do P-256 ECIES. Either generate an ecdsa host key and register its `.pub`:

```bash
ssh-keygen -q -N '' -t ecdsa -b 256 -f /etc/ssh/ssh_host_ecdsa_key
```

…or use a dedicated ECIES key (below). The client detects this case and prints the
exact fix instead of failing cryptically.

**Optional — a dedicated ECIES key.** Operators who prefer not to reuse the SSH
host key can generate a standalone keypair. Trade-off: one more secret to manage,
but KRL decryption is then decoupled from SSH host-key rotation.

```bash
krl-client keygen                                    # writes /etc/krl-client/ecies_key{,.pub}
# register the printed public key with pki-manager, then:
krl-client --server-url https://pki.example.com --host-key /etc/krl-client/ecies_key
```

`keygen` writes the private key `0600` (never transmitted), refuses to overwrite
an existing key without `--force`, and never touches `/etc/ssh/ssh_host_ecdsa_key`.
Flags: `--out PATH` (default `/etc/krl-client/ecies_key`), `--comment C`, `--force`.

## How a run works

```
read state ─▶ POST /krl (If-None-Match: cached krl_version) ─┬─ 304 ─▶ up-to-date, exit 0
                                                             └─ 200 ─▶ decrypt locally
   ─▶ parse + validate (host_id / valid_until / anti-rollback) ─▶ verify CA signature
   ─▶ atomic install (0444 root:root) ─▶ persist state ─▶ exit 0
```

**Conditional fetch — corrected semantics.** The `If-None-Match` request header
carries the server's **`krl_version`** token (the value the previous run cached
from the `X-KRL-Version` response header), **not** a hash of the local KRL file.
The server compares it to the current version and returns **304 Not Modified** when
the host already holds the current KRL, making the steady-state run a cheap no-op.
The version token is opaque (currently a `sha256:<hex>` of the *server-side* KRL,
which is not the same as hashing the installed file — never compute it locally).

The install is **atomic** (write-temp-then-rename) and the file is `0444 root:root`,
so sshd never observes a half-written KRL. State (`krl_version`, monotonic
`krl_number`, sha256, timestamp) is cached under `--state-dir` to drive the next
conditional fetch and the anti-rollback check.

## Configuration

Every setting can come from a flag, an environment variable, or a config file.
The resolution **precedence**, highest first:

```
flag  >  env KRL_CLIENT_*  >  config file  >  built-in default
```

The env var for a flag is `KRL_CLIENT_` + the flag name upper-cased with `-`→`_`
(e.g. `--server-url` → `KRL_CLIENT_SERVER_URL`, `--clock-skew` →
`KRL_CLIENT_CLOCK_SKEW`). The config-file key is the flag name verbatim.

| Flag | Env / config key | Default | Purpose |
|---|---|---|---|
| `--server-url` | `SERVER_URL` / `server-url` | — (**required**) | PKI-Manager base URL |
| `--host-id` | `HOST_ID` / `host-id` | `hostname -f` | host FQDN sent in the request body |
| `--host-key` | `HOST_KEY` / `host-key` | `/etc/ssh/ssh_host_ecdsa_key` | ECDSA key used to decrypt locally (host key by default; a dedicated `keygen` key otherwise — see [above](#decryption-key-ecies)) |
| `--ca-pubkey` | `CA_PUBKEY` / `ca-pubkey` | `/etc/ssh/ssh-user-ca.pub` | User-CA public key for signature verify |
| `--krl-file` | `KRL_FILE` / `krl-file` | `/etc/ssh/revoked_keys` | install target (sshd `RevokedKeys`) |
| `--state-dir` | `STATE_DIR` / `state-dir` | `/var/lib/krl-client` | version/state cache |
| `--ca-bundle` | `CA_BUNDLE` / `ca-bundle` | system roots | TLS CA bundle (PEM) to pin the server |
| `--insecure` | `INSECURE` / `insecure` | `false` | disable TLS verification (dev only) |
| `--allow-unsigned` | `ALLOW_UNSIGNED` / `allow-unsigned` | `false` | install even when `ca_signature` is null |
| `--timeout` | `TIMEOUT` / `timeout` | `30s` | per-request timeout |
| `--retries` | `RETRIES` / `retries` | `3` | retries on network errors / 5xx |
| `--max-response-bytes` | `MAX_RESPONSE_BYTES` / `max-response-bytes` | `8388608` (8 MiB) | ceiling on the encrypted KRL response body; an oversized response fails closed (exit `2`) instead of being buffered |
| `--clock-skew` | `CLOCK_SKEW` / `clock-skew` | `300s` | leeway when checking `valid_until` |
| `--dry-run` | `DRY_RUN` / `dry-run` | `false` | fetch/decrypt but do not install |
| `--quiet` | `QUIET` / `quiet` | `false` | log warnings and errors only |
| `--verbose` | `VERBOSE` / `verbose` | `false` | log per-step debug detail |
| `--log-format` | `LOG_FORMAT` / `log-format` | `text` | `text` or `json` |
| `--systemd` | `SYSTEMD` / `systemd` | `false` | systemd integration (implies `--log-format=json`) |
| `--oneshot` | `ONESHOT` / `oneshot` | `false` | run one cycle and exit (current default behaviour) |
| `--config` | `KRL_CLIENT_CONFIG` | `/etc/krl-client/config.yaml` | config-file path |
| `--version` | — | — | print version and exit |

The path defaults derive from the backend's canonical constants in
`backend/src/services/ssh-config.ts` (`hostKeyPathFor('ecdsa-sha2-nistp256')`,
`USER_CA_PATH`, `REVOKED_KEYS_PATH`) so the client, the sshd drop-in, and the
Ansible role never disagree. **A host set up from the generated `60-ssh-ca.conf`
therefore runs with only `--server-url`** — every other default already points at
the right on-host file. A defaults test asserts these exact strings so drift is
caught in CI.

Mutually-exclusive combinations are rejected (`--quiet`+`--verbose`,
`--insecure`+`--ca-bundle`, `--systemd`+`--log-format=text`).

### Config file

A deliberately small flat subset of YAML — one `key: value` per line, `#`
line/inline comments, and single/double-quoted scalars. Nested mappings,
sequences, unknown keys, and duplicate keys are rejected. An absent *default*
file is ignored; an explicitly requested `--config` that is missing is an error.

```yaml
# /etc/krl-client/config.yaml
server-url: https://pki.example.com
host-id: web01.prod.example.com
timeout: 45s
retries: 5
log-format: json
```

No secret is ever passed on the command line.

## Logging & observability

Logs go to **stderr** (stdout is reserved for `--version`), structured over
`log/slog`. Each run emits **exactly one** `run_summary` event plus optional
per-step debug events.

| Control | Effect |
|---|---|
| `--log-format text` (default) | human `key=value` lines |
| `--log-format json` | one JSON object per line (log-shipper friendly) |
| *(default level)* | the summary only |
| `--verbose` | adds per-step `DEBUG` events (fetch, decrypt, validate, install) |
| `--quiet` | warnings + errors only — a successful run is **silent** (cron-friendly), but a failing run still emits its summary at `ERROR` |
| `--systemd` | forces `json` with no ANSI escapes (journal-friendly) |

The **`run_summary`** event carries the full outcome of the run:

| Field | Values / meaning |
|---|---|
| `outcome` | `up_to_date` (304) · `updated` (verified + installed, or dry-run validated) · `error` |
| `http_status` | terminal HTTP status (`200`, `304`, or `0` when the request never completed) |
| `krl_version` | `sha256:<hex>` version token |
| `krl_number` | monotonic anti-rollback counter (`0` when absent) |
| `host_id` | the host FQDN sent in the request |
| `dry_run` | whether `--dry-run` skipped the install |
| `exit_code` | the process exit code (see below) |
| `error` | failure message (present only when `outcome=error`) |

It is logged at `INFO` on success (suppressed by `--quiet`) and at `ERROR` on
failure (always surfaces). Secret material — the host key, the ECIES ciphertext,
and the decrypted payload — is **never** logged at any level; step events carry
only redacted metadata (byte lengths, versions, counts).

```jsonc
// --log-format json, a successful update
{"time":"…","level":"INFO","msg":"run complete","event":"run_summary",
 "outcome":"updated","http_status":200,"krl_version":"sha256:…","krl_number":42,
 "host_id":"web01.prod.example.com","dry_run":false,"exit_code":0}
```

## Exit codes

Every terminal condition maps to a stable exit code, so a cron/timer wrapper can
alert on real failures and ignore the up-to-date no-op:

| Code | Meaning |
|---|---|
| `0` | up-to-date (304) **or** a newer KRL was verified and installed |
| `1` | usage / configuration error |
| `2` | network — DNS/connect/TLS/timeout, retries exhausted, or 5xx |
| `3` | local ECIES decryption failed |
| `4` | CA signature verification failed |
| `5` | payload expired (`valid_until` in the past beyond clock-skew) |
| `6` | host mismatch (payload `host_id` ≠ our host-id) |
| `7` | atomic install of the KRL file failed |
| `8` | version / integrity / anti-rollback failure |
| `9` | not provisioned / feature disabled (400/404/501) |
| `10` | rate limited (429) — back off and retry later |

## Scheduling (systemd / cron)

`krl-client` is a oneshot; a scheduler runs it periodically. The interval is
bounded on two sides:

- **Rate limit:** the `/krl` endpoint allows **120 requests / 60 s per source IP**.
- **Staleness window:** ssh-mon flags a host as *stale pulling* once **2× its 15 min
  pull interval (≈ 30 min)** elapses without a fetch.

A **15-minute interval with a few minutes of jitter** sits far under the rate limit
and comfortably inside the 30-minute staleness window. The shipped units in
[`packaging/`](packaging/) encode exactly that.

### Install

```bash
# binary
install -m0755 dist/krl-client-linux-amd64 /usr/local/bin/krl-client
# man page (optional)
install -Dm0644 packaging/krl-client.8 /usr/local/share/man/man8/krl-client.8

# systemd (preferred)
install -Dm0644 packaging/krl-client.service /etc/systemd/system/krl-client.service
install -Dm0644 packaging/krl-client.timer   /etc/systemd/system/krl-client.timer
install -Dm0644 packaging/krl-client.env.example /etc/krl-client/krl-client.env  # edit: set the URL
systemctl daemon-reload
systemctl enable --now krl-client.timer
systemctl start krl-client.service           # run once now; check: journalctl -u krl-client
```

`packaging/krl-client.service` is a hardened `Type=oneshot` unit
(`NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths=/etc/ssh
/var/lib/krl-client`, all capabilities dropped) that runs as root — it needs to
read the host private key and write `0444 root:root` `/etc/ssh/revoked_keys` — and
logs JSON to the journal via `--systemd`. It orders itself `After=time-sync.target`
so it never runs before NTP has stepped the clock.
`packaging/krl-client.timer` fires it every 15 min with up to 5 min of
`RandomizedDelaySec` jitter (`Persistent=true` catches up one missed cycle after
downtime).

### cron fallback

Where systemd is unavailable, [`packaging/crontab.example`](packaging/crontab.example)
runs the same 15-minute jittered pull with JSON logging:

```cron
SHELL=/bin/bash
KRL_CLIENT_SERVER_URL=https://pki.example.com
*/15 * * * * root sleep $((RANDOM \% 300)); /usr/local/bin/krl-client --log-format json --quiet
```

The `\%` escape is mandatory (cron turns a bare `%` into a newline). `--quiet`
keeps a successful run silent so cron only mails you on failure.

### Applying an installed KRL

Installing the file does not by itself make sshd re-read it. After the first
install (and after provisioning the drop-in), run:

```bash
sshd -t && systemctl reload ssh
```

## Operational caveats

> [!WARNING]
> **NTP is a hard prerequisite.** Each payload carries a `valid_until`; the client
> rejects one that is in the past beyond `--clock-skew` (default `300s`) with exit
> code `5`. A host whose clock has drifted will fail **every** run. Keep a time
> daemon (`chrony`/`systemd-timesyncd`) running; the systemd unit already orders
> itself after `time-sync.target`.

> [!WARNING]
> **Host-CA vs User-CA KRL mismatch.** The encrypted `/krl` endpoint currently
> resolves the host's **Host CA** and serves *that* CA's KRL. But sshd checks
> `RevokedKeys` against the **user** certificates presented at login, so it
> semantically needs the **User-CA** KRL. Until this is reconciled, the installed
> KRL revokes host-CA-signed material, not the user certificates sshd authenticates
> — do not rely on this path alone to revoke user access. The guaranteed revocation
> mechanism remains the bare, TLS-served public KRL plus short certificate TTLs
> (see [decision-013](../backlog/decisions/decision-013%20-%20SSH-KRL-Distribution.md)).
> This client-decryption model and the CA-selection caveat are recorded in
> [decision-015 — SSH KRL Client Decryption Model](../backlog/decisions/decision-015%20-%20SSH-KRL-Client-Decryption-Model.md),
> which supersedes decision-013's KMS-resident model.
