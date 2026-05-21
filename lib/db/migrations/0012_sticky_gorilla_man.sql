CREATE TABLE IF NOT EXISTS "app"."tx_qb_state" (
	"tx_hash" text NOT NULL,
	"wallet_address" text NOT NULL,
	"direction" text NOT NULL,
	"asset" text NOT NULL,
	"entity_id" text NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "tx_qb_state_tx_hash_wallet_address_direction_asset_pk" PRIMARY KEY("tx_hash","wallet_address","direction","asset")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."tx_qb_state" ADD CONSTRAINT "tx_qb_state_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."tx_qb_state" ADD CONSTRAINT "tx_qb_state_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_qb_state_entity_idx" ON "app"."tx_qb_state" USING btree ("entity_id");