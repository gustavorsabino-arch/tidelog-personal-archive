CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
ALTER TABLE "public"."account" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."session" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."user" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."verification" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."user_department" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."entity" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."token" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."wallet" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."balance_snapshot" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."price" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."transaction" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."budget_line" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."budget_qb_mapping" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."budget_team_member" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."qb_account_catalog" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."qb_account_map" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."qb_connection" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."qb_report_cache" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."qb_transaction_cache" SET SCHEMA "app";
--> statement-breakpoint
ALTER TABLE "public"."audit_log" SET SCHEMA "app";
