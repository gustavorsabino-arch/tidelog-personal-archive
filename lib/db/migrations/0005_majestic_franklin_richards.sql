CREATE TABLE IF NOT EXISTS "app"."qb_force_refresh_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"from_period" text NOT NULL,
	"status" text NOT NULL,
	"requested_by_email" text NOT NULL,
	"error" text,
	"result" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "qb_force_refresh_run_one_running_idx" ON "app"."qb_force_refresh_run" USING btree ("status") WHERE "app"."qb_force_refresh_run"."status" = 'running';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_force_refresh_run_started_idx" ON "app"."qb_force_refresh_run" USING btree ("started_at" DESC NULLS LAST);