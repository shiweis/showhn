CREATE TABLE `subscribers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`frequency` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_email_unique` ON `subscribers` (`email`);--> statement-breakpoint
CREATE INDEX `idx_subscribers_email` ON `subscribers` (`email`);--> statement-breakpoint
CREATE TABLE `task_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`post_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0,
	`attempts` integer DEFAULT 0,
	`max_attempts` integer DEFAULT 3,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_queue_status_priority` ON `task_queue` (`status`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_queue_type` ON `task_queue` (`type`);--> statement-breakpoint
CREATE INDEX `idx_queue_post_id` ON `task_queue` (`post_id`);--> statement-breakpoint
DROP INDEX `idx_analysis_vibe`;--> statement-breakpoint
DROP INDEX `idx_analysis_interest`;--> statement-breakpoint
ALTER TABLE `ai_analysis` ADD `pick_reason` text;--> statement-breakpoint
ALTER TABLE `ai_analysis` ADD `pick_score` integer;--> statement-breakpoint
ALTER TABLE `ai_analysis` ADD `tier` text;--> statement-breakpoint
ALTER TABLE `ai_analysis` ADD `vibe_tags` text;--> statement-breakpoint
ALTER TABLE `ai_analysis` ADD `strengths` text;--> statement-breakpoint
ALTER TABLE `ai_analysis` ADD `weaknesses` text;--> statement-breakpoint
ALTER TABLE `ai_analysis` ADD `similar_to` text;--> statement-breakpoint
CREATE INDEX `idx_analysis_pick_score` ON `ai_analysis` (`pick_score`);--> statement-breakpoint
ALTER TABLE `ai_analysis` DROP COLUMN `vibe_score`;--> statement-breakpoint
ALTER TABLE `ai_analysis` DROP COLUMN `interest_score`;--> statement-breakpoint
ALTER TABLE `ai_analysis` DROP COLUMN `comment_sentiment`;--> statement-breakpoint
ALTER TABLE `posts` ADD `page_content` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `readme_content` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `github_stars` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `github_language` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `github_description` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `github_updated_at` integer;--> statement-breakpoint
CREATE INDEX `idx_posts_status` ON `posts` (`status`);--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `posts_fts` USING fts5(
	`title`,
	`summary`,
	content='',
	contentless_delete=1,
	tokenize='porter unicode61'
);
