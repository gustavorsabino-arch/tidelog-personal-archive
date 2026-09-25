CREATE TABLE IF NOT EXISTS "app"."budget_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"department" text NOT NULL,
	"line_item" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"start_period" text NOT NULL,
	"duration_months" integer DEFAULT 1 NOT NULL,
	"notes" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by" text,
	"reversed_at" timestamp with time zone
);
