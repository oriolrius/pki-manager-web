# Ansible — SSH host certificate deployment

The `ssh_host_cert` role deploys SSH host certificates via the **PKI Manager
external API** (SSH-31). It follows Jan-Piet Mens' pattern: the Ed25519 host key
is generated **on the node** (the private key never leaves it); only the public
key is signed, by `POST /api/v1/external/ssh/sign-host` with a fleet bearer token.

## What it does

1. Generates `/etc/ssh/ssh_host_ed25519_key` on the node (`community.crypto.openssh_keypair`).
2. Signs its public key via the external API (idempotent on host + fingerprint),
   installs the cert at `…-cert.pub` (mode `0444`).
3. Fetches and installs the User CA trust bundle (`TrustedUserCAKeys`).
4. Fetches and installs the **Host CA trust anchor**
   (`/etc/ssh/ssh-host-ca.pub`) — the key KRL pullers verify composed-KRL
   signatures against (BLK-10). **Ordering matters**: this must land on every
   host BEFORE the per-host KRL cutover (see the
   [cutover runbook](../docs/ssh/host-blocks-runbook.md)).
5. Writes the `sshd_config.d/60-ssh-ca.conf` drop-in (HostCertificate,
   TrustedUserCAKeys, AuthorizedPrincipalsFile, RevokedKeys), runs `sshd -t`,
   and reloads sshd.
6. *(optional, `ssh_host_cert_ecies_enabled: true`)* registers the host's ECIES
   key for encrypted KRL distribution (see `services/krl-distributor/`).
7. *(optional, `ssh_host_cert_krl_cron_enabled: true`)* installs a cron that
   refreshes `RevokedKeys` from the public KRL endpoint. To receive **per-host
   access blocks** on such hosts, switch `ssh_host_cert_krl_fetch_url` to
   `{{ ssh_ca_base_url }}/krl/hosts/{{ ansible_fqdn }}.bin` (one line) AND run
   the backend with `SSH_HOST_KRL_PUBLIC=true`.

## Usage

```bash
cd ansible
ansible-galaxy collection install -r requirements.yml

# Provide the fleet token via Ansible Vault (never in plain inventory):
ansible-vault create secrets.yml      # set: ssh_ca_fleet_token: pkimg_…

ansible-playbook -i inventory.ini site.yml \
  -e ssh_ca_base_url=https://pki.example.com \
  -e @secrets.yml --ask-vault-pass
```

Mint the fleet token (scoped to the Host CA + `sign-host`) from the PKI Manager
UI or `trpc.ssh.token.mint`; it is shown once. See
[`docs/ssh-api-contract.md`](../docs/ssh-api-contract.md) for the full endpoint
contract and the (honest) KRL trust model.

## Key variables (`roles/ssh_host_cert/defaults/main.yml`)

| Variable | Default | Meaning |
|---|---|---|
| `ssh_ca_base_url` | `https://pki.internal` | PKI Manager base URL |
| `ssh_ca_fleet_token` | `""` | bearer token (**vault this**) |
| `ssh_host_cert_ecies_enabled` | `false` | also register the ECIES KRL key |
| `ssh_host_cert_host_ca_pub` | `/etc/ssh/ssh-host-ca.pub` | Host CA trust anchor (KRL signature verify) |
| `ssh_host_cert_krl_cron_enabled` | `false` | install the public-path KRL refresh cron |
| `ssh_host_cert_krl_fetch_url` | per-CA `/krl/<caId>.bin` | switch to `/krl/hosts/<fqdn>.bin` for per-host blocks |
| `ssh_host_cert_sshd_service` | `ssh` | service unit to reload |

NTP is a hard prerequisite — certificate validity and KRL freshness depend on it.

For per-host access blocks (decision-016) — trust-anchor ordering, canary,
cutover, rollback and the accepted residual limitations — follow
[`docs/ssh/host-blocks-runbook.md`](../docs/ssh/host-blocks-runbook.md).
