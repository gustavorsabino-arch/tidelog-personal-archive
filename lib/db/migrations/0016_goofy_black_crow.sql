CREATE TYPE "app"."wallet_type" AS ENUM('internal', 'external');--> statement-breakpoint
ALTER TABLE "app"."wallet" ADD COLUMN "type" "app"."wallet_type" DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."wallet" ADD COLUMN "hidden_from_finance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."wallet" ADD COLUMN "needs_backfill" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."wallet" ADD COLUMN "last_full_backfill_at" timestamp with time zone;--> statement-breakpoint

-- Backfill: FTX → hidden
UPDATE "app"."wallet" SET "hidden_from_finance" = true
  WHERE "address" = '6ZRCB7AAqGre6c72PRz3MHLC73VMYvJ8bi9KHf1HFpNk';--> statement-breakpoint

-- Backfill: external (everything currently is_external=true EXCEPT the 2 finance reclassified)
UPDATE "app"."wallet" SET "type" = 'external'
  WHERE "is_external" = true
    AND "address" NOT IN (
      'GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV',
      'DWo8SNtdBDuebAEeVDf7cWBQ6DUvoDbS7K4QTrQvYS1S'
    );--> statement-breakpoint

-- Backfill: the 2 reclassified wallets need a backfill (state change creates gap)
UPDATE "app"."wallet" SET "needs_backfill" = true
  WHERE "address" IN (
    'GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV',
    'DWo8SNtdBDuebAEeVDf7cWBQ6DUvoDbS7K4QTrQvYS1S'
  );--> statement-breakpoint

-- Backfill: any internal-non-hidden wallet with zero txs in DB needs a backfill
-- (catches silent gaps from wallets historically added without backfill)
UPDATE "app"."wallet" SET "needs_backfill" = true
  WHERE "type" = 'internal'
    AND "hidden_from_finance" = false
    AND "address" NOT IN (SELECT DISTINCT "wallet_address" FROM "app"."transaction");--> statement-breakpoint

-- Enforce: external wallets cannot be hidden (redundant combo)
ALTER TABLE "app"."wallet" ADD CONSTRAINT "chk_external_not_hidden" CHECK (NOT ("app"."wallet"."type" = 'external' AND "app"."wallet"."hidden_from_finance" = true));--> statement-breakpoint

-- Verify counts; RAISE EXCEPTION rolls back the entire migration if wrong
DO $$
DECLARE
  hidden_n int;
  external_n int;
  internal_n int;
  needs_n int;
BEGIN
  SELECT count(*) INTO hidden_n FROM "app"."wallet" WHERE hidden_from_finance = true;
  SELECT count(*) INTO external_n FROM "app"."wallet" WHERE type = 'external';
  SELECT count(*) INTO internal_n FROM "app"."wallet" WHERE type = 'internal';
  SELECT count(*) INTO needs_n FROM "app"."wallet" WHERE needs_backfill = true;
  IF hidden_n <> 1 THEN
    RAISE EXCEPTION 'expected 1 hidden wallet (FTX), got %', hidden_n;
  END IF;
  IF needs_n < 2 THEN
    RAISE EXCEPTION 'expected at least 2 wallets needing backfill, got %', needs_n;
  END IF;
  RAISE NOTICE 'wallet states: internal=%, external=%, hidden=%, needs_backfill=%', internal_n, external_n, hidden_n, needs_n;
END $$;--> statement-breakpoint

ALTER TABLE "app"."wallet" DROP COLUMN IF EXISTS "is_external";--> statement-breakpoint
ALTER TABLE "app"."wallet" DROP COLUMN IF EXISTS "overview_only";--> statement-breakpoint
ALTER TABLE "app"."wallet" DROP COLUMN IF EXISTS "include_in_overview";
