-- Add source tracking columns to certificates
ALTER TABLE `certificates` ADD `source_type` text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE `certificates` ADD `k8s_cluster_id` text;
--> statement-breakpoint
ALTER TABLE `certificates` ADD `k8s_namespace` text;
--> statement-breakpoint
ALTER TABLE `certificates` ADD `k8s_resource` text;
--> statement-breakpoint
ALTER TABLE `certificates` ADD `request_uid` text;
--> statement-breakpoint
CREATE INDEX `idx_certificates_source` ON `certificates` (`source_type`);
--> statement-breakpoint
CREATE INDEX `idx_certificates_k8s_cluster` ON `certificates` (`k8s_cluster_id`);
--> statement-breakpoint
CREATE INDEX `idx_certificates_request_uid` ON `certificates` (`request_uid`);
--> statement-breakpoint
CREATE TABLE `clusters` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `ca_id` text NOT NULL,
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
CREATE INDEX `idx_clusters_name` ON `clusters` (`name`);
--> statement-breakpoint
CREATE INDEX `idx_clusters_ca_id` ON `clusters` (`ca_id`);
--> statement-breakpoint
CREATE INDEX `idx_clusters_token_prefix` ON `clusters` (`token_prefix`);
--> statement-breakpoint
CREATE INDEX `idx_clusters_revoked` ON `clusters` (`revoked_at`);
