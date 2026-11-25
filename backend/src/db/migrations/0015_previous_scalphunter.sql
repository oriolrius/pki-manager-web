-- Issue #52: scope the SSH Idempotency-Key cache to the fleet token.
-- The old table keyed rows on the Idempotency-Key alone, so one token could
-- replay the response cached for another token. The new primary key is
-- (token_id, key). The old rows are dropped, not copied: they have no op or
-- request hash, and a row with a NULL token_id can not be scoped. It is a
-- cache: a client retry after the upgrade mints a new certificate once.
-- No table references ssh_idempotency, so the drop needs no foreign-key toggle.
DROP TABLE `ssh_idempotency`;--> statement-breakpoint
CREATE TABLE `ssh_idempotency` (
	`token_id` text NOT NULL,
	`key` text NOT NULL,
	`op` text NOT NULL,
	`request_hash` text NOT NULL,
	`cert_id` text,
	`response` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`token_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idx_ssh_idempotency_expires` ON `ssh_idempotency` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_ssh_idempotency_cert` ON `ssh_idempotency` (`cert_id`);
