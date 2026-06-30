CREATE TABLE `ssh_fleet_tokens` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`user_ca_id`) REFERENCES `ssh_cas`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`host_ca_id`) REFERENCES `ssh_cas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ssh_fleet_tokens_hash` ON `ssh_fleet_tokens` (`token_hash`);
--> statement-breakpoint
CREATE TABLE `ssh_idempotency` (
	`key` text PRIMARY KEY NOT NULL,
	`token_id` text,
	`cert_id` text,
	`response` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
