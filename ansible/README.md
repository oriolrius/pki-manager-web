# Ansible — SSH host certificate deployment

The `ssh_host_cert` role and the `pki_manager` module that drives the PKI Manager
REST API now live in the **[`oriolrius.pki_manager`](https://github.com/oriolrius/pki-manager-ansible)**
Ansible Collection ([Galaxy](https://galaxy.ansible.com/ui/repo/published/oriolrius/pki_manager/)).
This directory keeps only a thin deploy entry point (`site.yml`) that consumes
the collection, plus the dockerized end-to-end suite under [`tests/e2e/`](tests/e2e/README.md).

The role provisions a **full SSH-CA node** in one run: the host key is generated
on the node (private key never leaves it), its public key is signed, the
User/Host-CA trust anchors + login-RBAC principals + the authoritative sshd
drop-in are installed, unattended renewal is set up, and a KRL revocation channel
(public cron **or** encrypted `krl-client`) is deployed. Every PKI Manager API
call goes through the collection module (REST, no `curl`).

## Usage

```bash
cd ansible
ansible-galaxy collection install -r requirements.yml   # pulls oriolrius.pki_manager + community.crypto

# fleet token (pkimg_…, scoped to the Host CA) via Ansible Vault:
ansible-vault create secrets.yml      # set: ssh_ca_fleet_token: pkimg_…

cp inventory.yml.example inventory.yml   # edit hosts
ansible-playbook -i inventory.yml site.yml \
  -e ssh_ca_base_url=https://pki.example.com \
  -e @secrets.yml --ask-vault-pass
```

## Where things are

| What | Where |
|---|---|
| The `ssh_host_cert` role + variable reference | [`oriolrius.pki_manager` → `roles/ssh_host_cert`](https://github.com/oriolrius/pki-manager-ansible/blob/main/roles/ssh_host_cert/README.md) |
| Every SSH API action (`pki_manager` module) | [collection README](https://github.com/oriolrius/pki-manager-ansible#ssh-certificate-workflow) |
| Complete deploy-a-server-**and**-a-user example | [`examples/ssh_deploy_server_and_user.yml`](https://github.com/oriolrius/pki-manager-ansible/blob/main/examples/ssh_deploy_server_and_user.yml) |
| Operator guide (mental model → login → revoke) | [`docs/ssh/deploy-server-and-user.md`](../docs/ssh/deploy-server-and-user.md) |
| Dockerized containers-as-hosts e2e | [`tests/e2e/`](tests/e2e/README.md) |

> Until `oriolrius.pki_manager >= 2.3.0` is published to Galaxy, `requirements.yml`
> installs the collection from its `feat/ssh-workflow` git branch. Switch to the
> Galaxy version once released.

For per-host access blocks (decision-016) — trust-anchor ordering, canary,
cutover, rollback — follow [`docs/ssh/host-blocks-runbook.md`](../docs/ssh/host-blocks-runbook.md).
