CREATE TABLE `integration_ras` (
	`integration_id` text PRIMARY KEY NOT NULL,
	`ca_id` text NOT NULL,
	`key_id` text,
	`public_key_id` text,
	`certificate_id` text,
	`certificate_pem` text,
	`previous` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ca_id`) REFERENCES `certificate_authorities`(`id`) ON UPDATE no action ON DELETE restrict
);
