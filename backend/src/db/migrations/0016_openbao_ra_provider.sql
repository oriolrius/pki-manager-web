-- SCEP RA key provider (OpenBao integration, opt-in).
-- Every existing RA binding keeps its Cosmian KMS key: the new column defaults
-- to 'cosmian'. key_version holds the fixed OpenBao Transit key version and
-- stays NULL for Cosmian bindings. No table rebuild, no foreign-key toggle.
ALTER TABLE `integration_ras` ADD `key_provider` text DEFAULT 'cosmian' NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_ras` ADD `key_version` integer;
