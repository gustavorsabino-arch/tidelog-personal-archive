ALTER TABLE "app"."approval_assignee" ADD COLUMN IF NOT EXISTS "stage" text DEFAULT 'finance' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "required_head_approvals" integer;--> statement-breakpoint
ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "required_finance_approvals" integer;
