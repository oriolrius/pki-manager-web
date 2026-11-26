-- Key store objects (decision-018). Additive: a new table, no change to existing rows.
-- Existing kms_* ids keep their meaning; OpenBao-backed objects get rows here.
CREATE TABLE `keystore_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`object_type` text NOT NULL,
	`provider` text DEFAULT 'openbao' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`mount` text,
	`key_name` text,
	`key_version` integer,
	`key_algorithm` text,
	`exportable` integer,
	`purpose` text,
	`public_key_pem` text,
	`certificate_pem` text,
	`issuer_certificate_id` text,
	`private_key_id` text,
	`public_key_id` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`destroyed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_keystore_objects_type` ON `keystore_objects` (`object_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_keystore_objects_key` ON `keystore_objects` (`mount`,`key_name`,`object_type`);