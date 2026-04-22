-- Add `period` to budget_line so we preserve monthly breakdowns alongside
-- the annual total on import. PK becomes (year, department, period, line_item).
ALTER TABLE "budget_line" ADD COLUMN "period" text DEFAULT 'annual' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_line" DROP CONSTRAINT "budget_line_year_department_line_item_pk";--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_year_department_period_line_item_pk" PRIMARY KEY("year","department","period","line_item");
