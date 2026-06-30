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
4. Writes the `sshd_config.d/60-ssh-ca.conf` drop-in (HostCertificate,
   TrustedUserCAKeys, AuthorizedPrincipalsFile, RevokedKeys), runs `sshd -t`,
   and reloads sshd.
5. *(optional, `ssh_host_cert_ecies_enabled: true`)* registers the host's ECIES
   key for encrypted KRL distribution (see `services/krl-distributor/`).

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
| `ssh_host_cert_sshd_service` | `ssh` | service unit to reload |

NTP is a hard prerequisite — certificate validity and KRL freshness depend on it.
