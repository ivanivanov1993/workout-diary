CREATE TABLE `partnerships` (
	`id` text PRIMARY KEY NOT NULL,
	`inviter_id` text NOT NULL,
	`partner_id` text,
	`invite_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partnership_invite_code_idx` ON `partnerships` (`invite_code`);--> statement-breakpoint
CREATE INDEX `partnership_inviter_idx` ON `partnerships` (`inviter_id`);--> statement-breakpoint
CREATE INDEX `partnership_partner_idx` ON `partnerships` (`partner_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_email_idx` ON `profiles` (`email`);--> statement-breakpoint
CREATE TABLE `sync_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_operations_owner_idx` ON `sync_operations` (`owner_id`);--> statement-breakpoint
CREATE TABLE `user_states` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_states_updated_idx` ON `user_states` (`updated_at`);