import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * Self-healing schema for the Approvals feature.
 *
 * Why this exists: the operator has no local DB credentials, so approvals
 * migrations are applied against prod by the app itself instead of
 * `bun run db:migrate`. Previously that meant manually opening
 * /api/admin/apply-approvals-migration after every deploy — forget it and
 * every approvals endpoint 500s until someone remembers. Now the approvals
 * API routes call ensureApprovalsSchema() before touching the tables: a
 * single memoized probe checks the newest expected column and, only when
 * something is missing, runs the full (idempotent) statement list.
 *
 * IMPORTANT: this must run inside a REQUEST, never at server boot — on
 * Vercel the DB credential is an OIDC token injected per-request
 * (x-vercel-oidc-token), so a boot-time hook (instrumentation.ts) has no
 * way to connect. That approach was tried and reverted.
 *
 * Maintenance contract: when a new approvals migration is generated,
 * append its statements here (IF NOT EXISTS / duplicate_object-tolerant
 * forms) AND update SENTINEL to the newest column so the probe detects the
 * gap. The statements mirror lib/db/migrations/0023–0025; a future real
 * `db:migrate` run is a no-op because those files are idempotent too.
 *
 * The four FK-to-app.user constraints fail with 'permission denied for
 * table user' under the runtime DB role (it lacks REFERENCES on app.user).
 * They are integrity hardening only — skipped and reported, never fatal.
 */

// Newest column the statement list creates — the cheap "is the DB current?"
// probe. UPDATE THIS whenever statements are appended.
const SENTINEL = { table: 'approval_request', column: 'slack_message_ts' }

export const APPROVALS_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "app"."approval_request" (
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
    CONSTRAINT "chk_decider_not_submitter" CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "submitter_id")
  )`,
  `CREATE TABLE IF NOT EXISTS "app"."approval_attachment" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "request_id" uuid NOT NULL,
    "filename" text NOT NULL,
    "content_type" text NOT NULL,
    "size_bytes" integer NOT NULL,
    "sha256" text NOT NULL,
    "data" bytea NOT NULL,
    "uploaded_by_id" text NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    ALTER TABLE "app"."approval_attachment" ADD CONSTRAINT "approval_attachment_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."approval_request"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "app"."approval_attachment" ADD CONSTRAINT "approval_attachment_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "app"."approval_request" ADD CONSTRAINT "approval_request_submitter_id_user_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "app"."approval_request" ADD CONSTRAINT "approval_request_decided_by_id_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "app"."approval_request" ADD CONSTRAINT "approval_request_paid_by_id_user_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `CREATE INDEX IF NOT EXISTS "approval_attachment_request_idx" ON "app"."approval_attachment" USING btree ("request_id")`,
  `CREATE INDEX IF NOT EXISTS "approval_submitter_idx" ON "app"."approval_request" USING btree ("submitter_id","submitted_at")`,
  `CREATE INDEX IF NOT EXISTS "approval_status_idx" ON "app"."approval_request" USING btree ("status","submitted_at")`,

  // ── Migration 0024: Payment/Funding types + multi-approver tables ──
  `ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "request_type" text DEFAULT 'payment' NOT NULL`,
  `ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "network" text`,
  `ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "token" text`,
  `ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "wallet_address" text`,
  `CREATE TABLE IF NOT EXISTS "app"."approval_assignee" (
    "request_id" uuid NOT NULL,
    "user_id" text NOT NULL,
    "email" text NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "approval_assignee_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
  )`,
  `CREATE TABLE IF NOT EXISTS "app"."approval_decision" (
    "request_id" uuid NOT NULL,
    "approver_id" text NOT NULL,
    "decision" text NOT NULL,
    "note" text,
    "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "approval_decision_request_id_approver_id_pk" PRIMARY KEY("request_id","approver_id")
  )`,
  `DO $$ BEGIN
    ALTER TABLE "app"."approval_assignee" ADD CONSTRAINT "approval_assignee_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."approval_request"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "app"."approval_assignee" ADD CONSTRAINT "approval_assignee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "app"."approval_decision" ADD CONSTRAINT "approval_decision_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."approval_request"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "app"."approval_decision" ADD CONSTRAINT "approval_decision_approver_id_user_id_fk" FOREIGN KEY ("approver_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // ── Migration 0025: approval matrix (head stage + tiered finance quorum) ──
  `ALTER TABLE "app"."approval_assignee" ADD COLUMN IF NOT EXISTS "stage" text DEFAULT 'finance' NOT NULL`,
  `ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "required_head_approvals" integer`,
  `ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "required_finance_approvals" integer`,

  // ── Migration 0026: non-admin members of the finance approval pool ──
  `CREATE TABLE IF NOT EXISTS "app"."finance_approver" (
    "user_id" text PRIMARY KEY NOT NULL,
    "added_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    ALTER TABLE "app"."finance_approver" ADD CONSTRAINT "finance_approver_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // ── Migration 0027: Slack status-card message ts ──
  `ALTER TABLE "app"."approval_request" ADD COLUMN IF NOT EXISTS "slack_message_ts" text`,
]

export type SchemaApplyResult = {
  upToDate: boolean
  applied: string[]
  skipped: { stmt: string; error: string }[]
}

/** Run every statement, tolerating individual failures (the FK-to-user
 * permission denials). Used by the boot-time self-heal and by the manual
 * admin endpoint. */
export async function applyApprovalsSchemaStatements(): Promise<SchemaApplyResult> {
  const applied: string[] = []
  const skipped: { stmt: string; error: string }[] = []
  for (const stmt of APPROVALS_SCHEMA_STATEMENTS) {
    const label = stmt.slice(0, 60).replace(/\s+/g, ' ') + '…'
    try {
      await db.execute(sql.raw(stmt))
      applied.push(label)
    } catch (err) {
      skipped.push({ stmt: label, error: (err as Error).message })
    }
  }
  return { upToDate: false, applied, skipped }
}

async function isSchemaCurrent(): Promise<boolean> {
  const probe = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app'
      AND table_name = ${SENTINEL.table}
      AND column_name = ${SENTINEL.column}
    LIMIT 1
  `)
  const rows = probe as unknown as { length?: number; rows?: unknown[] }
  const count = Array.isArray(probe) ? probe.length : (rows.rows?.length ?? rows.length ?? 0)
  return count > 0
}

// Memoized per server instance: the probe runs once per cold start; the
// full statement list only runs when the probe finds the DB behind.
let ensurePromise: Promise<SchemaApplyResult> | null = null

export function ensureApprovalsSchema(): Promise<SchemaApplyResult> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      if (await isSchemaCurrent()) {
        return { upToDate: true, applied: [], skipped: [] } satisfies SchemaApplyResult
      }
      console.log('[approvals-schema] DB behind the code — applying pending schema statements')
      const result = await applyApprovalsSchemaStatements()
      console.log(
        `[approvals-schema] done: ${result.applied.length} applied, ${result.skipped.length} skipped`,
        result.skipped.length > 0 ? result.skipped : '',
      )
      return result
    })().catch((err) => {
      // Never crash the server over this; the next cold start retries.
      ensurePromise = null
      console.error('[approvals-schema] self-heal failed:', err)
      return { upToDate: false, applied: [], skipped: [{ stmt: 'ensure', error: (err as Error).message }] }
    })
  }
  return ensurePromise
}
