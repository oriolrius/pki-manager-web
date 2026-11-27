-- CRL publication (TASK-288). Additive: two new tables, one nullable column, one partial index.
-- Existing CRL rows keep their number, DER and NULL entries_sha256. CRLs written before this
-- migration can repeat a number per CA; the unique index covers only new rows (non-NULL digest),
-- and new numbers start above the highest existing one (crl.service.ts).
CREATE TABLE `crl_entry_removals` (
	`ca_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`certificate_id` text,
	`removed_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`ca_id`, `serial_number`),
	FOREIGN KEY (`ca_id`) REFERENCES `certificate_authorities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `crl_publication` (
	`ca_id` text PRIMARY KEY NOT NULL,
	`last_number` integer DEFAULT 0 NOT NULL,
	`lease` text,
	`lease_until` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_failure_at` integer,
	`retry_after` integer,
	`last_published_at` integer,
	FOREIGN KEY (`ca_id`) REFERENCES `certificate_authorities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `crls` ADD `entries_sha256` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_crls_published_number` ON `crls` (`ca_id`,`crl_number`) WHERE entries_sha256 IS NOT NULL;