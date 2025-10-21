CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`operation` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`ip_address` text,
	`status` text DEFAULT 'success' NOT NULL,
	`details` text,
	`kms_operation_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_timestamp` ON `audit_log` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_operation` ON `audit_log` (`operation`);--> statement-breakpoint
CREATE TABLE `certificate_authorities` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_dn` text NOT NULL,
	`serial_number` text NOT NULL,
	`not_before` integer NOT NULL,
	`not_after` integer NOT NULL,
	`kms_key_id` text NOT NULL,
	`certificate_pem` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revocation_date` integer,
	`revocation_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificate_authorities_serial_number_unique` ON `certificate_authorities` (`serial_number`);--> statement-breakpoint
CREATE INDEX `idx_ca_serial` ON `certificate_authorities` (`serial_number`);--> statement-breakpoint
CREATE INDEX `idx_ca_status` ON `certificate_authorities` (`status`);--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`ca_id` text NOT NULL,
	`subject_dn` text NOT NULL,
	`serial_number` text NOT NULL,
	`certificate_type` text NOT NULL,
	`not_before` integer NOT NULL,
	`not_after` integer NOT NULL,
	`certificate_pem` text NOT NULL,
	`kms_key_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`revocation_date` integer,
	`revocation_reason` text,
	`san_dns` text,
	`san_ip` text,
	`san_email` text,
	`renewed_from_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ca_id`) REFERENCES `certificate_authorities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`renewed_from_id`) REFERENCES `certificates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_serial_number_unique` ON `certificates` (`serial_number`);--> statement-breakpoint
CREATE INDEX `idx_certificates_ca_id` ON `certificates` (`ca_id`);--> statement-breakpoint
CREATE INDEX `idx_certificates_status` ON `certificates` (`status`);--> statement-breakpoint
CREATE INDEX `idx_certificates_serial` ON `certificates` (`serial_number`);--> statement-breakpoint
CREATE INDEX `idx_certificates_type` ON `certificates` (`certificate_type`);--> statement-breakpoint
CREATE TABLE `crls` (
	`id` text PRIMARY KEY NOT NULL,
	`ca_id` text NOT NULL,
	`crl_number` integer NOT NULL,
	`this_update` integer NOT NULL,
	`next_update` integer NOT NULL,
	`crl_pem` text NOT NULL,
	`revoked_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ca_id`) REFERENCES `certificate_authorities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_crls_ca_id` ON `crls` (`ca_id`);--> statement-breakpoint
CREATE INDEX `idx_crls_number` ON `crls` (`ca_id`,`crl_number`);