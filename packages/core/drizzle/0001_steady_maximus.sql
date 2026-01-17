ALTER TABLE "tasks" ADD COLUMN "is_epic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "linked_github_issue_number" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "child_dependencies" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_parent_task_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_is_epic_idx" ON "tasks" USING btree ("is_epic");