CREATE TABLE IF NOT EXISTS "qb_account_catalog" (
	"entity_id" text NOT NULL,
	"qb_account_id" text NOT NULL,
	"qb_account_number" text,
	"qb_account_name" text NOT NULL,
	"account_type" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qb_account_catalog_entity_id_qb_account_id_pk" PRIMARY KEY("entity_id","qb_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_transaction_cache" (
	"entity_id" text NOT NULL,
	"txn_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qb_transaction_cache_entity_id_txn_id_pk" PRIMARY KEY("entity_id","txn_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_account_catalog" ADD CONSTRAINT "qb_account_catalog_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_transaction_cache" ADD CONSTRAINT "qb_transaction_cache_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_account_catalog_number_idx" ON "qb_account_catalog" USING btree ("entity_id","qb_account_number");