CREATE TABLE IF NOT EXISTS "app"."wallet_token_account_code" (
	"wallet_address" text NOT NULL,
	"token_symbol" text NOT NULL,
	"account_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_token_account_code_wallet_address_token_symbol_pk" PRIMARY KEY("wallet_address","token_symbol")
);
--> statement-breakpoint
ALTER TABLE "app"."tx_qb_state" ADD COLUMN "posted_gl_account" text;--> statement-breakpoint
ALTER TABLE "app"."tx_qb_state" ADD COLUMN "posted_gl_source" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."wallet_token_account_code" ADD CONSTRAINT "wallet_token_account_code_wallet_address_wallet_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "app"."wallet"("address") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."wallet_token_account_code" ADD CONSTRAINT "wallet_token_account_code_token_symbol_token_symbol_fk" FOREIGN KEY ("token_symbol") REFERENCES "app"."token"("symbol") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
