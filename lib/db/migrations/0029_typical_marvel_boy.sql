CREATE TABLE IF NOT EXISTS "app"."vendor_default" (
	"vendor_name" text PRIMARY KEY NOT NULL,
	"gl_account" text NOT NULL,
	"gl_account_name" text,
	"class_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
