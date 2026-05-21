CREATE TABLE IF NOT EXISTS "app"."counterparty_gl_map" (
	"entity_id" text NOT NULL,
	"counterparty_address" text NOT NULL,
	"gl_account_number" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "counterparty_gl_map_entity_id_counterparty_address_pk" PRIMARY KEY("entity_id","counterparty_address")
);
--> statement-breakpoint
ALTER TABLE "app"."tx_qb_state" ADD COLUMN "gl_account_override" text;--> statement-breakpoint
ALTER TABLE "app"."tx_qb_state" ADD COLUMN "counterparty_gl_override" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."counterparty_gl_map" ADD CONSTRAINT "counterparty_gl_map_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."counterparty_gl_map" ADD CONSTRAINT "counterparty_gl_map_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
