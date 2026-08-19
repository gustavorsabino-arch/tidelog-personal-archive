CREATE TABLE IF NOT EXISTS "app"."approval_assignee" (
	"request_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_assignee_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."approval_decision" (
	"request_id" uuid NOT NULL,
	"approver_id" text NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decision_request_id_approver_id_pk" PRIMARY KEY("request_id","approver_id")
);
--> statement-breakpoint
ALTER TABLE "app"."approval_request" ADD COLUMN "request_type" text DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."approval_request" ADD COLUMN "network" text;--> statement-breakpoint
ALTER TABLE "app"."approval_request" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "app"."approval_request" ADD COLUMN "wallet_address" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."approval_assignee" ADD CONSTRAINT "approval_assignee_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."approval_request"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."approval_assignee" ADD CONSTRAINT "approval_assignee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."approval_decision" ADD CONSTRAINT "approval_decision_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."approval_request"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."approval_decision" ADD CONSTRAINT "approval_decision_approver_id_user_id_fk" FOREIGN KEY ("approver_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
