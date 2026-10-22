ALTER TABLE `clusters` RENAME TO `integrations`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`ca_id` text NOT NULL,
	`kind` text DEFAULT 'generic' NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`created_by` text,
	`last_seen` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ca_id`) REFERENCES `certificate_authorities`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_integrations`("id", "name", "description", "ca_id", "kind", "token_hash", "token_prefix", "created_by", "last_seen", "revoked_at", "created_at", "updated_at") SELECT "id", "name", "description", "ca_id", 'kubernetes', "token_hash", "token_prefix", "created_by", "last_seen", "revoked_at", "created_at", "updated_at" FROM `integrations`;--> statement-breakpoint
DROP TABLE `integrations`;--> statement-breakpoint
ALTER TABLE `__new_integrations` RENAME TO `integrations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_integrations_name` ON `integrations` (`name`);--> statement-breakpoint
CREATE INDEX `idx_integrations_ca_id` ON `integrations` (`ca_id`);--> statement-breakpoint
CREATE INDEX `idx_integrations_token_prefix` ON `integrations` (`token_prefix`);--> statement-breakpoint
CREATE INDEX `idx_integrations_revoked` ON `integrations` (`revoked_at`);--> statement-breakpoint
ALTER TABLE `certificates` ADD `integration_id` text;--> statement-breakpoint
CREATE INDEX `idx_certificates_integration` ON `certificates` (`integration_id`);
--> statement-breakpoint
UPDATE certificates SET integration_id = k8s_cluster_id WHERE k8s_cluster_id IS NOT NULL;
--> statement-breakpoint
-- Only reclassify identities whose existing certificates are unambiguously SCEP.
UPDATE integrations SET kind = 'scep'
WHERE EXISTS (SELECT 1 FROM certificates c WHERE c.integration_id = integrations.id AND c.request_uid LIKE 'scep:%')
AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.integration_id = integrations.id AND (c.request_uid IS NULL OR c.request_uid NOT LIKE 'scep:%'));
--> statement-breakpoint
UPDATE certificates SET source_type = 'scep', k8s_cluster_id = NULL
WHERE integration_id IN (SELECT id FROM integrations WHERE kind = 'scep');
