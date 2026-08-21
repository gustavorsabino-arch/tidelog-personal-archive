ALTER TABLE "app"."tx_qb_state" ADD COLUMN IF NOT EXISTS "posted_counterparty_gl" text;--> statement-breakpoint
ALTER TABLE "app"."approval_link" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'user' NOT NULL;
