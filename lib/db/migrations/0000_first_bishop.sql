CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_department" (
	"user_id" text NOT NULL,
	"department" text NOT NULL,
	CONSTRAINT "user_department_user_id_department_pk" PRIMARY KEY("user_id","department")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"qb_realm_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"decimals" integer NOT NULL,
	"coin_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet" (
	"address" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"chain" text NOT NULL,
	"entity_id" text NOT NULL,
	"account_code" text,
	"is_external" boolean DEFAULT false NOT NULL,
	"overview_only" boolean DEFAULT false NOT NULL,
	"include_in_overview" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_snapshot" (
	"date" date NOT NULL,
	"wallet_address" text NOT NULL,
	"token" text NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_snapshot_date_wallet_address_token_pk" PRIMARY KEY("date","wallet_address","token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price" (
	"token" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_token_timestamp_pk" PRIMARY KEY("token","timestamp")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_hash" text NOT NULL,
	"wallet_address" text NOT NULL,
	"entity_id" text NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"asset" text NOT NULL,
	"qty" numeric(38, 18) NOT NULL,
	"direction" text NOT NULL,
	"price" numeric(38, 18),
	"usd" numeric(20, 2),
	"price_source" text,
	"counterparty" text,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tx_unique" UNIQUE("tx_hash","wallet_address","asset","direction")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_line" (
	"year" integer NOT NULL,
	"department" text NOT NULL,
	"line_item" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_line_year_department_line_item_pk" PRIMARY KEY("year","department","line_item")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_qb_mapping" (
	"qb_account_number" text NOT NULL,
	"department" text NOT NULL,
	"line_item" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_qb_mapping_qb_account_number_department_line_item_pk" PRIMARY KEY("qb_account_number","department","line_item")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_team_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"entity_id" text,
	"classification" text,
	"department" text NOT NULL,
	"role" text,
	"location" text,
	"ft" boolean DEFAULT true NOT NULL,
	"salary" numeric(20, 2),
	"bonus" numeric(20, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_account_map" (
	"realm_id" text NOT NULL,
	"qb_account_id" text NOT NULL,
	"qb_account_number" text,
	"qb_account_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qb_account_map_realm_id_qb_account_id_pk" PRIMARY KEY("realm_id","qb_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_connection" (
	"realm_id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"realm_name" text,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_report_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"report_type" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"filter_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qb_report_cache_unique" UNIQUE("entity_id","report_type","period_start","period_end","filter_params")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_department" ADD CONSTRAINT "user_department_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet" ADD CONSTRAINT "wallet_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_wallet_address_wallet_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallet"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_token_token_symbol_fk" FOREIGN KEY ("token") REFERENCES "public"."token"("symbol") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price" ADD CONSTRAINT "price_token_token_symbol_fk" FOREIGN KEY ("token") REFERENCES "public"."token"("symbol") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_wallet_address_wallet_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallet"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction" ADD CONSTRAINT "transaction_asset_token_symbol_fk" FOREIGN KEY ("asset") REFERENCES "public"."token"("symbol") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_team_member" ADD CONSTRAINT "budget_team_member_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_account_map" ADD CONSTRAINT "qb_account_map_realm_id_qb_connection_realm_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."qb_connection"("realm_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_connection" ADD CONSTRAINT "qb_connection_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_report_cache" ADD CONSTRAINT "qb_report_cache_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "balance_date_idx" ON "balance_snapshot" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_token_ts_idx" ON "price" USING btree ("token","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_entity_time_idx" ON "transaction" USING btree ("entity_id","block_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_wallet_time_idx" ON "transaction" USING btree ("wallet_address","block_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_report_cache_lookup_idx" ON "qb_report_cache" USING btree ("entity_id","report_type","fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_user_time_idx" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_action_time_idx" ON "audit_log" USING btree ("action","created_at");