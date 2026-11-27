# Migrate v3 keys to OpenBao

PKI Manager v4 keeps every private key in OpenBao Transit. A v3 installation keeps them in a
Cosmian KMS. `pki-migrate` moves the v3 keys and certificates to OpenBao and writes the v4
references into a copy of the database. The tool runs offline, with the application stopped.
It is not part of the backend image or of the v4 runtime.

The tool is [scripts/migration/pki-migrate.ts](../../scripts/migration/pki-migrate.ts). It needs Node 22.18 or later
and has no dependencies. It reads the v3 database copy only. It never writes that copy.

## What it does and does not do

| It does | It does not |
|---|---|
| Inventory every key and certificate reference, with no change anywhere (dry run) | Touch the live database or start the application |
| Move each approved key **wrapped**: Cosmian encrypts it to the OpenBao wrapping key, and only OpenBao decrypts it | Hold a private key in clear, write one to disk, or export a key that the source refuses |
| Keep the key identity: the same public key, checked by SHA-256 of the SubjectPublicKeyInfo and by a new signature | Generate a replacement key in silence |
| Write v4 rows in one transaction, compare-and-set on each row | Overwrite a row or an OpenBao key that holds another value |
| Resume after a crash, and do nothing on a second run | Rotate a key that cannot move (it gives the rotation steps) |
| Verify the result, also after a restore, with Cosmian stopped | Remove the Cosmian objects (you do that after the recovery window) |

## How v3 objects map to v4

| v3 (Cosmian) | v4 (OpenBao and SQLite) |
|---|---|
| X.509 CA and leaf private key, `kms_key_id` | Transit key in mount `pki-manager`, named `x509-ca-<id>` or `x509-leaf-<id>`, version 1. A `keystore_objects` row with the **same id**: `private_key`, mount, name, version, algorithm, `exportable`, `purpose`, public key PEM |
| Its linked public key (KMIP `PublicKeyLink`) | `keystore_objects` row `public_key` with the same Transit key |
| CA and leaf certificate, `kms_certificate_id` | `keystore_objects` row `certificate` with the **same id**, the PEM, the issuer link and the key links. `certificates.certificate_pem` is filled when it was empty |
| SSH CA key, `ssh_cas.kms_key_id` and `kms_public_key_id` | Transit key in mount `pki-manager-ssh`, named `ssh-ca-<id>`. Both columns get `openbao-transit:pki-manager-ssh:<name>:1` |
| SCEP RA key, `integration_ras.key_id` | Transit key in mount `pki-manager-ra`, named `scep-ra-<uuid>`. `key_provider='openbao'`, `key_id=<name>`, `key_version=1`, `public_key_id=NULL` |
| RA certificate row whose `kms_key_id` holds the RA key id (v3.19 writes it) | The same RA identity after a fingerprint check. `kms_key_id` becomes NULL, as v4 writes RA certificate rows |
| `ssh_certificates.kms_signing_key_id` | Kept as history |
| Legacy ECIES host key, `ssh_hosts.kms_pubkey_id` | Listed as legacy. v4 does not use it. Destroy it in Cosmian at decommission |

The v3 ids in the `kms_*` columns of the X.509 tables keep their values: v4 looks them up in
`keystore_objects`. A shared key (a renewal that reused its key) becomes one Transit key with
one pair of key rows. A CA row that holds its certificate id as key id is resolved through the
certificate's private key link.

Use other mount names with `--target-profile FILE`, a JSON file
`{"mounts": {"x509": "...", "ssh": "...", "ra": "..."}}` with the backend `OPENBAO_*_MOUNT` values.

## Transfer policy

The source policy is never bypassed:

- **`Extractable=false`** (or `NeverExtractable=true`), a missing key, or a state other than
  `Active` or `PreActive`: the key cannot move. The only actions are `rotate`, and `drop-key`
  where it is safe (see below). The tool never tries another export method.
- **`Sensitive=true`** (SSH CA and RA keys from v3): the key moves only wrapped, and only when
  the approval sets `acknowledgeSensitive: true` for that key.
- `Sensitive=false` keys also move wrapped. The tool checks the source attributes again just
  before each transfer and stops when they changed.

Target keys get `allow_plaintext_backup=false` and `allow_rotation=false`:

| Class | `exportable` in OpenBao |
|---|---|
| SSH CA | always false |
| SCEP RA (`rsa-3072`, opted in to `allow_pkcs1v15_session_key`) | always false |
| X.509 leaf | true when the source key was exportable, so PKCS#12, JKS and PEM key downloads keep working |
| X.509 CA | approval `caKeyExport: "preserve"`: true when the source key was exportable. CA keystore download still needs `ALLOW_CA_KEY_EXPORT=true` and an admin. `"deny"`: false for every CA key. This cannot be undone |

An approval can make a key non-exportable (`"exportable": false`). It can never make a key
exportable when the source key was not.

Blockers that a transfer cannot resolve (the key must be rotated first):

| Code | Meaning |
|---|---|
| `SHARED_SSH_CA_KEY` | One SSH CA key backs two CA rows (v3 import into two zones). v4 binds one key to one CA |
| `SHARED_ACROSS_CLASSES` | One key is referenced as two classes (for example a CA key and a leaf key) |
| `RA_ALIAS_MISMATCH` | A certificate row names the RA key but certifies another public key |
| `PUBLIC_KEY_MISMATCH`, `SSH_FINGERPRINT_MISMATCH`, `SERIAL_MISMATCH` | The views of one key or certificate disagree |
| `DUPLICATE_KEY_MATERIAL` | Two KMS objects hold the same key |

## Procedure

Use a working directory with mode `0700`, outside the application data. `pki-migrate` below
means `node scripts/migration/pki-migrate.ts`, run from the repository root.

### 1. Freeze and back up

1. Stop every writer: gateways, the Kubernetes issuer, jobs, then the v3 backend and frontend.
   Keep Cosmian running.
2. Back up the v3 database and make the target copy:

   ```sh
   pki-migrate backup --db /path/to/v3/pki.db --out-dir "$W/backup-v3" --label "v3 before migration"
   pki-migrate check-backup --dir "$W/backup-v3"
   pki-migrate backup --db "$W/backup-v3/pki.db" --out-dir "$W/target" --label "target copy"
   chmod 400 "$W/backup-v3/pki.db"
   ```

   `backup` uses the SQLite online backup API, checks integrity and foreign keys, and records
   SHA-256 digests. It refuses an existing directory. Keep the matching Cosmian backup.
3. Bring the target copy (`$W/target/pki.db`) to the v4 schema with the v4 migrations, and
   do not start the server. From source: `cd backend && DATABASE_PATH=$W/target/pki.db pnpm db:migrate`.
   With the v4 image, the entrypoint runs `node /app/backend/dist/db/migrate.js` before its
   command, so a command of `true` only migrates the database at `DATABASE_PATH`.

### 2. OpenBao and the migration identity

Configure OpenBao and the three mounts with the [OpenBao key store guide](openbao.md). Issue
the migration token as described in
[Issue and revoke a migration token](openbao.md#issue-and-revoke-a-migration-token). Its policy
is [scripts/migration/policies/pki-manager-migration.hcl](../../scripts/migration/policies/pki-manager-migration.hcl).
The runtime backend token cannot import keys. The preflight refuses a root token.

The examples use these options (environment variables `OPENBAO_ADDR`, `OPENBAO_CACERT`,
`OPENBAO_TOKEN_FILE` and `KMS_URL` work too):

```sh
BAO="--openbao-addr https://openbao.example:8200 --openbao-cacert $W/openbao-ca.pem --openbao-token-file $W/openbao-token"
KMS="--kms-url http://kms:9998"   # add --kms-api-key-file FILE when Cosmian has an API key
```

### 3. Inventory (dry run)

```sh
pki-migrate inventory --source-db "$W/backup-v3/pki.db" $KMS --out "$W/manifest.json"
```

It reads the database and runs only read operations on Cosmian (Query, GetAttributes, Get of
public keys and certificates). The manifest has no private key material. It lists every key
with its references, attributes, public key fingerprint, allowed actions and proposed action,
every certificate with the source of its PEM, the legacy references and the problems. Exit
code 1 means at least one blocker. Without `--kms-url` it works on the database alone; the
result cannot be applied, but it shows the scope early.

### 4. Approval

```sh
pki-migrate approve-template --manifest "$W/manifest.json" $BAO --out "$W/approval.json"
pki-migrate rotation-plan --manifest "$W/manifest.json" --approval "$W/approval.json"
```

The template binds the manifest digest and the fingerprint of each OpenBao wrapping key. An
administrator then edits it:

- `approvedBy` and `approvedAt` (ISO date): required.
- One entry per key: `transfer`, `rotate`, `drop-key`, `already-target` or `history-only`,
  from the key's `allowed` list in the manifest.
- `acknowledgeSensitive: true` on each Sensitive key to transfer.
- `caKeyExport`: `preserve` or `deny`.
- `allowSourceWrappingKeyRegistration: true`. This is the only write on the source KMS: it
  registers the OpenBao wrapping public key in Cosmian. The tool removes it at the end of the
  run, also after a failed run.
- `acceptMissingPem`: rows whose certificate is in neither the database nor the KMS.

`drop-key` keeps the certificate rows and records the key as destroyed. It is allowed for
leaf keys, for revoked or expired CAs and for retired SSH CAs. After a drop, key downloads
and renewals that reuse that key are no longer possible.

Offline material: instead of the online wrapped export, an approval can list, per key, a file
of wrapped key material made for the same wrapping key (`"material": {"<key id>": {"file":
"...", "sha256": "..."}}`) and `apply --material-dir DIR`. The tool checks the digest before the
import. The rehearsal below uses the online export only.

### 5. Preflight and apply

```sh
pki-migrate preflight --manifest "$W/manifest.json" --approval "$W/approval.json" \
  --source-db "$W/backup-v3/pki.db" --target-db "$W/target/pki.db" $BAO $KMS
pki-migrate apply --manifest "$W/manifest.json" --approval "$W/approval.json" \
  --source-db "$W/backup-v3/pki.db" --target-db "$W/target/pki.db" --run-dir "$W/run" \
  --confirm <first 16 characters of the manifest digest> --actor "<your name>" $BAO $KMS
```

The preflight changes nothing. It fails when the source copy changed after the inventory,
when the target copy is the source file or has no v4 schema, when OpenBao is sealed, when a
mount is missing or is not Transit, when the token is a root token, when the mounts differ
from the inventory, or when the approval does not match the manifest and the live wrapping
keys. `apply` runs the same checks first.

`apply` then, for each approved key in a fixed order:

1. reads the target name in OpenBao. A key that is there and matches (type, imported,
   version 1, flags, public key) is adopted. A key that is there and does not match stops
   the run, and nothing is overwritten;
2. otherwise exports the key wrapped from Cosmian and imports it;
3. reads it back and checks it, then signs fresh random data in OpenBao and verifies the
   signature with the source public key.

Only then does it write the target database, in one transaction: `keystore_objects` rows, the
SSH and RA references, the RA alias rows, the PEM backfill and one `audit_log` row per change
(`migration.*`, with the approver). A failure rolls the whole transaction back. The run
directory holds the checkpoint journal, `mappings.json` (old id → new reference for every
key) and one report per run.

**Restart.** Run the same `apply` command again after any failure. OpenBao and the target
database are the source of truth: each key is read again, a key imported just before a crash
is adopted, and rows that already hold the result are left as they are. A run that has
nothing to do reports `"noOp": true`. A second run directory for the same manifest is
refused, and so is a concurrent run on the same directory.

### 6. Verify and cut over

```sh
pki-migrate verify --manifest "$W/manifest.json" --approval "$W/approval.json" \
  --target-db "$W/target/pki.db" --source-db "$W/backup-v3/pki.db" $BAO --cutover --out "$W/verify.json"
```

`verify` never contacts Cosmian. It checks every key in OpenBao (flags, public key, a new
signature), every `keystore_objects` row and link, the SSH references and fingerprints, the
RA bindings, every certificate PEM (digest, serial, public key), and it reconciles the copy
with the frozen source: CAs, certificates, revocations, renewal links, CRLs, SSH CAs and
their serial counters, SSH certificates, integrations and RA bindings. `--cutover` also
fails while a key waits for rotation or any id still needs Cosmian. The migration token can
run `verify` on all three mounts. To check with the v4 runtime identities instead, pass the
X.509 and SSH token (policy `pki-manager-backend`) as `--openbao-token-file` and the SCEP RA
token (policy `pki-manager-ra`) as `--openbao-ra-token-file`: every RA mount call then uses the
RA token. `--ra-session-check` also tests the RA session-key operation; it needs the RA token,
because the migration policy has no session-key right.

Then revoke the migration token, take a backup pair, and start v4 on the target copy:

```sh
pki-migrate backup --db "$W/target/pki.db" --out-dir "$W/backup-v4" --label "migrated pair" \
  --openbao-addr https://openbao.example:8200 --openbao-cacert "$W/openbao-ca.pem" --openbao-token-file "$W/operator-token"
```

The token for the Raft snapshot needs `read` on `sys/storage/raft/snapshot` (an operator
token, not the migration token). The snapshot is encrypted with the OpenBao keyring: restore
needs the unseal keys of the cluster that took it. Keep the database and the snapshot of one
backup together: one without the other loses keys or rows.

### 7. Return path

Before v4 accepts writes, the original pair is intact: the v3 database backup and Cosmian.
Start v3 on them again. After v4 accepted writes, a return to v3 loses those writes (new
keys, serials, revocations); plan a forward recovery from the v4 backup pair instead. Keep
Cosmian until the recovery window closes, then destroy its objects, including the legacy
ECIES host keys.

## Controlled rotation

A key that cannot move is never replaced in silence. `rotation-plan` prints the steps for each
key whose action is `rotate` or `drop-key`. Do the rotation on v3 before the final inventory
(or on v4 after cutover for the X.509 and SSH cases), then run a new inventory: the new
manifest no longer has the old key, or has it as `drop-key` once it is retired.

| Class | Rotation |
|---|---|
| X.509 CA | New CA, publish its certificate next to the old one, re-issue the active leaves, revoke the old CA when nothing depends on it |
| X.509 leaf | Renew with `generateNewKey: true` |
| SSH CA | `POST /api/v1/ssh/cas/:caId/rotate`, distribute both trust anchors, re-issue, then `POST /api/v1/ssh/cas/:caId/retire` |
| SCEP RA | New RA key in OpenBao for the integration; clients fetch the new RA certificate with GetCACert; the previous RA certificate stays in the overlap list |

## Rehearsal

[scripts/migration/rehearsal/rehearse.sh](../../scripts/migration/rehearsal/rehearse.sh) runs
the whole procedure on disposable containers with synthetic data. It never reads an existing
installation. Each run uses its own container names and free local ports.

```sh
pnpm install
scripts/migration/rehearsal/rehearse.sh "$(mktemp -d)"
```

It needs Docker, jq, curl, OpenSSL, ssh-keygen and python3. The images are the released
v3.19.1 backend, Cosmian 5.28.0 and the OpenBao fork from `scripts/openbao-image.sh ensure`
(the signed release pinned by digest in `openbao/image.env`). The steps:

1. Seed v3.19.1 through its API: an RSA-2048 and an RSA-4096 CA, RSA and ECDSA leaves, a
   renewal that reuses its key, a renewal with a new key, a revocation and a CRL, a
   certificate from an external CSR, an SSH user CA with a rotation, an SSH host CA with a host
   certificate, and a SCEP integration with its RA key.
2. Stop v3, back up, make the copy, apply the v4 migrations to it.
3. Start the fork (Raft, TLS, file audit), run `bootstrap.sh configure`, `migration-setup`
   and `migration-token`.
4. Inventory, approval, preflight, `apply` with a simulated crash after the second import,
   `apply` again (resume), `apply` a third time (no-op), `verify --cutover`, revoke the
   migration token.
5. Backup pair, stop Cosmian, restore the Raft snapshot into a new OpenBao, unseal it with
   the original key, verify the restored pair.
6. Start the v4 backend on the restored pair with Cosmian stopped and use the migrated keys.

Result of the run on 2026-11-27 (the tool as committed with this guide, the worktree backend
with separate X.509/SSH and RA runtime tokens, fork `fcf3d59`, image digest
`sha256:4ea3dfec…6b2`):

| Check | Result |
|---|---|
| Inventory | 10 keys (2 X.509 CA, 4 X.509 leaf, 3 SSH CA, 1 RA), 10 certificates, 0 blockers, 1 RA alias |
| `apply` with a crash after import 2 | exit 75, no database change |
| `apply` resume | 8 imported, 1 adopted, 1 already verified; 21 `keystore_objects` rows, 5 rows changed, 5 PEMs filled, 31 audit rows |
| Third `apply` | no-op: nothing imported, 0 rows, 0 audit rows |
| `verify --cutover` (migrated, then restored pair, Cosmian stopped) | 78 checks, 0 failed, cutover ready, RA session key recovered |
| Runtime tokens on the import path, across X.509/SSH and RA mounts / migration token after revoke | HTTP 403 / HTTP 403 |
| v4 backend, Cosmian stopped | CA certificate identical to v3; new CRL verifies with the v3 CA certificate (`openssl crl -verify`); new leaf from the migrated RSA-4096 CA; renewal with key reuse; leaf PKCS#12 and CA keystore keys match the v3 certificates; SSH host certificate signed by the v3 host CA fingerprint (`ssh-keygen -L`); RA certificate unchanged, RA signature verifies with the v3 RA certificate, RA recovers a PKCS#1 v1.5 session key; external CSR signing |

The unit tests (`cd scripts/migration && npm test`) cover what the rehearsal data does not
have: a CA row that holds its certificate id, a non-extractable SSH CA key (rotate only), an
SSH key shared by two zones, an RA alias that certifies another key, approval refusals, a
planted conflicting OpenBao key, a conflicting target row, a failure inside the database
transaction, a source key that becomes non-extractable before transfer, a root token, a
changed source copy, `caKeyExport: "deny"`, `drop-key` and backup tampering.

## Limits

- Not run on a real installation: every run used synthetic keys.
- The source must be Cosmian with KMIP 2.1 JSON. The rehearsal used 5.28.0.
- v3 creates only RSA X.509 CAs; ECDSA CAs are covered by the unit tests only.
- The tool does not migrate certificates whose PEM is in neither the database nor Cosmian;
  the approval must accept each such row.
