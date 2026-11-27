-- CRL change generation and deleted revocations (TASK-288). Additive: one table, three nullable
-- or defaulted columns, triggers. Existing crl_publication rows start with verified_generation
-- NULL: the first check of each CA after this migration reads the full state once (crl.service.ts).
-- The triggers run in the transaction of the write, for every process and every write path
-- (services, bulk routes, external API, SCEP, data copied from v3), and add 1 to
-- crl_publication.change_generation of the CA. A CA with no crl_publication row has no verified
-- state to invalidate. A CRL insert does not count: a download compares the newest row id with
-- verified_crl_id.
CREATE TABLE `crl_deleted_revocations` (
	`ca_id` text NOT NULL,
	`serial_number` text NOT NULL,
	`revocation_date` integer NOT NULL,
	`revocation_reason` text,
	`certificate_id` text,
	`deleted_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`ca_id`, `serial_number`),
	FOREIGN KEY (`ca_id`) REFERENCES `certificate_authorities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `crl_publication` ADD `change_generation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `crl_publication` ADD `verified_generation` integer;--> statement-breakpoint
ALTER TABLE `crl_publication` ADD `verified_crl_id` text;--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_certificates_insert` AFTER INSERT ON `certificates` WHEN NEW.`status` = 'revoked' BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` = NEW.`ca_id`; END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_certificates_update` AFTER UPDATE OF `status`, `revocation_date`, `revocation_reason`, `serial_number`, `ca_id` ON `certificates` WHEN OLD.`status` = 'revoked' OR NEW.`status` = 'revoked' BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` IN (OLD.`ca_id`, NEW.`ca_id`); END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_certificates_delete` AFTER DELETE ON `certificates` WHEN OLD.`status` = 'revoked' BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` = OLD.`ca_id`; END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_removals_insert` AFTER INSERT ON `crl_entry_removals` BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` = NEW.`ca_id`; END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_removals_update` AFTER UPDATE ON `crl_entry_removals` BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` IN (OLD.`ca_id`, NEW.`ca_id`); END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_removals_delete` AFTER DELETE ON `crl_entry_removals` BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` = OLD.`ca_id`; END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_deleted_revocations_insert` AFTER INSERT ON `crl_deleted_revocations` BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` = NEW.`ca_id`; END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_deleted_revocations_update` AFTER UPDATE ON `crl_deleted_revocations` BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` IN (OLD.`ca_id`, NEW.`ca_id`); END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_deleted_revocations_delete` AFTER DELETE ON `crl_deleted_revocations` BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` = OLD.`ca_id`; END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_crls_update` AFTER UPDATE OF `crl_pem`, `crl_number`, `next_update`, `ca_id` ON `crls` BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` IN (OLD.`ca_id`, NEW.`ca_id`); END;
--> statement-breakpoint
CREATE TRIGGER `trg_crl_gen_crls_delete` AFTER DELETE ON `crls` BEGIN UPDATE `crl_publication` SET `change_generation` = `change_generation` + 1 WHERE `ca_id` = OLD.`ca_id`; END;
