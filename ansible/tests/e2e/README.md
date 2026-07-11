# ssh_host_cert dockerized e2e (ANS-10)

Containers-as-managed-hosts end-to-end for the `ssh_host_cert` role. One command
proves the role produces a *working* SSH-CA node — not just that tasks run.

## Run

```bash
ansible/tests/e2e/run.sh
```

Requires docker + `ansible-core` + the `community.docker` and `community.crypto`
collections on the host. Builds the `krl-client` static binary via `make
build-static` if it is missing. **Skips cleanly (exit 0)** when docker or KMS is
unavailable — so it is CI-safe as a gated job (mirrors the `KMS_AVAILABLE`
pattern).

Environment:
- `E2E_BACKEND_PORT` (default `43000`) — the published backend port.

## Topology (one docker network)

| Service | Role |
|---|---|
| `kms` | Cosmian KMS (mirrors the dev `kms/` config: `:latest` + `kms.toml`) |
| `backend` | PKI Manager API, `SSH_ECIES_ENABLED` + `SSH_HOST_KRL_PUBLIC` on, OIDC off, published to the host |
| `host_public` | managed host — ed25519 key, public-path curl KRL cron, known_hosts + X.509 stretch enabled |
| `host_ecies` | managed host — ecdsa key, encrypted `krl-client` puller |
| `client` | drives real `ssh` logins |

Ansible runs on the host via the `community.docker` connection; the backend is
published so the controller and the containers share one base URL
(`http://<host-ip>:<port>`). The backend is seeded over its public REST surface
plus one tRPC token mint (`seed.py`); OIDC is intentionally off.

## What each phase asserts

1. **converge** — the role applies to both hosts with no failures (AC#1).
2. **idempotence** — a second converge reports `changed=0` on both hosts (AC#2).
3. **cert login / RBAC** — `alice` (mapped principal) logs in under
   `StrictHostKeyChecking=yes` with **no TOFU** via the `@cert-authority` line;
   `mallory` (unlisted principal) is denied (AC#3).
4. **known_hosts (ANS-08)** — the `@cert-authority` line lands on `host_public`,
   and `host_public` trusts another host's cert with no TOFU.
5. **X.509 stretch (ANS-09)** — a leaf `openssl verify`s against the
   role-installed CA trust anchor; the refreshed CRL parses.
6. **revocation narrowing** — a block on `host_public` (curl-cron channel) denies
   `alice` there while she stays accepted on `host_ecies` (AC#4); a block on
   `host_ecies` + a `krl-client` pull installs a signature-verified `RevokedKeys`
   that denies `alice` there (AC#5).

The stack is torn down (`compose down -v`) on exit.
