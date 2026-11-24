ALTER TABLE `ssh_hosts` ADD `principals_changed_at` integer;--> statement-breakpoint
-- TASK-246: last_principal_push_at becomes a millisecond timestamp (Drizzle
-- mode timestamp_ms), so a push and a mapping change in the same second still
-- order correctly. Convert the existing seconds values.
UPDATE `ssh_hosts` SET `last_principal_push_at` = `last_principal_push_at` * 1000 WHERE `last_principal_push_at` IS NOT NULL;--> statement-breakpoint
-- Backfill principals_changed_at WITHOUT flagging every host Stale. The old
-- signal (updated_at > last push) cannot tell a mapping change from a host
-- cert renewal, so:
--   * host with mappings and NEVER pushed -> changed at updated_at (Stale: its
--     files were never confirmed on the host);
--   * every other host (pushed at least once, or no mappings) -> NULL (clean).
UPDATE `ssh_hosts` SET `principals_changed_at` = `updated_at` * 1000
  WHERE `last_principal_push_at` IS NULL
    AND EXISTS (SELECT 1 FROM `ssh_host_principal_maps` m WHERE m.`host_id` = `ssh_hosts`.`id`);
