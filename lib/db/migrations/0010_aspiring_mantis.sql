CREATE TABLE IF NOT EXISTS "app"."fifo_state" (
	"entity_id" text NOT NULL,
	"asset" text NOT NULL,
	"open_lots" jsonb DEFAULT '[]' NOT NULL,
	"last_processed_blocktime" timestamp with time zone,
	"tx_count_at_last_compute" integer DEFAULT 0 NOT NULL,
	"fifo_version" integer DEFAULT 1 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fifo_state_entity_id_asset_pk" PRIMARY KEY("entity_id","asset")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."transaction_gain" (
	"tx_hash" text NOT NULL,
	"wallet_address" text NOT NULL,
	"direction" text NOT NULL,
	"entity_id" text NOT NULL,
	"asset" text NOT NULL,
	"st_gain" numeric(20, 2) DEFAULT '0' NOT NULL,
	"lt_gain" numeric(20, 2) DEFAULT '0' NOT NULL,
	"realized_term" text,
	"internal" boolean DEFAULT false NOT NULL,
	"internal_paired_wallet_addr" text,
	"no_basis" boolean DEFAULT false NOT NULL,
	"lots" jsonb DEFAULT '[]' NOT NULL,
	"balance_after" numeric(38, 18) DEFAULT '0' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_gain_tx_hash_wallet_address_direction_pk" PRIMARY KEY("tx_hash","wallet_address","direction")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."fifo_state" ADD CONSTRAINT "fifo_state_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."transaction_gain" ADD CONSTRAINT "transaction_gain_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_gain_entity_idx" ON "app"."transaction_gain" USING btree ("entity_id","asset");