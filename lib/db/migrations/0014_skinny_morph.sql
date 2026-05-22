CREATE TYPE "app"."qb_posting_status" AS ENUM('unposted', 'posted', 'posted_modified', 'voided', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."qb_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"doc_number" text NOT NULL,
	"qb_journal_entry_id" text,
	"posting_status" "app"."qb_posting_status" DEFAULT 'unposted' NOT NULL,
	"posting_error" text,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"wallet_address" text,
	"token" text,
	"month_yyyymm" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."wallet" ADD COLUMN "is_bulk_treasury" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."tx_qb_state" ADD COLUMN "post_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."qb_post" ADD CONSTRAINT "qb_post_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."qb_post" ADD CONSTRAINT "qb_post_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_post_entity_idx" ON "app"."qb_post" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_post_journal_entry_idx" ON "app"."qb_post" USING btree ("qb_journal_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_post_status_idx" ON "app"."qb_post" USING btree ("posting_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_post_entity_month_idx" ON "app"."qb_post" USING btree ("entity_id","month_yyyymm");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."tx_qb_state" ADD CONSTRAINT "tx_qb_state_post_id_qb_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "app"."qb_post"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_qb_state_post_id_idx" ON "app"."tx_qb_state" USING btree ("post_id");