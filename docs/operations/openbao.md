# Operate the OpenBao key store

Use this procedure for a **new PKI Manager v4 installation**. The backend stores certificates and key references in SQLite. The OpenBao fork stores key material in encrypted Raft storage. The backend uses two separate OpenBao credentials. Each credential has its own AppRole, its own policy and its own Agent. The backend reads each Agent token from a file on each request.

| Credential | AppRole and policy | Agent (Compose service) | Backend setting | Reaches |
|---|---|---|---|---|
| X.509 and SSH | `pki-manager-backend` | `openbao-agent` | `OPENBAO_TOKEN_FILE` | X.509 and SSH mounts only |
| SCEP RA | `pki-manager-ra` | `openbao-agent-ra` (profile `scep`) | `OPENBAO_RA_TOKEN_FILE` | RA mount only |

Only the RA credential can recover a CMS session key or sign with an RA key. The X.509/SSH token gets HTTP 403 on the RA mount. The RA token gets HTTP 403 on the X.509 and SSH mounts. The backend binds each RA operation to the authenticated SCEP integration and to the key name and version of its RA binding. A client cannot select the key. An installation without SCEP does not run the RA Agent. Its X.509 and SSH functions work, and the RA endpoints answer HTTP 503. The backend refuses to start when `OPENBAO_RA_TOKEN_FILE` names the same file as `OPENBAO_TOKEN_FILE`.

A v3 installation has its keys in Cosmian. Keep its matched application and KMS backups. Starting this stack against an existing v3 database does not transfer any keys. See [Docker deployment](deployment.md).

## Prepare the host

Run these commands in Bash from the repository root on the deployment host. Use the backend and frontend from the same PKI Manager version. Set the UI, OIDC and public CRL URL in the Docker deployment configuration before you issue certificates.

1. Select and verify the fork image. The version and source commit come from [image.env](../../openbao/image.env).

   ```bash
   export OPENBAO_IMAGE="$(bash scripts/openbao-image.sh ensure)"
   bash scripts/openbao-image.sh verify "$OPENBAO_IMAGE"
   dc() { docker compose -f docker/docker-compose.yml "$@"; }
   ```

   Persist the verified image reference as `OPENBAO_IMAGE` in `docker/.env` for subsequent sessions. For a local build, set `IMAGE_TAG` to your local tag and run `dc build backend frontend`.

2. Prepare the bind mounts. The OpenBao process runs as UID 1000. The Agent, bootstrap helper and backend run as UID 1001. The configuration and policies contain no credentials.

   ```bash
   sudo install -d -o 1000 -g 1000 -m 0700 openbao/state/{data,logs,tls}
   sudo install -d -o 1001 -g 1001 -m 0700 openbao/state/{approle,token,approle-ra,token-ra} pki
   sudo chmod a+rx openbao/{config,agent,scripts,policies}
   sudo chmod a+r openbao/config/openbao.hcl openbao/agent/*.hcl \
     openbao/scripts/bootstrap.sh openbao/policies/*.hcl
   ```

3. Install a server certificate issued by your deployment CA. Include the DNS SAN `openbao` and the IP SAN `127.0.0.1`. Compose clients and the local operator CLI use these two addresses. Install the server chain in PEM format, its matching private key and the public CA certificate.

   ```bash
   sudo install -o 1000 -g 1000 -m 0400 /secure/tls/server-key.pem openbao/state/tls/server-key.pem
   sudo install -o 1000 -g 1000 -m 0644 /secure/tls/server.pem openbao/state/tls/server.pem
   sudo install -o 1000 -g 1000 -m 0644 /secure/tls/ca.pem openbao/state/tls/ca.pem
   ```

   The server mounts the TLS directory. Each client mounts the public CA file. Keep the issuing CA's private key on its own system.

## Initialize and unseal

1. Start only the server. Inspect the seal status.

   ```bash
   dc up -d openbao
   dc exec openbao bao status
   ```

   A sealed server reports exit code 2. For an existing initialized store, go directly to the unseal step. If an existing store reports `Initialized false`, verify its Raft mount and backup before proceeding.

2. Initialize an empty store once. Use a private operator terminal. This example assigns three shares to separate custodians and requires two to unseal the store. Protect the initial root token separately. For encrypted delivery to custodians, use the PGP options of [bao operator init](https://openbao.org/docs/commands/operator/init/).

   ```bash
   dc exec openbao bao operator init -key-shares=3 -key-threshold=2
   ```

3. Have two custodians enter their shares. Run this command once per custodian. The CLI prompts for the share. After a server restart, repeat this step.

   ```bash
   dc exec openbao bao operator unseal
   ```

4. Verify that `dc exec openbao bao status` reports `Sealed false`. The production deployment uses a single Raft node. File audit records go to `openbao/state/logs/audit.log`.

## Configure access and start the application

1. Use the initial root token for the first configuration. For subsequent operations, use an operator identity with the required permissions. Read its token from a secret store or a private terminal. Keep shell tracing off.

   ```bash
   read -rs -p 'OpenBao operator token: ' BAO_TOKEN
   echo
   export BAO_TOKEN
   dc run --rm --no-deps -T -e BAO_TOKEN openbao-bootstrap configure
   dc run --rm --no-deps -T -e BAO_TOKEN openbao-bootstrap approle-credentials
   # SCEP only: the RA credential.
   dc run --rm --no-deps -T -e BAO_TOKEN openbao-bootstrap approle-credentials ra
   unset BAO_TOKEN
   ```

   The helper installs the ACL policies, both AppRoles and their token roles. Each AppRole carries one policy. The helper writes `role-id` and `secret-id` as UID 1001 with mode 0400 in `openbao/state/approle/` (X.509 and SSH) or `openbao/state/approle-ra/` (SCEP RA). Each Agent retains its SecretID across restarts. Set up and test an independent operator login before retiring the initial root token.

   | Purpose | Transit mount | Compose setting |
   |---|---|---|
   | X.509 CA and leaf keys | `pki-manager` | `OPENBAO_TRANSIT_MOUNT` |
   | SSH CA keys | `pki-manager-ssh` | `OPENBAO_SSH_MOUNT` |
   | SCEP RA keys | `pki-manager-ra` | `OPENBAO_RA_MOUNT` |

   Configure three distinct mounts before the first key. Keep the same names through restarts and restores. Changing a variable does not move existing keys.

2. Start the Agents and wait for the token files. Each Agent loads the shared `common.hcl` (server address and CA) and its own file (`agent.hcl` or `agent-ra.hcl`). For SCEP, set `COMPOSE_PROFILES=scep` in `docker/.env`, so that every `dc` command includes the RA Agent. The following check runs as UID 1001 and only prints file metadata.

   ```bash
   dc up -d openbao-agent
   dc exec -T openbao-agent sh -ec '
     for i in $(seq 1 30); do test -s /openbao/token/backend-token && break; sleep 1; done
     test -r /openbao/token/backend-token && test -s /openbao/token/backend-token
     stat -c "%u:%g %a" /openbao/token/backend-token
   '
   # SCEP only:
   dc up -d openbao-agent-ra
   dc exec -T openbao-agent-ra sh -ec '
     for i in $(seq 1 30); do test -s /openbao/token-ra/ra-token && break; sleep 1; done
     stat -c "%u:%g %a" /openbao/token-ra/ra-token
   '
   ```

   Expected output is `1001:1001 400` for each file. On a permission error, check that UID 1001 can traverse the mounted Agent configuration directory and read the `.hcl` files. The backend has read-only mounts of the two token directories. Only the Agents and the bootstrap helper mount the AppRole credentials. `dc ps` shows an Agent as healthy after it has written its token.

3. Start the application. Verify database migration and backend readiness.

   ```bash
   dc up -d --no-build --wait backend frontend
   dc ps
   dc logs --tail=50 backend
   ```

   Issue a certificate from a test CA and verify it against that CA. An HTTP health check alone does not exercise a key. The backend uses HTTPS to reach OpenBao on its internal network. With SCEP, complete one enrollment through the gateway. Without the RA Agent, the backend logs a warning at startup for each existing SCEP RA binding, and RA requests answer HTTP 503.

## Upgrade an installation that has one backend AppRole

Earlier v4 builds gave the `pki-manager-backend` AppRole both policies, `pki-manager-backend` and `pki-manager-ra`. With that AppRole, an X.509 or SSH token can also recover SCEP session keys. Apply the split as follows:

1. Update the repository files (policies, Agent configuration and Compose file) together. Create `openbao/state/approle-ra` and `openbao/state/token-ra` as in [Prepare the host](#prepare-the-host). Obtain an operator token. Run `configure` again, and for SCEP run `approle-credentials ra`. The operator policy must be the new one: `configure` writes it, so the first run needs the root token or an identity that can write `sys/policies/acl/pki-manager-operator`.
2. A renewed AppRole token keeps the policies of its login. Revoke the existing Agent tokens, then restart the Agents. Until the restart, the backend gets HTTP 403.

   ```bash
   dc run --rm --no-deps -T -e BAO_TOKEN openbao-bootstrap revoke-agent-tokens
   dc up -d --force-recreate openbao-agent openbao-agent-ra   # omit openbao-agent-ra without SCEP
   dc up -d --no-build --force-recreate backend
   ```

3. Issue a certificate, sign an SSH certificate if you use SSH, and complete one SCEP enrollment. In the audit log, a successful call on the RA mount must name only the `pki-manager-ra` policy, and a successful call on the X.509 or SSH mount only `pki-manager-backend`:

   ```bash
   sudo jq -r 'select(.type=="response" and (.request.path // "" | startswith("pki-manager")) and (.error // "") == "")
     | [(.request.path | split("/")[0]), ((.auth.policies // []) | join("+"))] | @tsv' \
     openbao/state/logs/audit.log | sort | uniq -c
   ```

   Use your mount names if you changed them. The expected rows are `pki-manager pki-manager-backend`, `pki-manager-ssh pki-manager-backend` and `pki-manager-ra pki-manager-ra`. Rows from before the restart can still show both policies.

## Renew tokens and rotate the SecretID

Each AppRole issues a renewable one-hour token with a maximum lifetime of 24 hours. Each Agent can renew its own token and log in again with its SecretID. The backend reads each replacement token without a restart. A test with fork commit `326bb49` verified a 3,600-second renewal, a fresh token after an Agent restart, and create/read/sign on all three mounts. The runtime token received HTTP 403 for `GET /v1/sys/mounts`. A test of the split credentials with the published fork image `2.7.3-pki-manager.2` verified a fresh token after each Agent restart, recovery after a seal and unseal without a restart of the backend or the Agents, and RA SecretID rotation with the operator policy.

The configured SecretIDs have unlimited uses and no expiry. To replace one, take these steps in a private operator shell. The operator needs permission to look up the old SecretID, issue a new one and destroy the old accessor. The accessor identifies a SecretID for revocation. The steps use the X.509/SSH credential. For the RA credential, use `role=auth/approle/role/pki-manager-ra`, the file `openbao/state/approle-ra/secret-id`, `approle-credentials ra` and the service `openbao-agent-ra`.

1. Obtain an operator token as above. Save the old accessor **before** the helper replaces the file.

   ```bash
   role=auth/approle/role/pki-manager-backend
   old_accessor="$(sudo cat openbao/state/approle/secret-id |
     dc exec -T -e BAO_TOKEN openbao bao write -field=secret_id_accessor \
       "$role/secret-id/lookup" secret_id=-)"
   test -n "$old_accessor"
   ```

2. Issue a new credential and restart the Agent. Check that the Agent reports a successful authentication and a fresh write to the sink. Verify a signing operation through the backend before revoking the old credential. For the RA credential, complete a SCEP enrollment.

   ```bash
   dc run --rm --no-deps -T -e BAO_TOKEN openbao-bootstrap approle-credentials
   dc restart openbao-agent
   dc logs --since=1m openbao-agent
   ```

3. Destroy the old SecretID by accessor. This prevents new logins with that SecretID. Its previously issued tokens retain their own expiry. For incident response, run `revoke-agent-tokens` (it revokes the tokens of both AppRoles) and restart the Agents, as in the upgrade procedure.

   ```bash
   dc exec -T -e BAO_TOKEN openbao bao write "$role/secret-id-accessor/destroy" \
     secret_id_accessor="$old_accessor"
   unset BAO_TOKEN old_accessor
   ```

## Issue and revoke a migration token

The v3 key migration (`pki-migrate`) uses its own short-lived identity, never the backend AppRole. Its policy is `pki-manager-migration`, from [scripts/migration/policies/pki-manager-migration.hcl](../../scripts/migration/policies/pki-manager-migration.hcl). It reads the wrapping keys, imports new keys, reads them and signs a challenge on the three mounts. It cannot export, back up, configure, rotate or delete keys, recover RA session keys or create tokens. Preflight reads mount metadata under `sys/internal/ui/mounts/`. The backend and RA policies have no import path and no wrapping-key read. The runtime tokens cannot create a migration token. See the [migration guide](openbao-migration.md) for the verify options.

| Operation | Identity |
|---|---|
| `approve-template`, `preflight`, `apply`, `verify` | migration token |
| RA mount calls of `verify`, and `verify --ra-session-check` (SCEP session-key recovery) | RA token (`pki-manager-ra`), with `--openbao-ra-token-file` |
| `backup --openbao-*` (Raft snapshot) | operator token |

1. Obtain an operator token as above. Install the policy and the token role once. The helper reads the policy from stdin and rewrites the mount names from `OPENBAO_*_MOUNT`.

   ```bash
   dc run --rm --no-deps -T -e BAO_TOKEN openbao-bootstrap migration-setup \
     < scripts/migration/policies/pki-manager-migration.hcl
   ```

2. Issue a token for one migration window. The token has no `default` policy and cannot be renewed. `MIGRATION_TOKEN_TTL` defaults to `1h`. The token role limits it to `8h`. The helper writes only the token to stdout and refuses a terminal. Record the accessor that it prints on stderr.

   ```bash
   install -d -m 0700 "$HOME/pki-migration"
   (umask 077; MIGRATION_TOKEN_TTL=2h dc run --rm --no-deps -T -e BAO_TOKEN \
     -e MIGRATION_TOKEN_TTL openbao-bootstrap migration-token \
     > "$HOME/pki-migration/openbao-token")
   ```

   Give the file to the migration tool with `--openbao-token-file`.

3. Revoke the token when the run ends, also before its expiry. The helper revokes only a token whose policy list is exactly `pki-manager-migration`. Then delete the file.

   ```bash
   MIGRATION_TOKEN_ACCESSOR='<accessor>' dc run --rm --no-deps -T -e BAO_TOKEN \
     -e MIGRATION_TOKEN_ACCESSOR openbao-bootstrap migration-revoke
   rm -f "$HOME/pki-migration/openbao-token"
   unset BAO_TOKEN
   ```

On a disposable rehearsal stack, `node openbao/scripts/check-migration-token.mts` proves these limits and the separation from the runtime tokens (set `OPENBAO_TOKEN_FILE` and `OPENBAO_RA_TOKEN_FILE`). It imports throw-away keys that nobody can delete. Never run it against production.

## Back up and restore SQLite and Raft together

1. Record the application image IDs, fork image ID, mount names, TLS trust, current CA certificates and SSH CA fingerprints. Secure the deployment configuration, TLS credentials and audit records under your backup policy. Keep Shamir shares in separate custody.
2. Pause external issuers, SCEP gateways and other writers. Stop the application, Agent and OpenBao in that order. Make one offline copy of both data directories. This also captures SQLite WAL files if present.

   ```bash
   dc stop frontend backend
   dc stop openbao-agent
   dc stop openbao
   backup_dir="$(sudo mktemp -d /var/backups/pki-openbao.XXXXXXXX)"
   sudo tar --numeric-owner -czf "$backup_dir/state.tar.gz" pki openbao/state/data
   sudo sh -ec 'cd "$1"; sha256sum state.tar.gz > SHA256SUMS' sh "$backup_dir"
   ```

   Move the archive and checksum to protected backup storage. Retain the matching application revision and OpenBao configuration. For normal service, start the same server, unseal it, then start the Agent and application as above.

3. Restore first on an isolated host with empty target directories. Install the recorded versions and prepare the host and TLS files. Verify the checksum and extract the two directories as one set, from the repository root.

   ```bash
   sudo sh -ec 'cd "$1"; sha256sum -c SHA256SUMS' sh "$backup_dir"
   sudo tar --numeric-owner -xzpf "$backup_dir/state.tar.gz"
   dc up -d openbao
   ```

4. Unseal the **restored** Raft store with its original shares. Use its operator login to issue a new SecretID for each AppRole in use. Start the Agents and the backend. Compare the restored CA fingerprints and revocation state with the saved values. Issue a new certificate and CRL and verify both with a pre-backup CA certificate. If SSH or SCEP is in use, sign an SSH certificate or complete gateway enrollment against the restored identity. Keep the original installation offline from the recovery test.
