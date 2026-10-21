# SSH Zones — production migration runbook

Upgrading a live PKI Manager to the SSH Zones schema (migration
`0009_stiff_wallflower`, [decision-017](../../backlog/decisions/decision-017%20-%20SSH-Zones-%E2%80%94-Multi-CA-Grouping-and-Trust-Boundary.md)).
Every command below was **executed against a byte copy of the production
database** (`pki.joor.net`, host `y0`, `/opt/stacks/pki/data/pki/pki.db`) before
being written here; the sample outputs are from that rehearsal.

## What the migration does

Adds a generic `zones` table, seeds one row `id='default'`, and adds
`zone_id NOT NULL DEFAULT 'default'` (FK → `zones`, `ON DELETE RESTRICT`) to
`ssh_cas`, `ssh_hosts`, `ssh_identities`, `ssh_principals`, `ssh_fleet_tokens`,
rekeying their partial-unique / natural-key indexes to their zone-scoped form.
SQLite cannot do this in place, so the five tables are **rebuilt and copied**
(`create-new → copy → drop → rename`). **A migrated single-zone install is
behaviourally identical** — every existing row is backfilled to `default`.

### The one thing that can go wrong

The rebuild DROPs tables that nine child tables reference with FKs. If foreign
keys are enforced during the DROP, the implicit row delete **cascades and can
destroy `ssh_certificates`**. The runner (`backend/src/db/migrate.ts`) therefore
disables `foreign_keys` for the DDL and re-asserts `PRAGMA foreign_key_check`
afterwards — `PRAGMA foreign_keys=OFF` inside the migration SQL is a no-op because
drizzle wraps migrations in a transaction. **Do not run the raw `.sql` by hand
with foreign keys on.** Use `pnpm db:migrate` / the container's migrate step.

## 0. Prerequisites

- Deploy the new backend image/build but **do not run migrations yet**.
- Have shell on `y0` (`ssh root@10.2.0.3`) and the ability to stop/start the pki
  stack.

## 1. Back up (WAL-safe) and take a copy you can restore

`cp` is unsafe with WAL — use SQLite's `.backup`, which checkpoints:

```bash
# on y0
cd /opt/stacks/pki/data/pki
sqlite3 pki.db ".backup pki.db.pre-zones.$(date +%Y%m%d-%H%M%S)"
ls -l pki.db.pre-zones.*          # <-- this file is your rollback
sqlite3 pki.db.pre-zones.* "PRAGMA integrity_check;"   # -> ok
```

Keep that `.pre-zones.*` file off-host too. **This backup is the rollback.**

## 2. Record the pre-migration state

```bash
for t in ssh_cas ssh_hosts ssh_identities ssh_principals ssh_fleet_tokens ssh_certificates; do
  printf "%-22s %s\n" "$t" "$(sqlite3 pki.db "SELECT count(*) FROM $t")"
done
sqlite3 pki.db "PRAGMA foreign_keys=ON; PRAGMA foreign_key_check;"   # empty = clean
```

Rehearsal output (yours will differ in counts):

```
ssh_cas                2
ssh_hosts              4
ssh_identities         3
ssh_principals         2
ssh_fleet_tokens       0
ssh_certificates       84
(foreign_key_check printed nothing → clean)
```

## 3. Stop the app, migrate

```bash
cd /opt/stacks/pki
docker compose stop pki            # stop writes first
# run the app's migrate step (NOT the raw SQL):
docker compose run --rm pki node dist/db/migrate.js   # or `pnpm db:migrate`
# expect: "Migrations completed successfully!"
```

`migrate.js` disables FK enforcement for the rebuild and then asserts
`PRAGMA foreign_key_check` is empty; a non-empty check aborts with a non-zero
exit and the DB is left on the pre-migration state inside the aborted
transaction.

## 4. Verify the post-migration state

```bash
# row counts MUST equal step 2 (no cascade delete):
for t in ssh_cas ssh_hosts ssh_identities ssh_principals ssh_fleet_tokens ssh_certificates; do
  printf "%-22s %s\n" "$t" "$(sqlite3 pki.db "SELECT count(*) FROM $t")"
done
sqlite3 pki.db "PRAGMA foreign_keys=ON; PRAGMA foreign_key_check;"   # empty = clean
sqlite3 pki.db "PRAGMA integrity_check;"                             # ok
sqlite3 pki.db "SELECT id,name,status FROM zones;"                   # default|default|active
# every pre-existing row is in the default zone:
for t in ssh_cas ssh_hosts ssh_identities ssh_principals; do
  printf "%-22s not-default=%s\n" "$t" "$(sqlite3 pki.db "SELECT count(*) FROM $t WHERE zone_id!='default'")"
done
```

Rehearsal output — **row counts identical to step 2, FK-clean, all rows in
`default`**:

```
ssh_cas 2  ssh_hosts 4  ssh_identities 3  ssh_principals 2  ssh_fleet_tokens 0  ssh_certificates 84
(foreign_key_check empty)   integrity_check: ok
zones: default|default|active
ssh_cas not-default=0  ssh_hosts not-default=0  ssh_identities not-default=0  ssh_principals not-default=0
```

If any count dropped, the FK check is non-empty, or a row is not in `default`:
**stop and roll back** (§6).

## 5. Start the app and smoke-test

```bash
docker compose start pki
```

- The legacy unscoped trust endpoints still serve the **default** zone (with a
  `Deprecation` header) — the c1h1 test VM and any Ansible-enrolled host keep
  fetching trust material unchanged.
- Issue one test cert and pull one KRL to confirm the default zone works.

## 6. Rollback

Rollback is a **restore of the §1 backup**, not a down-migration:

```bash
docker compose stop pki
cd /opt/stacks/pki/data/pki
mv pki.db pki.db.failed
cp pki.db.pre-zones.<timestamp> pki.db
sqlite3 pki.db "PRAGMA integrity_check;"   # ok
docker compose start pki   # runs the OLD backend image
```

### When rollback STOPS being safe

Restoring the pre-zones backup is safe **only while the installation still has a
single zone and you can accept losing whatever was written since the backup**.
Two hard stops:

1. **The moment you create a second zone**, rollback is no longer safe. The old
   (pre-zones) schema enforces one active CA **per type globally**
   (`uq_ssh_cas_active_type` on `ca_type` alone); a second zone's active CA of
   the same type cannot coexist there, and the old code has no notion of which
   trust domain a host/identity belongs to — restoring it would collapse two
   trust boundaries into one and mis-sign. Past this point, roll **forward** (fix
   and re-migrate), never back.
2. Any certs issued / hosts registered / KRLs generated **after** the migration
   live only in the migrated DB; restoring the backup discards them. If that data
   matters, export it first or roll forward.

Because the migration is behaviourally identical for a single zone, the safe
window is: *migrate → verify → smoke-test → **before** creating a second zone*.
Do the risky part (creating zone #2) only once you are confident.

## Downstream consumers

See [zones.md § Downstream consumers](zones.md#downstream-consumers-not-updated-by-this-milestone):
the Galaxy `oriolrius.pki_manager` collection and `pki-manager-cli` keep driving
the **default** zone until they are updated; `krl-client` is already zone-aware.
