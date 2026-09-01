-- decision-017 (SSH Zones) — introduce a generic `zones` table and make it a
-- real trust boundary for SSH. Five tables gain `zone_id NOT NULL DEFAULT
-- 'default'` and swap their natural-key / partial-unique indexes to their
-- zone-scoped form.
--
-- SQLite cannot add a NOT NULL column or redefine a unique index in place, so
-- ssh_cas / ssh_hosts / ssh_identities / ssh_principals / ssh_fleet_tokens are
-- rebuilt-and-copied. The rebuild DROPs parents referenced by nine child tables;
-- those references cascade, so the migration runner (src/db/migrate.ts and
-- src/test/setup.ts) MUST run with `foreign_keys=OFF` and re-assert
-- `PRAGMA foreign_key_check` afterwards. The PRAGMA lines below are a no-op
-- inside drizzle's transaction and only document intent; the toggle is in the
-- runner.
--
-- The `DEFAULT 'default'` on zone_id backfills every pre-existing row and keeps
-- a migrated single-zone install behaviourally identical. Service create-paths
-- always resolve the zone fail-closed (resolveZone) and pass it explicitly, so
-- the column default is only a backstop for the seeded single-zone case.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `zones` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zones_name_unique` ON `zones` (`name`);--> statement-breakpoint
CREATE INDEX `idx_zones_status` ON `zones` (`status`);--> statement-breakpoint
-- Seed the single default zone (id = 'default' matches the column default).
INSERT INTO `zones` (`id`,`name`,`display_name`,`description`,`status`) VALUES ('default','default','Default','Seeded by the SSH Zones migration (decision-017).','active');--> statement-breakpoint

-- ---- ssh_cas rebuild (zone_id + (zone_id, ca_type) partial-unique indexes) ----
CREATE TABLE `__new_ssh_cas` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text DEFAULT 'default' NOT NULL,
	`ca_type` text NOT NULL,
	`label` text,
	`kms_key_id` text NOT NULL,
	`kms_public_key_id` text NOT NULL,
	`openssh_public_key` text NOT NULL,
	`fingerprint_sha256` text NOT NULL,
	`key_algorithm` text DEFAULT 'ECDSA-P256' NOT NULL,
	`next_serial` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`predecessor_ca_id` text,
	`retire_after` integer,
	`revocation_date` integer,
	`revocation_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`predecessor_ca_id`) REFERENCES `ssh_cas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ssh_cas` (`id`,`zone_id`,`ca_type`,`label`,`kms_key_id`,`kms_public_key_id`,`openssh_public_key`,`fingerprint_sha256`,`key_algorithm`,`next_serial`,`status`,`predecessor_ca_id`,`retire_after`,`revocation_date`,`revocation_reason`,`created_at`,`updated_at`) SELECT `id`,'default',`ca_type`,`label`,`kms_key_id`,`kms_public_key_id`,`openssh_public_key`,`fingerprint_sha256`,`key_algorithm`,`next_serial`,`status`,`predecessor_ca_id`,`retire_after`,`revocation_date`,`revocation_reason`,`created_at`,`updated_at` FROM `ssh_cas`;--> statement-breakpoint
DROP TABLE `ssh_cas`;--> statement-breakpoint
ALTER TABLE `__new_ssh_cas` RENAME TO `ssh_cas`;--> statement-breakpoint
CREATE INDEX `idx_ssh_cas_type` ON `ssh_cas` (`ca_type`);--> statement-breakpoint
CREATE INDEX `idx_ssh_cas_zone` ON `ssh_cas` (`zone_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_cas_status` ON `ssh_cas` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ssh_cas_fp` ON `ssh_cas` (`fingerprint_sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_cas_active_type` ON `ssh_cas` (`zone_id`,`ca_type`) WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_cas_rotating_type` ON `ssh_cas` (`zone_id`,`ca_type`) WHERE status = 'rotating';--> statement-breakpoint

-- ---- ssh_hosts rebuild (zone_id + (zone_id, fqdn) unique) ----
CREATE TABLE `__new_ssh_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text DEFAULT 'default' NOT NULL,
	`fqdn` text NOT NULL,
	`display_name` text,
	`addresses` text,
	`openssh_host_pubkey` text,
	`host_key_algorithm` text,
	`kms_pubkey_id` text,
	`current_cert_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`enrolled_at` integer,
	`last_seen_at` integer,
	`last_krl_version` text,
	`last_krl_fetch_at` integer,
	`last_principal_push_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_ssh_hosts` (`id`,`zone_id`,`fqdn`,`display_name`,`addresses`,`openssh_host_pubkey`,`host_key_algorithm`,`kms_pubkey_id`,`current_cert_id`,`status`,`enrolled_at`,`last_seen_at`,`last_krl_version`,`last_krl_fetch_at`,`last_principal_push_at`,`created_at`,`updated_at`) SELECT `id`,'default',`fqdn`,`display_name`,`addresses`,`openssh_host_pubkey`,`host_key_algorithm`,`kms_pubkey_id`,`current_cert_id`,`status`,`enrolled_at`,`last_seen_at`,`last_krl_version`,`last_krl_fetch_at`,`last_principal_push_at`,`created_at`,`updated_at` FROM `ssh_hosts`;--> statement-breakpoint
DROP TABLE `ssh_hosts`;--> statement-breakpoint
ALTER TABLE `__new_ssh_hosts` RENAME TO `ssh_hosts`;--> statement-breakpoint
CREATE INDEX `idx_ssh_hosts_status` ON `ssh_hosts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ssh_hosts_kms_pubkey` ON `ssh_hosts` (`kms_pubkey_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_hosts_zone` ON `ssh_hosts` (`zone_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_hosts_zone_fqdn` ON `ssh_hosts` (`zone_id`,`fqdn`);--> statement-breakpoint

-- ---- ssh_identities rebuild (zone_id + (zone_id, subject) unique) ----
CREATE TABLE `__new_ssh_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text DEFAULT 'default' NOT NULL,
	`subject` text NOT NULL,
	`external_subject` text,
	`email` text,
	`openssh_user_pubkey` text,
	`pubkey_source` text DEFAULT 'per_request' NOT NULL,
	`kms_pubkey_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_ssh_identities` (`id`,`zone_id`,`subject`,`external_subject`,`email`,`openssh_user_pubkey`,`pubkey_source`,`kms_pubkey_id`,`status`,`created_at`,`updated_at`) SELECT `id`,'default',`subject`,`external_subject`,`email`,`openssh_user_pubkey`,`pubkey_source`,`kms_pubkey_id`,`status`,`created_at`,`updated_at` FROM `ssh_identities`;--> statement-breakpoint
DROP TABLE `ssh_identities`;--> statement-breakpoint
ALTER TABLE `__new_ssh_identities` RENAME TO `ssh_identities`;--> statement-breakpoint
CREATE INDEX `idx_ssh_identities_status` ON `ssh_identities` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ssh_identities_ext_sub` ON `ssh_identities` (`external_subject`);--> statement-breakpoint
CREATE INDEX `idx_ssh_identities_zone` ON `ssh_identities` (`zone_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_identities_zone_subject` ON `ssh_identities` (`zone_id`,`subject`);--> statement-breakpoint

-- ---- ssh_principals rebuild (zone_id + (zone_id, name) unique) ----
CREATE TABLE `__new_ssh_principals` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text DEFAULT 'default' NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_ssh_principals` (`id`,`zone_id`,`name`,`description`,`created_at`) SELECT `id`,'default',`name`,`description`,`created_at` FROM `ssh_principals`;--> statement-breakpoint
DROP TABLE `ssh_principals`;--> statement-breakpoint
ALTER TABLE `__new_ssh_principals` RENAME TO `ssh_principals`;--> statement-breakpoint
CREATE INDEX `idx_ssh_principals_zone` ON `ssh_principals` (`zone_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_principals_zone_name` ON `ssh_principals` (`zone_id`,`name`);--> statement-breakpoint

-- ---- ssh_fleet_tokens rebuild (zone_id) ----
CREATE TABLE `__new_ssh_fleet_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text DEFAULT 'default' NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`user_ca_id` text,
	`host_ca_id` text,
	`op_set` text NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`last_seen_at` integer,
	`last_seen_ip` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_ca_id`) REFERENCES `ssh_cas`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`host_ca_id`) REFERENCES `ssh_cas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_ssh_fleet_tokens` (`id`,`zone_id`,`name`,`token_hash`,`token_prefix`,`user_ca_id`,`host_ca_id`,`op_set`,`revoked`,`last_seen_at`,`last_seen_ip`,`created_at`) SELECT `id`,'default',`name`,`token_hash`,`token_prefix`,`user_ca_id`,`host_ca_id`,`op_set`,`revoked`,`last_seen_at`,`last_seen_ip`,`created_at` FROM `ssh_fleet_tokens`;--> statement-breakpoint
DROP TABLE `ssh_fleet_tokens`;--> statement-breakpoint
ALTER TABLE `__new_ssh_fleet_tokens` RENAME TO `ssh_fleet_tokens`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_fleet_tokens_hash` ON `ssh_fleet_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_ssh_fleet_tokens_zone` ON `ssh_fleet_tokens` (`zone_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
