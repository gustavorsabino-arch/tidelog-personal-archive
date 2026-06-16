CREATE TABLE IF NOT EXISTS "app"."qb_class_catalog" (
	"entity_id" text NOT NULL,
	"qb_class_id" text NOT NULL,
	"qb_class_name" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qb_class_catalog_entity_id_qb_class_id_pk" PRIMARY KEY("entity_id","qb_class_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."qb_vendor_catalog" (
	"entity_id" text NOT NULL,
	"qb_vendor_id" text NOT NULL,
	"display_name" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qb_vendor_catalog_entity_id_qb_vendor_id_pk" PRIMARY KEY("entity_id","qb_vendor_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."qb_class_catalog" ADD CONSTRAINT "qb_class_catalog_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."qb_vendor_catalog" ADD CONSTRAINT "qb_vendor_catalog_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entity"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_class_catalog_name_idx" ON "app"."qb_class_catalog" USING btree ("entity_id","qb_class_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_vendor_catalog_name_idx" ON "app"."qb_vendor_catalog" USING btree ("entity_id","display_name");
