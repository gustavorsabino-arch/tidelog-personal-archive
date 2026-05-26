import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { qbForceRefreshRun } from '@/lib/db/schema/quickbooks'

/**
 * Earliest month we accept as a --from boundary. Matches HISTORY_START_YEAR
 * in lib/cron/fetch-qb-reports.ts (we don't fetch reports from before this).
 */
export const FORCE_REFRESH_HISTORY_START = '2026-01'

/**
 * A force run that outlives this timeout without a terminal state is
 * assumed dead (function killed mid-execution, deploy restart, etc.). The
 * next POST reclaims it so the lock doesn't block forever.
 */
export const FORCE_REFRESH_STALE_MS = 15 * 60 * 1000

const FROM_RE = /^(\d{4})-(\d{2})$/

export type ParseFromPeriodResult =
  | { ok: true; value: string }
  | { ok: false; error: string }

export function parseFromPeriod(value: unknown): ParseFromPeriodResult {
  if (typeof value !== 'string') {
    return { ok: false, error: 'from must be a string' }
  }
  const match = FROM_RE.exec(value)
  if (!match) {
    return { ok: false, error: `from must be YYYY-MM (got: ${value})` }
  }
  const month = Number(match[2])
  if (month < 1 || month > 12) {
    return { ok: false, error: `from month must be 01-12 (got: ${value})` }
  }
  if (value < FORCE_REFRESH_HISTORY_START) {
    return { ok: false, error: `from must be >= ${FORCE_REFRESH_HISTORY_START} (got: ${value})` }
  }
  return { ok: true, value }
}

export type ForceRefreshStatus = 'running' | 'succeeded' | 'failed' | 'canceled'

export type ForceRefreshRun = {
  id: string
  startedAt: Date
  finishedAt: Date | null
  fromPeriod: string
  status: ForceRefreshStatus
  requestedByEmail: string
  error: string | null
  result: unknown
  durationMs: number | null
}

function rowToRun(row: typeof qbForceRefreshRun.$inferSelect): ForceRefreshRun {
  const durationMs = row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null
  return {
    id: row.id,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    fromPeriod: row.fromPeriod,
    status: row.status as ForceRefreshStatus,
    requestedByEmail: row.requestedByEmail,
    error: row.error,
    result: row.result,
    durationMs,
  }
}

export type CreateForceRunResult =
  | { ok: true; run: ForceRefreshRun }
  | { ok: false; reason: 'already_running'; existing: ForceRefreshRun }

/**
 * Insert a new force-refresh row as 'running'. Enforced by a partial unique
 * index; on conflict, returns the blocking row so the caller can 409.
 *
 * Before attempting the insert, we sweep stale rows older than
 * FORCE_REFRESH_STALE_MS, in case a previous run's function was killed
 * before it could transition out of 'running'.
 */
export async function createForceRun(input: {
  fromPeriod: string
  requestedByEmail: string
}): Promise<CreateForceRunResult> {
  const staleCutoff = new Date(Date.now() - FORCE_REFRESH_STALE_MS)
  await db
    .update(qbForceRefreshRun)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      error: 'timed out (function killed before completion)',
    })
    .where(and(
      eq(qbForceRefreshRun.status, 'running'),
      lt(qbForceRefreshRun.startedAt, staleCutoff),
    ))

  try {
    const [inserted] = await db
      .insert(qbForceRefreshRun)
      .values({
        fromPeriod: input.fromPeriod,
        status: 'running',
        requestedByEmail: input.requestedByEmail,
      })
      .returning()
    return { ok: true, run: rowToRun(inserted) }
  } catch (err) {
    const message = (err as Error).message
    const pgCode = (err as { code?: string }).code
    if (pgCode === '23505' || message.includes('qb_force_refresh_run_one_running_idx')) {
      const [existing] = await db
        .select()
        .from(qbForceRefreshRun)
        .where(eq(qbForceRefreshRun.status, 'running'))
        .limit(1)
      if (existing) {
        return { ok: false, reason: 'already_running', existing: rowToRun(existing) }
      }
    }
    throw err
  }
}

/**
 * Transition to 'succeeded' only if still 'running'. A concurrent cancel
 * may have moved the row to 'canceled' — in that case we leave it as-is.
 */
export async function completeForceRun(runId: string, result: unknown): Promise<void> {
  await db
    .update(qbForceRefreshRun)
    .set({ status: 'succeeded', finishedAt: new Date(), result: result as any })
    .where(and(eq(qbForceRefreshRun.id, runId), eq(qbForceRefreshRun.status, 'running')))
}

/**
 * Persist progress for one entity into the run's `result.entities` map.
 * Called after each entity finishes (including reconcile) so partial progress
 * is visible/recoverable even if the function dies before completing all
 * entities or before completeForceRun lands.
 */
export async function updateForceRunEntityProgress(
  runId: string,
  entityId: string,
  entityResult: unknown,
): Promise<void> {
  const [current] = await db
    .select({ result: qbForceRefreshRun.result })
    .from(qbForceRefreshRun)
    .where(eq(qbForceRefreshRun.id, runId))
    .limit(1)
  if (!current) return
  const base = (current.result as Record<string, unknown> | null) ?? {}
  const entities = { ...((base.entities as Record<string, unknown> | undefined) ?? {}) }
  entities[entityId] = entityResult
  await db
    .update(qbForceRefreshRun)
    .set({ result: { ...base, entities } as any })
    .where(and(eq(qbForceRefreshRun.id, runId), eq(qbForceRefreshRun.status, 'running')))
}

/**
 * Transition to 'failed' only if still 'running'. If a concurrent cancel
 * moved the row to 'canceled', keep that state — the user's intent wins.
 */
export async function failForceRun(runId: string, error: string): Promise<void> {
  await db
    .update(qbForceRefreshRun)
    .set({ status: 'failed', finishedAt: new Date(), error })
    .where(and(eq(qbForceRefreshRun.id, runId), eq(qbForceRefreshRun.status, 'running')))
}

export async function listRecentForceRuns(limit = 20): Promise<ForceRefreshRun[]> {
  // Sweep stale 'running' rows before returning. Without this, a run whose
  // function was killed by Vercel before it could call completeForceRun
  // would sit at status='running' until the next POST triggered the sweep
  // inside createForceRun. Calling the same sweep here makes the admin page
  // self-heal on load.
  const staleCutoff = new Date(Date.now() - FORCE_REFRESH_STALE_MS)
  await db
    .update(qbForceRefreshRun)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      error: 'timed out (function killed before completion)',
    })
    .where(and(
      eq(qbForceRefreshRun.status, 'running'),
      lt(qbForceRefreshRun.startedAt, staleCutoff),
    ))

  const rows = await db
    .select()
    .from(qbForceRefreshRun)
    .orderBy(desc(qbForceRefreshRun.startedAt))
    .limit(limit)
  return rows.map(rowToRun)
}

export type CancelForceRunResult =
  | { ok: true; run: ForceRefreshRun }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_running'; run: ForceRefreshRun }
  | { ok: false; reason: 'not_owner'; run: ForceRefreshRun }

/**
 * Mark a running force run as canceled. Only the user who started the run
 * can cancel it. The background job checks for this state at natural
 * break points (between specs) and exits early when it sees 'canceled'.
 */
export async function cancelForceRun(input: {
  runId: string
  requesterEmail: string
}): Promise<CancelForceRunResult> {
  const [row] = await db
    .select()
    .from(qbForceRefreshRun)
    .where(eq(qbForceRefreshRun.id, input.runId))
    .limit(1)

  if (!row) return { ok: false, reason: 'not_found' }
  if (row.status !== 'running') return { ok: false, reason: 'not_running', run: rowToRun(row) }
  if (row.requestedByEmail !== input.requesterEmail) {
    return { ok: false, reason: 'not_owner', run: rowToRun(row) }
  }

  const [updated] = await db
    .update(qbForceRefreshRun)
    .set({
      status: 'canceled',
      finishedAt: new Date(),
      error: `Canceled by ${input.requesterEmail}`,
    })
    .where(and(
      eq(qbForceRefreshRun.id, input.runId),
      eq(qbForceRefreshRun.status, 'running'),
    ))
    .returning()

  if (!updated) {
    // Someone else transitioned it between our read and update. Re-read.
    const [re] = await db
      .select()
      .from(qbForceRefreshRun)
      .where(eq(qbForceRefreshRun.id, input.runId))
      .limit(1)
    if (!re) return { ok: false, reason: 'not_found' }
    return { ok: false, reason: 'not_running', run: rowToRun(re) }
  }

  return { ok: true, run: rowToRun(updated) }
}

/**
 * Returns true if the run was canceled by the user. Called by
 * fetchQbReportsJob between specs to allow early exit.
 */
export async function isRunCanceled(runId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: qbForceRefreshRun.status })
    .from(qbForceRefreshRun)
    .where(eq(qbForceRefreshRun.id, runId))
    .limit(1)
  return row?.status === 'canceled'
}
