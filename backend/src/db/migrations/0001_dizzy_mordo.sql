ALTER TABLE `certificate_authorities` ADD `key_algorithm` text NOT NULL;--> statement-breakpoint
ALTER TABLE `certificate_authorities` ADD `kms_certificate_id` text NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_ca_algorithm` ON `certificate_authorities` (`key_algorithm`);