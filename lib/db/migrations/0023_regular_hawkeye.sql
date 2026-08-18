CREATE TABLE IF NOT EXISTS "app"."approval_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref_number" text NOT NULL,
	"submitter_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"vendor_name" text NOT NULL,
	"description" text,
	"amount" numeric(20, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"invoice_number" text,
	"invoice_date" date,
	"due_date" date,
	"gl_account" text,
	"department" text,
	"entity" text,
	"payment_type" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"paid_by_id" text,
	"paid_at" timestamp with time zone,
	"payment_reference" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_request_ref_number_unique" UNIQUE("ref_number"),
	CONSTRAINT "chk_decider_not_submitter" CHECK ("app"."approval_request"."decided_by_id" IS NULL OR "app"."approval_request"."decided_by_id" <> "app"."approval_request"."submitter_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."approval_attachment" ADD CONSTRAINT "approval_attachment_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."approval_request"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."approval_attachment" ADD CONSTRAINT "approval_attachment_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."approval_request" ADD CONSTRAINT "approval_request_submitter_id_user_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."approval_request" ADD CONSTRAINT "approval_request_decided_by_id_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."approval_request" ADD CONSTRAINT "approval_request_paid_by_id_user_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_attachment_request_idx" ON "app"."approval_attachment" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_submitter_idx" ON "app"."approval_request" USING btree ("submitter_id","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_status_idx" ON "app"."approval_request" USING btree ("status","submitted_at");