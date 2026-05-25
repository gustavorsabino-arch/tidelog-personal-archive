CREATE TABLE IF NOT EXISTS "app"."budget_qb_mapping_exclusion" (
	"qb_account_number" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
