-- BLK-02 (TASK-179, decision-016): per-host user access blocks + per-host
-- composed KRL lineage + the single-row GLOBAL KRL-number allocator shared by
-- both lineages (pinned req #4: a host switched between lineages must always
-- see strictly increasing signed KRL header numbers).
CREATE TABLE `ssh_host_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`identity_id` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`lifted_by` text,
	`lifted_at` integer,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_hosts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`identity_id`) REFERENCES `ssh_identities`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_ssh_host_blocks_host` ON `ssh_host_blocks` (`host_id`);--> statement-breakpoint
CREATE INDEX `idx_ssh_host_blocks_identity` ON `ssh_host_blocks` (`identity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_host_blocks_active_pair` ON `ssh_host_blocks` (`host_id`,`identity_id`) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `ssh_host_krls` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`krl_number` integer NOT NULL,
	`version_hash` text NOT NULL,
	`krl_blob` blob NOT NULL,
	`ca_signature` blob,
	`this_update` integer NOT NULL,
	`next_update` integer NOT NULL,
	`revoked_count` integer DEFAULT 0 NOT NULL,
	`block_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `ssh_hosts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_host_krls_host_number` ON `ssh_host_krls` (`host_id`,`krl_number`);--> statement-breakpoint
CREATE INDEX `idx_ssh_host_krls_version` ON `ssh_host_krls` (`version_hash`);--> statement-breakpoint
CREATE INDEX `idx_ssh_host_krls_host` ON `ssh_host_krls` (`host_id`);--> statement-breakpoint
CREATE TABLE `ssh_krl_seq` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `ssh_krl_seq` (`id`, `value`) VALUES (1, COALESCE((SELECT MAX(`krl_number`) FROM `ssh_krls`), 0));
