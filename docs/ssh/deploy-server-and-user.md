# Deploy an SSH Server and an SSH User with PKI Manager — Operator Reference Guide

*Automation-first, end-to-end. This is the current counterpart to the legacy manual/UI walkthrough in [operator-quickstart.md](operator-quickstart.md).*

**What you'll end up with:** a fleet of SSH servers that trust user certificates issued by PKI Manager (no per-user `authorized_keys`), clients that connect with **no host-key TOFU prompt**, principal-based RBAC deciding which local accounts a user may log into, unattended host-cert renewal, and a live revocation channel. User certs are short-lived (default 7 days); host certs long-lived (default ~1 year). Private keys never leave the KMS (CA keys) or the user's laptop (login keys).

---

## 0. Mental model & prerequisites

### The two trust directions (both must be wired, or auth is half-broken)

PKI Manager runs **two** CAs whose private keys live in the Cosmian KMS: a **User CA** (signs people's login certs) and a **Host CA** (signs servers' host certs). Trust flows in two opposite, independent directions:

| Direction | What is installed, where | Referenced by | Public download |
|---|---|---|---|
| **Servers trust users** | User CA public key → `/etc/ssh/ssh-user-ca.pub` on each server | sshd `TrustedUserCAKeys` | `GET /ssh/trusted-user-ca-keys` |
| **Clients trust servers** | Host CA `@cert-authority` line → each client's `~/.ssh/known_hosts` | OpenSSH known-hosts CA marker | `GET /ssh/cert-authority?pattern=*.example.com` |

Wire only one side and you get a classic half-config: user certs are ignored if the server has no `TrustedUserCAKeys`; clients still get host-key/TOFU prompts if they lack the `@cert-authority` line. (The Ansible role in §2 installs the server side automatically; §3/§4 cover the client side.)

### The #1 principals trap

A **principal** is a role label (e.g. `admins`, `developers`). For a login to succeed the **same principal** must appear in **two** places:

1. inside the **user's certificate**, AND
2. in the server's **`/etc/ssh/auth_principals/<account>`** for the local account being logged into.

If the principal exists in only one place, **OpenSSH accepts the certificate signature but still DENIES the login** — you see `Valid certificate but Permission denied`. This is the single most common mistake. Only the host **map** (§3, step 3) populates `auth_principals`; issuing a cert never blocks on a missing map (the form only warns).

### NTP is a HARD prerequisite (every server AND every client)

Certificate validity windows **and** KRL freshness depend on an accurate clock, so a time daemon (**chrony / systemd-timesyncd / ntp**, or a synced `timedatectl`) must be running everywhere.

- **Validity windows:** user certs ~1 week, host certs ~1 year. Clock drift puts `now` outside the cert's window, so a signature that verifies is still rejected as not-yet-valid or expired.
- **KRL freshness (ECIES channel):** each ECIES payload carries a `valid_until`. `krl-client` rejects a payload whose `valid_until` is in the past beyond `--clock-skew` (default **300s**) with **exit code 5 ("payload expired")** — a drifted host then fails **every** run and silently freezes on its last-good KRL. The shipped systemd unit orders itself `After=time-sync.target`, and the Ansible role preflights time-sync and **fails fast** (`ssh_host_cert_require_timesync`, default `true`).

### Prerequisites checklist

| Prerequisite | Notes |
|---|---|
| Both **User CA** and **Host CA** exist in PKI Manager | KMS reachable. See §1. |
| **Fleet token** `pkimg_…`, scoped to ONE Host CA | Correct ops (see §1). Store in Ansible Vault. |
| `community.crypto` collection on the **Ansible controller** | `ansible-galaxy collection install -r ansible/requirements.yml` |
| **NTP/chrony** on every server and client | Hard requirement (above). |
| User has an SSH keypair; **only the public key** reaches the operator | ed25519 (default) or `ecdsa-sha2-nistp256`. |
| Auth gate | With OIDC disabled the SSH REST/tRPC surface is fail-closed; set `ALLOW_UNAUTHENTICATED_SSH_CA=true` for local dev, else these endpoints return **403**. |

---

## 1. One-time platform setup

### 1.1 Create the dual CA (User + Host)

In the UI: **`/ssh` → Certificate Authorities → Create SSH CA**.

- Create the **User CA** (`caType: user`). Issuing a user cert throws *"no active User CA — create one first"* if none is active.
- Create the **Host CA**.

Then hand out CA trust in **both** directions (the Ansible role installs the server side and the Host-CA anchor for you; distribute the `@cert-authority` line to clients — see §3/§4).

### 1.2 Mint the fleet token with the ops a self-provisioning host needs

Mint from the PKI Manager UI or `trpc.ssh.token.mint`, scoped to the **one** Host CA this fleet belongs to. The required ops depend on whether the host uses the ECIES revocation channel (§2.2):

| Server profile | Token ops | Backing endpoints |
|---|---|---|
| **Without live revocation** | `sign-host`, `get-principals` | `POST /sign-host`, `GET …/hosts/<fqdn>/auth-principals` |
| **With KRL revocation (ECIES — recommended)** | `sign-host`, `get-principals`, **`register-host-pubkey`** | + `POST /register-host-pubkey` |

- The token is **shown once**. The backend rejects any request whose token lacks the required op with **403 FORBIDDEN**.
- The API base is derived by the role as `ssh_ca_api_url = {{ ssh_ca_base_url }}/api/v1/external/ssh`.
- **Store the token in Ansible Vault, never in plain inventory.** With unattended renewal on (default), the host stores this token at `/etc/pki-manager/ssh-renew.env` (`0600`) to re-mint itself — which is why the token must carry `sign-host` (and why a compromised host can then sign host certs for any FQDN under that Host CA; see the renewal gotcha in §2).

---

## 2. Deploy a SERVER (Ansible `ssh_host_cert` role)

### 2.1 Minimal path

**Step 1 — Install the controller-side Galaxy dependency (once).** The role generates the host key **on the node** via `community.crypto.openssh_keypair`, so the collection must be present on the controller before the first run:

```bash
cd ansible
ansible-galaxy collection install -r requirements.yml
```

**Step 2 — Put the fleet token in Vault** (never in plain inventory):

```bash
ansible-vault create secrets.yml   # set: ssh_ca_fleet_token: pkimg_…
```

**Step 3 — Write the minimal inventory.** `site.yml` targets `hosts: sshservers` with `gather_facts: true` (the role needs `ansible_fqdn` and `ansible_all_ipv4_addresses`), so the group name must be exactly `sshservers`:

```ini
# inventory.ini
[sshservers]
server1.example.com
server2.example.com
```

**Step 4 — Set the minimal required variables.** Only two are strictly required for a basic server:

| Variable | Value |
|---|---|
| `ssh_ca_base_url` | PKI Manager base URL, e.g. `https://pki.example.com` |
| `ssh_ca_fleet_token` | from Vault |

Defaults already **ON**: `ssh_host_cert_principals_enabled: true` (login RBAC), `ssh_host_cert_renew_enabled: true` (unattended renewal). KRL revocation is **OFF** by default — a plain run installs only a fail-closed **empty `RevokedKeys` placeholder**, so enable the ECIES `krl-client` channel in §2.2 if you need live revocation. Other relevant defaults: `ssh_host_cert_validate_certs` (`true`), `ssh_host_cert_sshd_service` (`ssh`), `ssh_host_cert_reload_method` (`service`; use `command` for init-less containers), `ssh_host_cert_scheduler` (`cron`).

**Step 5 — Run the playbook:**

```bash
ansible-playbook -i inventory.ini site.yml \
  -e ssh_ca_base_url=https://pki.example.com \
  -e @secrets.yml --ask-vault-pass
```

One run does, in order:

| Phase | What happens |
|---|---|
| **1 — Key + cert + trust** | Generate the ed25519 host key on the node → `POST /sign-host`, install `…-cert.pub` (`0444`) → fetch & install the **User-CA** (`GET /ssh/trusted-user-ca-keys`) and **Host-CA** (`GET /ssh/host-ca-keys`) trust anchors. |
| **2 — Principals (RBAC)** | `GET …/hosts/<fqdn>/auth-principals` → write `/etc/ssh/auth_principals/<account>` + a fail-closed `RevokedKeys` placeholder. |
| **3 — sshd drop-in** | `GET /ssh/hosts/<id>/sshd-config` → install `/etc/ssh/sshd_config.d/60-ssh-ca.conf`, run `sshd -t`, flush handlers to reload sshd. |
| **4 — Renewal** | Install the renewal cron/job. |

Re-runs are idempotent (`sign-host` is keyed on host+fingerprint via an `Idempotency-Key` of `<inventory_hostname>-<fingerprint>`; the renewal job instead uses `renew-<fqdn>-<bucket>`). The Host-CA trust anchor at `/etc/ssh/ssh-host-ca.pub` is installed here in Phase 1 — this must exist **before** any composed-KRL cutover, since composed KRLs are Host-CA-signed and `krl-client` verifies against this file.

> **Ordering — auth_principals is populated at run time.** Phase 2 writes `/etc/ssh/auth_principals/<account>` from the host maps that exist **when the role runs**. A first §2 run performed **before** any maps exist (they are created in §3 Step 3) installs an **empty** principals set, so §4 login will be denied until you **re-run this §2 role** (or re-push the `auth_principals` file and click **Mark pushed**) *after* creating the maps. Plan the order: deploy the host (§2) → create identity / principals / maps (§3) → **re-run §2** → log in (§4).

### 2.2 Enable KRL revocation (ECIES `krl-client`)

Live revocation is **OFF** by default — a plain run installs only an empty, fail-closed `RevokedKeys` placeholder. Enable the encrypted **ECIES `krl-client`** channel to make revocations and per-host blocks land automatically. Its properties:

| | **ECIES `krl-client`** |
|---|---|
| Transport | Encrypted to the host's own key; signature-verified before install |
| Signature verified? | **Yes** — composed-KRL Host-CA signature checked against `/etc/ssh/ssh-host-ca.pub` |
| Host key type | switched to **`ecdsa-sha2-nistp256`** (ECIES is P-256 only) |
| Backend flag | `SSH_ECIES_ENABLED=true` (**required**) |
| Token ops | `sign-host`, `get-principals`, **`register-host-pubkey`** |

Enabling it registers the host's ECDSA pubkey (`POST /register-host-pubkey`, asserted 200), installs the `krl-client` binary + config + scheduler + a first-run pull, and verifies each composed-KRL signature against the Host-CA anchor at `/etc/ssh/ssh-host-ca.pub` **before** installing it:

```yaml
ssh_host_cert_ecies_enabled: true
ssh_host_cert_krl_client_url: https://artifacts.example.com/krl-client-linux-amd64   # required (https or file:///abs)
ssh_host_cert_krl_client_checksum: "sha256:<hex>"                                     # idempotence + tamper guard
# optional:
ssh_host_cert_krl_client_ca_bundle: <path>          # TLS roots for a private-CA server
ssh_host_cert_krl_client_man_src: <path>
ssh_host_cert_krl_client_interval_minutes: 15
ssh_host_cert_scheduler: systemd
# backend (required):  SSH_ECIES_ENABLED=true
```

NTP is enforced on this path (`ssh_host_cert_require_timesync`, default `true`). If `SSH_ECIES_ENABLED` is not set, `register-host-pubkey` returns **501** and the role fails with an actionable message.

### 2.3 Server gotchas

- **A default run enables NO live revocation.** `ssh_host_cert_ecies_enabled` is `false`, so `RevokedKeys` is just an empty fail-closed placeholder until you enable the ECIES channel (§2.2).
- **Unattended renewal stores the token on the host** (`0600`, `/etc/pki-manager/ssh-renew.env`) so it can re-mint itself; a compromised host can then sign host certs for any FQDN under that Host CA. Set `ssh_host_cert_renew_enabled: false` to renew by re-running the playbook from the controller instead.
- **ECIES is P-256-only:** an ed25519 host key gets `409 ECIES_KEY_UNSUPPORTED` on `register-host-pubkey`. The role auto-switches the host key to ecdsa when `ssh_host_cert_ecies_enabled=true` — do **not** force an ed25519 key on an ECIES host. The role accepts 200/404/409/501 from the URI call but then **asserts status == 200**, so a backend without `SSH_ECIES_ENABLED` (501) or a host not yet signed (404) fails the play with an explicit message.
- **Init-less containers:** set `ssh_host_cert_reload_method: command` so sshd is reloaded via SIGHUP instead of the service module.
- **Never hand-edit `60-ssh-ca.conf`.** It is fetched verbatim from `GET /ssh/hosts/<id>/sshd-config` and is algorithm-aware (an ecdsa/ECIES host gets ecdsa `HostKey`/`HostCertificate` paths automatically). Re-render server-side.

---

## 3. Deploy a USER

**Prerequisites for this section:** an active **User CA** exists; the **target host is already deployed** (§2) and serving user certs (its drop-in sets `TrustedUserCAKeys /etc/ssh/ssh-user-ca.pub`, `AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u`, `RevokedKeys`); the **local UNIX accounts** the principals map to (e.g. `root`, `deploy`) already exist on the host.

### Step 1 — Create the user identity

Creates an `sshIdentities` row. `subject` is required (*"identity subject is required"*); `email` / `externalSubject` optional. New identities are `active` with `pubkeySource='per_request'`; a disabled identity cannot be issued certs. Returns the identity's `id`, which you pass as the `identityId` input to every later step.

```
POST /api/v1/ssh/identities   body: { subject, email?, externalSubject? }
tRPC  ssh.user.createIdentity
UI    /ssh/users/new → New Identity
```

### Step 2 — Create the principals (role labels)

Create each role label the user will carry (e.g. `developers`, `sysadmins`, `client-acme`). Names must match the grammar `^[A-Za-z0-9](?:[A-Za-z0-9._@-]{0,62})$`. A principal grants nothing on its own — **reuse** existing principals rather than minting one per person.

```
POST /api/v1/ssh/principals   body: { name, description? }
tRPC  ssh.principal.create
UI    /ssh → Principals → Principal catalog
```

### Step 2b — (Optional) Grant the identity the entitlement to encode each principal

Inserts an `sshUserPrincipals` (identity→principal) row: a **catalog** entitlement, distinct from host mapping. It is enforced **only** at issue time when `enforceEntitlement:true` is passed (then `assertEntitled()` rejects *"identity not entitled to principals: …"*). **tRPC-only — there is no REST route**, so REST-only automation cannot grant catalog entitlements.

```
tRPC  ssh.principal.grant   input: { identityId, principalId }
```

### Step 3 — Ensure principal → local-account host maps exist (the #1 login gotcha)

For each host the user should reach, map each of their principals to a local account. This inserts `sshHostPrincipalMaps (hostId, principalId, localAccount)` and is the **only** thing that populates `/etc/ssh/auth_principals/<account>`.

> **Skip this and you get the classic "authenticated but denied" trap:** the certificate signature verifies but the login is refused with **`Valid certificate but Permission denied`**. Login succeeds only when the same principal is in **both** the cert **and** the host's `auth_principals` file. Neither issuance nor `enforceEntitlement` checks host maps — the issue form only *warns* (via `mappingsByPrincipal`); it does not block.

```
POST /api/v1/ssh/principals/map     body: { hostId, principalId, localAccount }
GET  /api/v1/ssh/hosts/:id/auth-principals   # render/verify the exact file contents
tRPC ssh.principal.map / ssh.principal.render / ssh.principal.markPushed
```

The rendered file uses the dual form (bare `P` plus `P@<fqdn>`) plus `AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u`. Mapping bumps `host.updatedAt`, marking the host **Stale** until the file is re-deployed and **Mark pushed** is clicked. Because the server's `auth_principals` file is written by the §2 role at run time, **re-run the §2 role** (or re-push the file and click **Mark pushed**) after creating these maps — otherwise the host still carries the empty set installed on its first §2 run and §4 login will be denied.

> Two "permission" layers are easy to conflate: `enforceEntitlement` checks the identity's **catalog** entitlements (step 2b), **not** host maps. Passing `enforceEntitlement:true` still guarantees nothing about login — that depends entirely on the step-3 host maps.

### Step 4 — User generates a keypair and sends only the public key

On the **user's own machine** (private key never leaves it):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub        # send THIS to the operator
```

The backend rejects private keys / garbage early via `parseSshPublicKey`; the parsed algorithm drives the client-side filenames later. `ecdsa-sha2-nistp256` is also supported (filenames become `id_ecdsa*`).

### Step 5 — Issue the user certificate

Signs the user's public key against the User CA with their principals.

```
POST /api/v1/ssh/users/issue
  body: { identityId, sshPublicKey, principals[], caId?, extensions?,
          forceCommand?, sourceAddress?, validForSeconds?, keyId?, enforceEntitlement? }
tRPC  ssh.user.issue
UI    /ssh/users/new → Issue Certificate
```

| Field | Rule / default |
|---|---|
| `identityId`, `sshPublicKey`, `principals[]` | required; `principals` must be ≥1 (*"at least one principal (role) is required"*) |
| `caId` | defaults to the active User CA |
| `extensions` | default = all five `DEFAULT_USER_EXTENSIONS` |
| `validForSeconds` | default 7 days (`604800`) |
| `keyId` | defaults to the identity `subject` |
| `sourceAddress` | comma-separated CIDRs (validated) |
| `enforceEntitlement` | set `true` to constrain principals to the step-2b grants |

The response returns `cert.certOpenssh`, the `keyType`, and a ready-to-paste `sshClientConfig`. **Automation alternative:** `POST /api/v1/external/ssh/sign-user` (fleet-token auth, `sourceType=automation`, auto-creates the identity by `subject`) does **not** pass `enforceEntitlement`, so catalog grants are not enforced there.

### Step 6 — Install the certificate client-side (next to the private key)

Save `certOpenssh` using the **algorithm-matched** filename so ssh auto-presents it (`ed25519` → `id_ed25519-cert.pub`; `ecdsa-sha2-nistp256` → `id_ecdsa-cert.pub`):

```bash
# paste the returned cert into ~/.ssh/id_ed25519-cert.pub
chmod 644 ~/.ssh/id_ed25519-cert.pub
```

Saving under the wrong base name means ssh won't auto-present the cert.

### Step 7 — Configure `~/.ssh/config`

Use the block returned in `sshClientConfig` (narrow the `Host` pattern from `*` to your fleet):

```sshconfig
Host *.example.com
  IdentityFile ~/.ssh/id_ed25519
  CertificateFile ~/.ssh/id_ed25519-cert.pub
  IdentitiesOnly yes
```

Verify the cert's principals and validity window locally:

```bash
ssh-keygen -L -f ~/.ssh/id_ed25519-cert.pub
```

When the cert expires (~1 week) request a fresh one — **no new key needed**.

### Step 8 — Trust the servers' Host CA (client side — this is what suppresses TOFU)

Step 7 only wired the **servers-trust-users** direction. To wire the other mandatory direction from §0 — **clients trust servers** — add the Host CA `@cert-authority` line to the user's `~/.ssh/known_hosts` on the **user's own machine**. Without it, the first login shows the `The authenticity of host … can't be established` TOFU prompt:

```bash
curl "https://pki.example.com/ssh/cert-authority?pattern=*.example.com" >> ~/.ssh/known_hosts
```

This line makes the client trust any host cert signed by the Host CA directly, so there is no per-host key-acceptance prompt and no changed-fingerprint warning. (The server side of this — the host's own signed cert — was installed by the Ansible role in §2.)

---

## 4. Verify it works

Log in **as the mapped local account** (the account must map to one of the cert's principals — §3 step 3):

```bash
ssh <account>@server.example.com      # e.g. ssh deploy@server1.example.com
```

**Success looks like:**

- You land in a shell as `<account>` **with no password / no per-user `authorized_keys`** — the server honored your user cert via `TrustedUserCAKeys`, and the account's `auth_principals` file contained one of the cert's principals.
- **No TOFU:** there is **no** `The authenticity of host … can't be established` prompt and **no** changed-fingerprint warning — because the client's `~/.ssh/known_hosts` carries the Host CA `@cert-authority` line (from `GET /ssh/cert-authority?pattern=*.example.com`, added in §3 Step 8), so it trusts the server's host cert directly.

If you instead see **`Valid certificate but Permission denied`**, the certificate is fine but the principal is not in that account's `/etc/ssh/auth_principals/<account>` — revisit §3 step 3 (and re-run the §2 role / re-deploy + Mark pushed if the host shows Stale).

---

## 5. Revocation

Revocation is **two-tier**:

- **Tier 1 — short TTL (primary).** User certs expire ~weekly, host certs ~yearly; **expiry is the main revocation mechanism** — to revoke, stop re-issuing (or just re-issue). This stays load-bearing because sshd itself does **not** verify a signature on the `RevokedKeys` file it reads; on the ECIES channel the `krl-client` puller verifies the composed KRL's **Host-CA signature before installing it** (a tampered KRL is rejected, not applied), and short TTLs backstop the whole scheme.
- **Tier 2 — the KRL (emergency kill switch)** for a key you must revoke NOW.

Note the asymmetry: a server's `RevokedKeys` gates **user** logins; **host-cert** revocation is enforced client-side, not by the server's `revoked_keys`. And **blocks are not revocations** — a per-host *block* denies an identity on that host while its certs stay valid everywhere else.

### How the ECIES channel propagates a revoke or a block

The host's `krl-client` pulls `POST /api/v1/external/ssh/krl` (returns `304` with `X-KRL-Version`, or `200` with the ECIES ciphertext). Both a **plain revoke** and a **per-host block** land on the host's **next pull**: each rebuilds the composed per-host KRL the endpoint serves (`SSH_HOST_KRL_SERVE`, default **ON**).

- The **composed per-host KRL** = host-CA revocations ∪ all user-CA revocations ∪ resolved active blocks, signed with the **Host-CA** key; `krl-client` verifies it against `--ca-pubkey` (default `/etc/ssh/ssh-host-ca.pub`, from `GET /ssh/host-ca-keys`) — **not** the User CA.
- **Fail-closed:** sshd re-reads `RevokedKeys` on **every** auth, so no reload is needed once the file lands.
- **Latency** is bounded by the pull interval: **≤ 1 interval, median ≈ 7.5 min** at the default 15-min timer. An **offline host keeps its last-good KRL** and is never shown *Effective*.
- If the composed KRL is **unsigned** (e.g. KMS signing failed), `krl-client` fails-stale on last-good (**exit 4**) unless run with `--allow-unsigned`; this surfaces as `(unsigned)` in the UI pill and audit log. And remember: **clock drift** makes `krl-client` fail every run with **exit 5**, silently freezing a host on its last KRL (§0).

---

## 6. See also

Relative to `docs/ssh/`:

- [concept.md](concept.md) — read-first mental model (two CAs, two trust directions, the principals trap, two-tier revocation, the canonical order). *Link, don't restate.*
- [principals-guide.md](principals-guide.md) — the RBAC / principals design and the mapping detail behind §3.
- [setup.md](setup.md) — the by-hand server + client procedure the Ansible role automates; also the source for the user/client-side steps.
- [operator-quickstart.md](operator-quickstart.md) — the **legacy manual web-UI** "zero to first login" flow this guide supersedes for automation.
- [host-blocks-runbook.md](host-blocks-runbook.md) — per-host access-block cutover / rollback runbook (revocation after the fleet is deployed).
- [../ssh-api-contract.md](../ssh-api-contract.md) — the external endpoints the role calls, token minting, and the honest KRL trust model + env gates.
- [../../ansible/README.md](../../ansible/README.md) — the `ssh_host_cert` role reference and the full variable table this guide drives. (Dockerized proof of the same end-to-end deploy: [../../ansible/tests/e2e/README.md](../../ansible/tests/e2e/README.md).)