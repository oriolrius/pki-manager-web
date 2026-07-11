# Ansible — SSH host certificate deployment

The `ssh_host_cert` role provisions a **full SSH-CA-managed node** from a single
`ansible-playbook` run against the **PKI Manager external API**. It follows
Jan-Piet Mens' pattern — the host key is generated **on the node** (the private
key never leaves it); only the public key is signed.

A host provisioned by this role is a *working* SSH-CA node: cert-based login with
principal RBAC, the algorithm-aware sshd config the server renders, unattended
renewal before expiry, and a revocation channel (public KRL cron **or** the
encrypted `krl-client` puller). Delivered by the Ansible Integration milestone
(`backlog/docs/doc-009`).

## What it does

1. **Host key** — generates `/etc/ssh/ssh_host_ed25519_key` (or an
   `ecdsa-sha2-nistp256` key when ECIES is enabled — see below) on the node.
2. **Sign + install** — signs the public key via `POST /sign-host` (idempotent on
   host+fingerprint) and installs the cert at `…-cert.pub` (`0444`).
3. **Trust anchors** — installs the User-CA bundle (`TrustedUserCAKeys`) and the
   **Host-CA trust anchor** (`/etc/ssh/ssh-host-ca.pub`) that KRL pullers verify
   composed-KRL signatures against (BLK-10). Ordering matters: the Host-CA anchor
   must land before the per-host KRL cutover (see the
   [cutover runbook](../docs/ssh/host-blocks-runbook.md)).
4. **Login RBAC (ANS-02)** — creates `/etc/ssh/auth_principals/` and installs the
   authoritative per-account principal files fetched from the host-fetch endpoint
   (`GET /hosts/<fqdn>/auth-principals`, fleet-token auth). Without this a valid
   User-CA cert is denied. Also guarantees a fail-closed `RevokedKeys` placeholder.
5. **Authoritative sshd drop-in (ANS-03)** — installs
   `/etc/ssh/sshd_config.d/60-ssh-ca.conf` fetched **verbatim** from
   `GET /ssh/hosts/<id>/sshd-config` (single source of truth — algorithm-aware,
   so an ecdsa host gets ecdsa paths), runs `sshd -t`, and reloads sshd on change.
6. **Unattended renewal (ANS-04)** — a host-side cron/systemd job re-invokes
   `/sign-host` with a period-rotating Idempotency-Key so the cert is re-minted
   well before its 52-week expiry, installed atomically with a reload.
7. *(ECIES, `ssh_host_cert_ecies_enabled: true`)* provisions the ecdsa host key,
   **registers** it (`/register-host-pubkey`), and installs the
   [`krl-client`](../krl-client/) puller — binary, config, state dir, scheduler —
   which pulls, decrypts (local ecdsa key), verifies, and installs `RevokedKeys`
   (ANS-05/06/07). The backend must run with `SSH_ECIES_ENABLED=true`.
8. *(public cron, `ssh_host_cert_krl_cron_enabled: true`)* installs a cron that
   refreshes `RevokedKeys` from the public KRL endpoint. For **per-host access
   blocks**, point `ssh_host_cert_krl_fetch_url` at
   `{{ ssh_ca_base_url }}/krl/hosts/{{ ansible_fqdn }}.bin` and run the backend
   with `SSH_HOST_KRL_PUBLIC=true`.
9. *(client hosts, ANS-08)* optionally installs a `known_hosts` `@cert-authority`
   line so a bastion/CI host trusts other hosts' certs with no TOFU.
10. *(stretch, ANS-09)* optionally installs an X.509 CA into the OS trust store
    and a CRL refresh cron (non-SSH; off by default).

Cert-based login, principal RBAC, both KRL channels, renewal, idempotence and
real-sshd behavior are proven by the dockerized e2e (see **Testing** below).

## Requirements

The role needs the **`community.crypto`** collection on the controller
(`openssh_keypair`). Install it before the first run:

```bash
cd ansible
ansible-galaxy collection install -r requirements.yml
```

## Usage

```bash
# 1. install the galaxy dependency (once)
ansible-galaxy collection install -r requirements.yml

# 2. provide the fleet token via Ansible Vault (never in plain inventory)
ansible-vault create secrets.yml      # set: ssh_ca_fleet_token: pkimg_…

# 3. run
ansible-playbook -i inventory.ini site.yml \
  -e ssh_ca_base_url=https://pki.example.com \
  -e @secrets.yml --ask-vault-pass
```

Mint the fleet token from the PKI Manager UI or `trpc.ssh.token.mint`. For a
**fully self-provisioning** host the token needs the ops `sign-host`,
`get-principals`, and — for ECIES — `register-host-pubkey`, all scoped to the
Host CA. It is shown once. See
[`docs/ssh-api-contract.md`](../docs/ssh-api-contract.md) for the endpoint
contract and the (honest) KRL trust model.

### ECIES + renewal example

```yaml
# group_vars/ecies_hosts.yml
ssh_ca_base_url: https://pki.example.com
ssh_host_cert_ecies_enabled: true          # ecdsa host key + krl-client puller
ssh_host_cert_krl_client_url: https://artifacts.example.com/krl-client-linux-amd64
ssh_host_cert_krl_client_checksum: "sha256:<hex>"
ssh_host_cert_krl_client_man_src: files/krl-client.8   # optional man page
ssh_host_cert_scheduler: systemd           # timers + StateDirectory + time-sync ordering
ssh_host_cert_renew_enabled: true          # weekly re-mint (ISO-week bucket)
ssh_host_cert_krl_client_ca_bundle: /etc/pki/tls/certs/private-ca.pem  # private-CA TLS server
```

## Enforced prerequisites (not just prose)

The role **fails fast** rather than deploying a broken puller (ANS-07):

- **`SSH_ECIES_ENABLED` backend flag** — `register-host-pubkey` is asserted to
  return `200`; a `501` (ECIES disabled) fails with an actionable message.
- **ecdsa host key** — ECIES is P-256-only; the role provisions an
  `ecdsa-sha2-nistp256` host key so registration cannot `409`.
- **NTP / time-sync** — a `409`/exit-5 hard prerequisite. The role asserts an
  active time-sync daemon (chrony / systemd-timesyncd / ntp, or a synced
  `timedatectl`). Disable only in a controlled test where the container inherits
  a synced host clock (`ssh_host_cert_require_timesync: false`).

## Key variables (`roles/ssh_host_cert/defaults/main.yml`)

### Endpoints & host key
| Variable | Default | Meaning |
|---|---|---|
| `ssh_ca_base_url` | `https://pki.internal` | PKI Manager base URL |
| `ssh_ca_fleet_token` | `""` | bearer token (**vault this**) |
| `ssh_host_cert_validate_certs` | `true` | verify the server's TLS cert |
| `ssh_host_cert_ecies_enabled` | `false` | ecdsa host key + register + krl-client puller |
| `ssh_host_cert_sshd_service` | `ssh` | service unit to reload |
| `ssh_host_cert_reload_method` | `service` | `service` or `command` (SIGHUP, for init-less containers) |
| `ssh_host_cert_scheduler` | `cron` | `cron` (portable) or `systemd` (timers) |

### Principals (ANS-02)
| Variable | Default | Meaning |
|---|---|---|
| `ssh_host_cert_principals_enabled` | `true` | populate `AuthorizedPrincipalsFile` |
| `ssh_host_cert_principals_prune` | `false` | remove account files no longer in the render |

### Renewal (ANS-04)
| Variable | Default | Meaning |
|---|---|---|
| `ssh_host_cert_renew_enabled` | `true` | install the host-side renewal job (stores the token on-host, 0600) |
| `ssh_host_cert_renew_bucket_format` | `%G-%V` | `date -u` bucket; weekly re-mint (`%Y-%m` = monthly) |
| `ssh_host_cert_renew_cron` | `17 3 * * *` | cron schedule |
| `ssh_host_cert_renew_oncalendar` | `*-*-* 03:17:00` | systemd `OnCalendar` |

### krl-client puller (ANS-06/07)
| Variable | Default | Meaning |
|---|---|---|
| `ssh_host_cert_krl_client_url` | `""` | binary source (`https://…` artifact or `file:///…`) |
| `ssh_host_cert_krl_client_checksum` | `""` | `sha256:…` (idempotent + tamper guard) |
| `ssh_host_cert_krl_client_man_src` | `""` | man-page source on the controller (empty = skip) |
| `ssh_host_cert_krl_client_ca_bundle` | `""` | `--ca-bundle` TLS roots for a private-CA server |
| `ssh_host_cert_krl_client_interval_minutes` | `15` | pull cadence |
| `ssh_host_cert_require_timesync` | `true` | assert an active NTP daemon |

### Public KRL cron (BLK-12) · known_hosts (ANS-08) · X.509 stretch (ANS-09)
| Variable | Default | Meaning |
|---|---|---|
| `ssh_host_cert_krl_cron_enabled` | `false` | public-path `RevokedKeys` refresh cron |
| `ssh_host_cert_krl_fetch_url` | per-CA `/krl/<caId>.bin` | switch to `/krl/hosts/<fqdn>.bin` for per-host blocks |
| `ssh_host_cert_known_hosts_enabled` | `false` | install `@cert-authority` line (client/bastion hosts) |
| `ssh_host_cert_known_hosts_pattern` | `*` | host pattern for the trust line |
| `ssh_host_cert_x509_ca_trust_enabled` | `false` | install an X.509 CA into the OS trust store |
| `ssh_host_cert_x509_crl_cron_enabled` | `false` | X.509 CRL refresh cron |
| `ssh_host_cert_x509_ca_id` | `""` | backend CA id for `/cas/:id.pem` and `/crl/:id.crl` |

## Testing — dockerized containers-as-hosts e2e

A single command stands up backend+KMS, applies the role to a public-cron
(ed25519) host and an ecies (ecdsa) host, asserts idempotence, and drives real
`ssh` from a client container — cert login with no TOFU, principal RBAC, and
per-host revocation narrowing on **both** KRL channels. Skips cleanly (exit 0)
when docker/KMS is unavailable.

```bash
ansible/tests/e2e/run.sh
```

See [`tests/e2e/README.md`](tests/e2e/README.md) for the topology and what each
assertion proves.

For per-host access blocks (decision-016) — trust-anchor ordering, canary,
cutover, rollback and the accepted residual limitations — follow
[`docs/ssh/host-blocks-runbook.md`](../docs/ssh/host-blocks-runbook.md).
