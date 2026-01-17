CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"subtask_id" uuid,
	"agent_type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'starting' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	"logs" text DEFAULT '' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "code_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"result" varchar(20) NOT NULL,
	"iteration" integer NOT NULL,
	"summary" text NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"payload" jsonb NOT NULL,
	"sent_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"repository_full_name" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"branch_name" text NOT NULL,
	"head_sha" text NOT NULL,
	"url" text NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"reviews_passed" boolean DEFAULT false NOT NULL,
	"checks_status" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"merged_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"subproject_path" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_run_id" uuid,
	"files_modified" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_project_item_id" text NOT NULL,
	"github_project_id" text NOT NULL,
	"repository_id" integer NOT NULL,
	"repository_full_name" text NOT NULL,
	"installation_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"branch_name" text,
	"pull_request_number" integer,
	"pull_request_url" text,
	"error_message" text,
	"human_review_question" text,
	"human_review_answer" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_subtask_id_subtasks_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "public"."subtasks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "code_reviews" ADD CONSTRAINT "code_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "code_reviews" ADD CONSTRAINT "code_reviews_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_task_id_idx" ON "agent_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_subtask_id_idx" ON "agent_runs" USING btree ("subtask_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "code_reviews_task_id_idx" ON "code_reviews" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_task_id_idx" ON "notifications" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_requests_task_id_idx" ON "pull_requests" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_requests_repository_idx" ON "pull_requests" USING btree ("repository_full_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subtasks_task_id_idx" ON "subtasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subtasks_status_idx" ON "subtasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_github_project_item_idx" ON "tasks" USING btree ("github_project_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_repository_idx" ON "tasks" USING btree ("repository_full_name");