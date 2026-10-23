# Migration 0010: backup and rollback

The backend entrypoint migrates on startup. Migration 0010 replaces `clusters`
with `integrations`; an older backend cannot use that database. Back up before
deploying the new image. This procedure restores the complete pre-upgrade DB,
including Drizzle's migration journal; it does not attempt reverse DDL.

## Before upgrade

1. Record the exact currently deployed backend/frontend image tags or digests.
2. Stop all gateways, issuer controllers, jobs, and other writers, then stop the
   frontend/backend. Do not start the upgraded backend yet:

   ```sh
   docker compose stop frontend backend
   ```

3. Resolve the actual host path of the backend database. For a named volume,
   inspect the backend container's mounts in Docker/Arcane and find the volume
   mounted at `/app/backend/data`. `DATABASE_PATH` may override the filename.
   Run these commands on the Docker host with SQLite 3 installed, substituting
   the real paths (not the container paths):

   ```sh
   set -eu
   pki_db_path=/actual/host/backend-data/pki.db
   pki_backup_path=/secure/backups/pki.before-0010.db
   test -f "$pki_db_path"
   test ! -e "$pki_backup_path"
   sqlite3 "$pki_db_path" ".backup '$pki_backup_path'"
   sqlite3 "$pki_backup_path" 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
   sqlite3 "$pki_backup_path" "SELECT name FROM sqlite_master WHERE type='table' AND name='clusters';"
   ```

   Check each command succeeded: integrity must be `ok`, the FK check must have
   no rows, and `clusters` must exist. Keep the backup outside the application
   data volume, protect it like the original DB, and retain the matching KMS
   backup. `.backup` captures committed SQLite state including WAL contents;
   copying only a live `pki.db` file is insufficient.

4. Deploy the integration backend/frontend. The entrypoint applies 0010.
   Verify existing Kubernetes tokens, CA bindings, certificate counts, and
   revocation state before resuming writers. Deploy the optional SCEP gateway
   separately. Keep the pre-upgrade images and DB backup until acceptance ends.

## Rollback

Rollback loses DB changes after the backup, including issued certificates,
revocations, service tokens and audit rows. Keep all writers stopped throughout;
coordinate this restore with your issuance/revocation records and KMS backup.
Do not reset or delete the KMS database merely to roll back integration metadata.

1. Stop gateway/controllers/jobs, then `docker compose stop frontend backend`.
2. Archive the failed-upgrade database **and its WAL/SHM files**, then restore
   the pre-upgrade backup while no process has the DB open:

   ```sh
   # Reuse the actual paths selected above. Choose a new archive directory.
   pki_archive_dir=/secure/backups/failed-0010
   mkdir -m 700 "$pki_archive_dir"
   for pki_suffix in '' '-wal' '-shm'; do
     if [ -e "$pki_db_path$pki_suffix" ]; then
       mv "$pki_db_path$pki_suffix" "$pki_archive_dir/"
     fi
   done
   cp "$pki_backup_path" "$pki_db_path"
   chown --reference="$pki_archive_dir/$(basename "$pki_db_path")" "$pki_db_path"
   chmod --reference="$pki_archive_dir/$(basename "$pki_db_path")" "$pki_db_path"
   sqlite3 "$pki_db_path" 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
   ```

3. Restore the recorded pre-upgrade backend/frontend image tags/digests in the
   deployment configuration **before starting them**, then recreate those
   services. Starting the integration image would apply 0010 again.
4. Confirm the old Clusters API/UI works and original tokens are accepted before
   resuming writers. The old backend does not support new integration kinds.

If 0010 already ran without a pre-upgrade backup, this procedure cannot provide
a lossless downgrade. Retain the upgraded DB and resolve forward, or arrange a
separately validated data conversion; do not simply redeploy an old image.
