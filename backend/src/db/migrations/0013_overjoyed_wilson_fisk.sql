ALTER TABLE `ssh_fleet_tokens` ADD `allowed_principals` text;--> statement-breakpoint
ALTER TABLE `ssh_fleet_tokens` ADD `max_valid_for_seconds` integer;