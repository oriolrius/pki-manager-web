CREATE TABLE `ssh_cas` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`predecessor_ca_id`) REFERENCES `ssh_cas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ssh_cas_type` ON `ssh_cas` (`ca_type`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_cas_status` ON `ssh_cas` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_cas_fp` ON `ssh_cas` (`fingerprint_sha256`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_cas_active_type` ON `ssh_cas` (`ca_type`) WHERE status = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_cas_rotating_type` ON `ssh_cas` (`ca_type`) WHERE status = 'rotating';
--> statement-breakpoint
CREATE TABLE `ssh_hosts` (
	`id` text PRIMARY KEY NOT NULL,
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
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_hosts_fqdn_unique` ON `ssh_hosts` (`fqdn`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_hosts_status` ON `ssh_hosts` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_hosts_kms_pubkey` ON `ssh_hosts` (`kms_pubkey_id`);
--> statement-breakpoint
CREATE TABLE `ssh_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`external_subject` text,
	`email` text,
	`openssh_user_pubkey` text,
	`pubkey_source` text DEFAULT 'per_request' NOT NULL,
	`kms_pubkey_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_identities_subject_unique` ON `ssh_identities` (`subject`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_identities_status` ON `ssh_identities` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_identities_ext_sub` ON `ssh_identities` (`external_subject`);
--> statement-breakpoint
CREATE TABLE `ssh_certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`ca_id` text NOT NULL,
	`cert_type` text NOT NULL,
	`host_id` text,
	`identity_id` text,
	`serial` text NOT NULL,
	`key_id` text NOT NULL,
	`principals` text NOT NULL,
	`valid_after` integer NOT NULL,
	`valid_before` integer NOT NULL,
	`extensions` text,
	`critical_options` text,
	`cert_openssh` text NOT NULL,
	`subject_pubkey_fingerprint` text NOT NULL,
	`kms_signing_key_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revocation_date` integer,
	`revocation_reason` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`superseded_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ca_id`) REFERENCES `ssh_cas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_hosts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`identity_id`) REFERENCES `ssh_identities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`superseded_by`) REFERENCES `ssh_certificates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_certs_ca_serial` ON `ssh_certificates` (`ca_id`,`serial`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_certs_ca` ON `ssh_certificates` (`ca_id`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_certs_status` ON `ssh_certificates` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_certs_type` ON `ssh_certificates` (`cert_type`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_certs_host` ON `ssh_certificates` (`host_id`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_certs_identity` ON `ssh_certificates` (`identity_id`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_certs_keyid` ON `ssh_certificates` (`key_id`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_certs_fp` ON `ssh_certificates` (`subject_pubkey_fingerprint`);
--> statement-breakpoint
CREATE TABLE `ssh_principals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ssh_principals_name_unique` ON `ssh_principals` (`name`);
--> statement-breakpoint
CREATE TABLE `ssh_user_principals` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`principal_id` text NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `ssh_identities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`principal_id`) REFERENCES `ssh_principals`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_user_principals` ON `ssh_user_principals` (`identity_id`,`principal_id`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_user_principals_identity` ON `ssh_user_principals` (`identity_id`);
--> statement-breakpoint
CREATE TABLE `ssh_host_principal_maps` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`local_account` text NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`principal_id`) REFERENCES `ssh_principals`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_host_principal_maps` ON `ssh_host_principal_maps` (`host_id`,`principal_id`,`local_account`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_host_principal_maps_host` ON `ssh_host_principal_maps` (`host_id`);
--> statement-breakpoint
CREATE TABLE `ssh_revocations` (
	`id` text PRIMARY KEY NOT NULL,
	`ca_id` text NOT NULL,
	`target_type` text NOT NULL,
	`cert_id` text,
	`serial` text,
	`key_fingerprint` text,
	`key_id` text,
	`reason` text,
	`revoked_by` text,
	`revoked_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ca_id`) REFERENCES `ssh_cas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cert_id`) REFERENCES `ssh_certificates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_ssh_revocations_ca` ON `ssh_revocations` (`ca_id`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_revocations_cert` ON `ssh_revocations` (`cert_id`);
--> statement-breakpoint
CREATE TABLE `ssh_krls` (
	`id` text PRIMARY KEY NOT NULL,
	`ca_id` text NOT NULL,
	`krl_number` integer NOT NULL,
	`version_hash` text NOT NULL,
	`krl_blob` blob NOT NULL,
	`ca_signature` blob,
	`this_update` integer NOT NULL,
	`next_update` integer NOT NULL,
	`revoked_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ca_id`) REFERENCES `ssh_cas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ssh_krls_ca_number` ON `ssh_krls` (`ca_id`,`krl_number`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_krls_version` ON `ssh_krls` (`version_hash`);
