ALTER TYPE "app"."qb_posting_status" ADD VALUE 'posted_manually' BEFORE 'voided';--> statement-breakpoint
DROP TABLE "app"."qb_account_map" CASCADE;