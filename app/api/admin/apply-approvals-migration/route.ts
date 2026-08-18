import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/admin/apply-approvals-migration
 *
 * One-shot admin endpoint that applies migration 0023 (approval_request +
 * approval_attachment tables) directly against the connected database.
 * Exists because the operator has no local DB credentials to run
 * `bun run db:migrate` — same pattern as /api/admin/seed-manual-balances.
 *
 * Every statement is idempotent (IF NOT EXISTS / duplicate_object
 * swallowing), so hitting this twice is harmless. NOTE: drizzle's
 * __drizzle_migrations journal is NOT updated here; a future proper
 * `db:migrate` run will re-apply 0023 and no-op for the same reason.
 *
 * Auth: admin:manage_data.
 */
export const maxDuration = 60

const STATEMENTS: string[] = [
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
]

export async function GET(req: Request) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const startedAt = Date.now()
  const applied: string[] = []
  try {
    for (const stmt of STATEMENTS) {
      await db.execute(sql.raw(stmt))
      applied.push(stmt.slice(0, 60).replace(/\s+/g, ' ') + '…')
    }

    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'admin.apply_approvals_migration.succeeded',
      resourceType: 'migration',
      resourceId: '0023_regular_hawkeye',
      metadata: { byEmail: user.email, durationMs: Date.now() - startedAt, statements: applied.length },
    }).catch(() => {})

    return NextResponse.json({
      ok: true,
      statementsApplied: applied.length,
      elapsedMs: Date.now() - startedAt,
      note: 'approval_request + approval_attachment tables are ready. Reload /approvals and submit again.',
    })
  } catch (err) {
    const message = (err as Error).message
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'admin.apply_approvals_migration.failed',
      resourceType: 'migration',
      resourceId: '0023_regular_hawkeye',
      metadata: { byEmail: user.email, error: message, appliedBeforeFailure: applied },
    }).catch(() => {})
    return NextResponse.json({ ok: false, error: message, appliedBeforeFailure: applied }, { status: 500 })
  }
}
