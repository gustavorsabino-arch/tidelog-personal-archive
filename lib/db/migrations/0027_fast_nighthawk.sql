ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "slack_message_ts" text;
