CREATE TABLE IF NOT EXISTS "app"."prepayment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"prepaid_account" text NOT NULL,
	"vendor_name" text NOT NULL,
	"description" text,
	"total_amount" numeric(20, 2) NOT NULL,
	"start_month" text NOT NULL,
	"months" integer NOT NULL,
	"expense_gl_account" text,
	"class_name" text,
	"source_txn_id" text,
	"source_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prepayment_entity_idx" ON "app"."prepayment" USING btree ("entity_id","status");