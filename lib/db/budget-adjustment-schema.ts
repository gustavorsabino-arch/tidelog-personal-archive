import { sql, type SQL } from 'drizzle-orm'

/**
 * Self-healing schema for the Budget Adjustments feature.
 *
 * Why this exists: migrations don't run on deploy and the app owner has no
 * DB credentials, so a merged migration can sit unapplied while the code is
 * live. Same approach as lib/db/approvals-schema.ts: the adjustments routes
 * call ensureBudgetAdjustmentTable() inside the request (the OIDC DB token
 * only exists per-request on Vercel), which creates the table if missing.
 *
 * Maintenance contract: BUDGET_ADJUSTMENT_TABLE_DDL must stay identical to
 * lib/db/migrations/0032_budget_adjustment.sql (a test enforces this). A later
 * real `db:migrate` is a no-op because both use CREATE TABLE IF NOT EXISTS.
 */
export const BUDGET_ADJUSTMENT_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "app"."budget_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"department" text NOT NULL,
	"line_item" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"start_period" text NOT NULL,
	"duration_months" integer DEFAULT 1 NOT NULL,
	"notes" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by" text,
	"reversed_at" timestamp with time zone
);`

const TABLE_PROBE = sql`
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'app' AND table_name = 'budget_adjustment'
  LIMIT 1
`

const CONCURRENT_CREATE_ERROR = /already exists|duplicate key/i

type ExecuteQuery =(query: SQL) => Promise<unknown>

/**
 * Build a memoized "make sure the table exists" function. The executor is
 * injected so tests can run it without a database.
 */
export function createEnsureBudgetAdjustmentTable(execute: ExecuteQuery): () => Promise<void> {
  let ensurePromise: Promise<void> | null = null

  return function ensureBudgetAdjustmentTable(): Promise<void> {
    if (!ensurePromise) {
      ensurePromise = (async () => {
        const rows = await execute(TABLE_PROBE)
        if (Array.isArray(rows) && rows.length > 0) return
        console.info('[budget-adjustment-schema] table missing — creating app.budget_adjustment')
        try {
          await execute(sql.raw(BUDGET_ADJUSTMENT_TABLE_DDL))
        } catch (err) {
          // Two cold instances can race the CREATE; IF NOT EXISTS isn't atomic,
          // so the loser may get a duplicate error even though the table now exists.
          if (!CONCURRENT_CREATE_ERROR.test((err as Error).message)) throw err
        }
      })().catch((err) => {
        // Don't cache a failure for the instance lifetime; the next request retries.
        ensurePromise = null
        throw err
      })
    }
    return ensurePromise
  }
}

// Lazy import so importing this module (e.g. from tests) doesn't open a DB connection.
export const ensureBudgetAdjustmentTable = createEnsureBudgetAdjustmentTable(async (query) => {
  const { db } = await import('@/lib/db')
  return db.execute(query)
})
