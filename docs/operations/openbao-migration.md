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
| Verify the result against the frozen v3 copy, and a later restore from the database side, with Cosmian stopped | Remove the Cosmian objects (you do that after the recovery window) |

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
one pair of key rows. A CA row that holds its certificate id as key id (older v3) is resolved
through the certificate's private key link. The migration then points `kms_key_id` at the
private key, but only when the certificate of the row certifies exactly that key (same SPKI);
otherwise it stops (`KEY_LINK_UNPROVEN`). CRL signing and the CA keystore download then use
that key row.

Use other mount names with `--target-profile FILE`, a JSON file
`{"mounts": {"x509": "...", "ssh": "...", "ra": "..."}}` with the backend `OPENBAO_*_MOUNT` values.

## Transfer policy

The source policy is never bypassed:

- **`Extractable=false`** (or `NeverExtractable=true`), a missing key, or a state other than
  `Active` or `PreActive`: the key cannot move. The actions are `rotate`, `reprovision` for an
  RA key, and `drop-key` where it is safe (see below). The tool never tries another export
  method.
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

   Always work on this backup copy. A v3 backend in WAL mode can keep its last commits in
   `pki.db-wal` after it stops: the main file alone then misses rows, and a plain `cp` of
   `pki.db` loses them. The backup API reads them through SQLite. `inventory`, `preflight`,
   `apply` and `verify` refuse a source database whose `-wal` file holds data or that has a
   `-journal` file (error `SOURCE_NOT_FROZEN`).
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

The policy closes the import parameters: SSH and RA keys can only be imported non-exportable,
with fixed types (`ecdsa-p256`, `rsa-3072`), no key gets plaintext backup or rotation, and the
RA key must opt in to the session-key operation. It has no export, backup, delete, Raft
snapshot or RA session-key right. It does have `sign` on the three mounts, for the post-import
challenge, and Transit cannot limit that to the imported names: while the token lives it can
sign with any key there, including existing runtime keys. Issue it for one migration window
only and revoke it as soon as `verify` passes.

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
every certificate with the source of its PEM, the legacy references and the problems. It
binds the source copy with two digests: `dbSha256` (the file) and `contentSha256` (the
schema and every row of every table, read through SQLite). `preflight`, `apply` and `verify`
compute both again and stop when either differs. Exit
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
- One entry per key: `transfer`, `rotate`, `reprovision`, `drop-key`, `already-target` or
  `history-only`, from the key's `allowed` list in the manifest.
- `acknowledgeSensitive: true` on each Sensitive key to transfer.
- `acknowledgeNewKey: true` on each RA key to `reprovision`.
- `caKeyExport`: `preserve` or `deny`.
- `allowSourceWrappingKeyRegistration: true`. This is the only write on the source KMS: it
  registers the OpenBao wrapping public key in Cosmian. The tool removes it at the end of the
  run, also after a failed run.
- `acceptMissingPem`: rows whose certificate is in neither the database nor the KMS.

`drop-key` keeps the rows and records that the key is gone. It is offered only for a key that
nothing signs with any more, so no key in use loses a function:

| Class | `drop-key` allowed when | Target |
|---|---|---|
| X.509 leaf | every certificate of the key is revoked or expired | key rows in state `destroyed`; key downloads and key-reuse renewals end |
| X.509 CA | the CA is revoked or expired | key rows in state `destroyed`; no new CRL for that CA |
| SSH CA | the CA is **revoked** (`POST /api/v1/ssh/cas/:caId/revoke`). A CA that is only retired keeps signing its own KRL, and the KRL client refuses an unsigned KRL | the row keeps its v3 ids; one `migration.key.drop` audit row |
| SCEP RA | the integration is revoked | `key_id` and `public_key_id` become NULL; the RA certificates stay |

`reprovision` (SCEP RA only) resets the binding so that v4 generates a new RA key in OpenBao:
no key, no current certificate, `key_provider='openbao'`, and the current RA certificate moves
to the front of the overlap list (`previous`). The RA certificate rows stay. It is proposed for
an RA key that cannot move; an administrator may also choose it for a key that can.

One SSH CA key behind several CA rows is a blocker while two or more of those rows can issue
(active or rotating). When at most one can, all rows map to the one Transit key.

**Offline material.** Instead of the online wrapped export, the approval can list one file of
wrapped key material for each key to transfer: `"material": {"<key id>": {"file": "...",
"sha256": "..."}}`, with `allowSourceWrappingKeyRegistration: false`. Pass `--material-dir DIR`
to `preflight` and `apply`. The rules:

- Each file is the Transit import `ciphertext`, decoded: the key wrapped by Cosmian to the
  **wrapping key of its target mount** (each mount has its own; the template records their
  fingerprints). The tool does not make these files: the operator registers the wrapping key in
  Cosmian, runs the wrapped `Get` (`Encrypt`, RSA, SHA-256, `NoEncoding`), then removes it.
- Every key approved as `transfer` needs an entry, and only those keys can have one. A file
  must be inside `DIR`, also after symbolic links.
- `preflight` reads every file and checks its digest, so a missing, changed or misplaced file
  stops the run before the first import.
- A file with the right digest but the key of **another** row is imported, then refused: its
  public key differs from the source key (`IMPORT_MISMATCH`). The wrong key stays under that
  Transit name, and the next run stops on it (`TARGET_CONFLICT`); nothing is overwritten.
  Confirm the target mount, key name and public key from the failed import before removing it.
  Use an administrator credential with config and delete rights on that key. The migration
  token and the supplied operator policy lack those rights. Run
  `bao write <mount>/keys/<name>/config deletion_allowed=true`, then
  `bao delete <mount>/keys/<name>`. Correct the material and its approval, then run apply again.

v3 keeps CA certificates (and a leaf PEM when its row has none) only in Cosmian, and `apply`
writes every certificate into the target. Without Cosmian, give them in a bundle:
`inventory --certificates-out FILE` writes the PEM bundle of those certificates while
Cosmian is reachable, and `preflight` and `apply --certificates FILE` read it. Each certificate
must have the DER SHA-256 of the manifest, which the approval binds: a missing, changed or
unknown certificate, or a PEM block that is not a certificate, stops `preflight`. With neither
the bundle nor `--kms-url`, `preflight` fails. With the material and the bundle, `apply` makes
no call to Cosmian.

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
from the inventory, when the approval does not match the manifest and the live wrapping
keys, when an offline material file is missing or has another digest, or when a certificate
PEM that is only in Cosmian is neither in `--certificates` nor readable with `--kms-url`.
`apply` runs the same checks first.

`apply` then, for each approved key in a fixed order:

1. reads the target name in OpenBao. A key that is there and matches (type, imported,
   version 1, flags, public key) is adopted. A key that is there and does not match stops
   the run, and nothing is overwritten;
2. otherwise exports the key wrapped from Cosmian (or reads its approved material file) and
   imports it;
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
nothing to do reports `"noOp": true`. Reuse the original run directory to keep the full
checkpoint history. The tool refuses a directory bound to a different manifest and a
directory locked by another running process.

### 6. Verify and cut over

```sh
pki-migrate verify --manifest "$W/manifest.json" --approval "$W/approval.json" \
  --target-db "$W/target/pki.db" --source-db "$W/backup-v3/pki.db" $BAO --cutover --out "$W/verify.json"
```

`verify` never contacts Cosmian. It checks every key in OpenBao (the key policy, public key, a
new signature), every `keystore_objects` row and link, the SSH references and fingerprints, the
RA bindings, every certificate PEM (digest, serial, public key). From the database side, it
checks that every key the target database owns (`keystore_objects` key rows that are
active or revoked, `ssh_cas` references, RA bindings in OpenBao) is in OpenBao at the
version the row names, with the same public key.

With `--source-db` it checks that the source is the frozen copy the manifest binds (no WAL
data, file and content digests), then reconciles every table of that copy with the target,
row by row and column by column: the audit history, CAs, certificates and their revocations,
renewal links and owners (integration, Kubernetes resource), CRLs, SSH CAs and their serial
counters, SSH certificates, revocations, KRLs and the KRL sequence, host blocks, principals
and grants, identities, hosts, zones, fleet tokens, integrations and RA bindings. The only
accepted differences are the writes of the migration, each with its exact value: the PEM
backfill of `certificates.certificate_pem`, the RA alias and key-link repair of `kms_key_id`,
the SSH references, the RA binding columns, the new `audit_log` rows of operation
`migration.*` of this approval, and columns and tables that only the v4 schema has. The
replay cache `ssh_idempotency` is not compared. A failed table lists the missing, changed and
extra rows, for example `reconcile certificates - 1 changed [s"cert-1": status s"revoked" -> s"active"]`.

`--cutover` is the gate: it needs `--source-db` (without it, the command stops with a usage
error), and it fails while a table does not reconcile, a key waits for rotation, or any id
still needs Cosmian. Without `--cutover` and without `--source-db`, `verify` checks the keys
and rows but reports `reconciled=false` and `cutoverReady=false`. The migration token can
run `verify` on all three mounts. To check with the v4 runtime identities instead, pass the
X.509 and SSH token (policy `pki-manager-backend`) as `--openbao-token-file` and the SCEP RA
token (policy `pki-manager-ra`) as `--openbao-ra-token-file`: every RA mount call then uses the
RA token. `--ra-session-check` also tests the RA session-key operation; it needs the RA token,
because the migration policy has no session-key right. The gate needs it: while an RA key
(transferred or already in OpenBao) has no passed session-key test, `cutoverReady=false` with
the check `cutover: RA session-key transport tested for <key>`. `counts.raUnwrapped` gives the
number of RA keys that passed it.

The key policy is the one the v4 clients require for their purpose, and `apply` checks it too,
before it imports, adopts or writes anything (`TARGET_CONFLICT`, nothing changed):

| Purpose | Every key | Also |
|---|---|---|
| X.509 (CA and leaf) | type `rsa-2048`/`rsa-3072`/`rsa-4096`/`ecdsa-p256`/`ecdsa-p384`; `derived`, `deletion_allowed`, `soft_deleted`, `allow_plaintext_backup` false; `supports_signing` true; `auto_rotate_period` 0; an imported key has `imported_key_allow_rotation` false; the version is between `min_available_version` and `latest_version` and not below `min_encryption_version` (Transit refuses to sign with it); its public key matches the type | `exportable` as approved |
| SSH CA | as X.509 | `ecdsa-p256`, not exportable |
| SCEP RA | as X.509 | `rsa-3072`, not exportable, `allow_pkcs1v15_session_key` true, the version not below `min_decryption_version` (session key) |

A migrated key is also an imported key with only version 1 and the source public key. The
fork always returns these fields: a missing field fails the check.

An RA key that is already in OpenBao (`already-target`, a v3.19 binding with
`key_provider = openbao`) is never imported. Its binding must name the key and a key version,
with no Cosmian public key id, and hold the inventoried RA certificate. The key must pass the
RA policy above for that version (a generated key or an imported one), hold the public key of
the RA certificate, and sign with that version; with `--ra-session-check` it must also recover
a session key wrapped to the certificate key.

Then revoke the migration token, take a backup pair, and start v4 on the target copy:

```sh
pki-migrate backup --db "$W/target/pki.db" --out-dir "$W/backup-v4" --label "migrated pair" \
  --openbao-addr https://openbao.example:8200 --openbao-cacert "$W/openbao-ca.pem" --openbao-token-file "$W/operator-token"
```

The token for the Raft snapshot needs `read` on `sys/storage/raft/snapshot` (an operator
token, not the migration token). When the snapshot is refused, `backup` removes the directory
it created: a database without its snapshot is not a backup pair. The snapshot is encrypted with the OpenBao keyring: restore
needs the unseal keys of the cluster that took it. Keep the database and the snapshot of one
backup together: one without the other loses keys or rows.

To check a restore made right after this backup (before v4 accepted writes), run the same
`verify --cutover` on the restored database and the restored OpenBao.

### 7. Return path

Before v4 accepts writes, the original pair is intact: the v3 database backup and Cosmian.
Start v3 on them again. After v4 accepted writes, a return to v3 loses those writes (new
keys, serials, revocations); plan a forward recovery from the v4 backup pair instead. Keep
Cosmian until the recovery window closes, then destroy its objects, including the legacy
ECIES host keys.

### 8. Verify a later restore

After v4 accepted writes, a restored database differs from the v3 copy (new certificates,
revocations, CRLs, deleted keys), so the cutover comparison does not apply. Restore the
database and the Raft snapshot of **one** `backup` directory, then, before v4 starts:

```sh
pki-migrate verify --restore --target-db /restored/pki.db $BAO --openbao-ra-token-file "$W/ra-token" \
  --source-db "$W/backup-v3/pki.db" --out "$W/verify-restore.json"
```

`--restore` needs no manifest. It starts from the database: every key the database owns
must be in OpenBao at its version with the same public key, certificate rows must certify
their keys, and no id may need Cosmian. With `--source-db`, every `audit_log` row of the v3
copy must still be there, unchanged. It fails when a snapshot older than the database is
restored: the keys made after the snapshot (an X.509 issue, a new SSH CA, an RA key) are
missing. Keys that v4 deleted (rows in state `destroyed`) need nothing; a deleted key that
the snapshot still holds is a `WARN` line, as is a key row left `pending` by an interrupted
creation. Pass `--manifest` and `--approval` when the migration dropped keys or accepted
missing PEMs: the gate then knows those decisions. A key in OpenBao that no row uses (a
snapshot newer than the database) is not found: Transit keys are not listed.

## Controlled rotation

A key that cannot move is never replaced in silence. `rotation-plan` prints the steps for each
key whose action is `rotate`, `reprovision` or `drop-key`. Do a rotation on v3 before the final
inventory, then run a new inventory: the new key is `transfer`, the old one `drop-key` once
nothing signs with it.

| Class | Procedure |
|---|---|
| X.509 CA | New CA, publish its certificate next to the old one, re-issue the active leaves, revoke the old CA when nothing depends on it, new inventory (old key: `drop-key`) |
| X.509 leaf | Renew with `generateNewKey: true` before the final inventory |
| SSH CA | `POST /api/v1/ssh/cas/:caId/rotate`, distribute both trust anchors, re-issue; when no certificate of the old CA must stay valid, `POST /api/v1/ssh/cas/:caId/revoke`; new inventory (old key: `drop-key`) |
| SCEP RA, on v4 | `reprovision` in the approval. After cutover run the gateway once with `scep-server provision` (or with auto-provisioning): v4 creates the new key and RA certificate. GetCACert serves the new certificate and keeps the old one in `previousCertificatesPem` until it expires. Revoke the old RA certificate when the clients have moved |
| SCEP RA, on v3.19.1 | Register a new SCEP integration on the same CA, provision its RA with the new token, switch the gateway to it, revoke the old integration; new inventory (new key: `transfer`, old key: `drop-key`) |

## Rehearsal

[scripts/migration/rehearsal/rehearse.sh](../../scripts/migration/rehearsal/rehearse.sh) runs
the whole procedure on disposable containers with synthetic data. It never reads an existing
installation. Each run uses its own container names and free local ports.

```sh
pnpm install
scripts/migration/rehearsal/rehearse.sh "$(mktemp -d)"
```

It needs Docker, jq, curl, OpenSSL, ssh, ssh-keygen and python3. The images are the released
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
6. Start the v4 backend on the restored pair with Cosmian stopped, with separate X.509/SSH
   and RA tokens. Use the migrated keys, connect to a test SSH server that presents a new
   host certificate, then provision the RA of a new SCEP integration. The SSH client
   checks the host certificate against the original v3 host CA.

The synthetic rehearsal ran on 2026-11-27 from commit `27b62288` with separate X.509/SSH
and RA credentials. It used fork `fcf3d59` at image digest `sha256:4ea3dfec…6b2`.

| Check | Result |
|---|---|
| Inventory | 10 keys (2 X.509 CA, 4 X.509 leaf, 3 SSH CA, 1 RA), 10 certificates, 0 blockers, 1 RA alias |
| `apply` with a crash after import 2 | exit 75, no database change |
| `apply` resume | 8 imported, 1 adopted, 1 already verified; 21 `keystore_objects` rows, 5 rows changed, 5 PEMs filled, 31 audit rows |
| Third `apply` | no-op: nothing imported, 0 rows, 0 audit rows |
| `verify --cutover` (migrated, then restored pair, Cosmian stopped) | 78 checks, 0 failed, cutover ready, RA session key recovered |
| Runtime tokens on the import path, across X.509/SSH and RA mounts / migration token after revoke | HTTP 403 / HTTP 403 |
| X.509 with Cosmian stopped | The CA certificate matched v3. The original CA verified the new CRL. The backend issued a leaf, renewed a certificate with its existing key and signed an external CSR. The exported leaf and CA private keys matched their certificates. |
| SSH with Cosmian stopped | An OpenSSH client that trusted the original v3 host CA completed a connection to a server presenting the new host certificate. |
| Migrated SCEP RA with Cosmian stopped | The RA certificate matched v3. It verified a new signature. The RA recovered a PKCS#1 v1.5 session key. |
| First RA provisioning on v4, Cosmian stopped | new SCEP integration: RA key generated in OpenBao (`imported_key=false`, non-exportable, session-key opt-in), binding `key_provider=openbao`, signature verifies with the new RA certificate |

The unit tests (`cd scripts/migration && npm test`) cover what the rehearsal data does not
have: a CA row that holds its certificate id (repaired to its private key), a non-extractable
SSH CA key (rotate only, `drop-key` once revoked), an SSH key shared by two issuing zones and by
a retired row, a non-extractable RA key (`reprovision`, and `drop-key` for a revoked
integration), an already-migrated RA key that does not match its certificate, no `drop-key`
for keys in use, an RA alias that certifies another key, approval refusals, a
planted conflicting OpenBao key, a conflicting target row, a failure inside the database
transaction, a source key that becomes non-extractable before transfer, a root token, a
changed source copy, `caKeyExport: "deny"`, `drop-key`, backup tampering, offline material
refusals (wrong digest, missing entry, a path or link outside the directory), certificate
bundles with a missing, changed or foreign certificate or a key block, and an offline apply
with no Cosmian.

## Limits

- Not run on a real installation: every run used synthetic keys.
- The source must be Cosmian with KMIP 2.1 JSON. The rehearsal used 5.28.0.
- v3 creates only RSA X.509 CAs; ECDSA CAs are covered by the unit tests only.
- The tool does not migrate certificates whose PEM is in neither the database nor Cosmian;
  the approval must accept each such row.
