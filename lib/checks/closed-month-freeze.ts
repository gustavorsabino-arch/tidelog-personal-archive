import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { qbReportCache, qbConnection } from '@/lib/db/schema'
import { parseQboGeneralLedgerRows } from '@/lib/budget/qb-general-ledger'

/**
 * Check 2.1 — Closed months frozen empty.
 *
 * Closed-month QB report rows are cached forever (lib/cron/fetch-qb-reports.ts).
 * The retroactive-booking self-heal only re-verifies an empty closed-month GL
 * whose period ended within EMPTY_GL_RECHECK_WINDOW_MS (60 days). Orca books
 * weeks-to-months late, so any month booked to QB after that window keeps
 * serving an empty GL forever — and every downstream reader (budget actuals,
 * P&L, coverage, variance) trusts it silently.
 *
 * This is the Phase-A diagnostic: cache-only, NO QuickBooks calls. It scans
 * qb_report_cache for closed months whose entire general_ledger cache parses to
 * ZERO lines, and flags the ones the self-heal can never reach
 * (selfHealReachable=false) as the dangerous, permanently-frozen set.
 *
 * Limitation (intentional, for the next layer): this catches only FULLY-empty
 * months. A month cached mid-booking with SOME but not all transactions reads
 * as non-empty and is not flagged here — catching those needs a per-month count
 * comparison against QuickBooks' own count.
 */

// Mirrors EMPTY_GL_RECHECK_WINDOW_MS in lib/cron/fetch-qb-reports.ts. Kept in
// sync by hand — if the cron window changes, change this too.
const SELF_HEAL_WINDOW_DAYS = 60
const DAY_MS = 24 * 60 * 60 * 1000

export type FrozenMonthFinding = {
  entityId: string
  periodStart: string
  periodEnd: string
  /** How many (account, month) GL rows are cached for this month. */
  glAccountRowsCached: number
  /** Total parsed GL lines across those rows. 0 here means frozen-empty. */
  cachedGlLineCount: number
  monthEndAgeDays: number
  /** false = outside the 60-day self-heal window → will never re-verify itself. */
  selfHealReachable: boolean
  oldestFetchedAt: string
}

export type FrozenMonthReport = {
  generatedAt: string
  totalFrozenMonths: number
  /** The dangerous subset: frozen-empty AND beyond the self-heal window. */
  frozenBeyondSelfHeal: number
  findings: FrozenMonthFinding[]
}

export async function findFrozenClosedMonths(now: Date = new Date()): Promise<FrozenMonthReport> {
  const conns = await db.select({ entityId: qbConnection.entityId }).from(qbConnection)
  const firstOfCurrentMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const findings: FrozenMonthFinding[] = []

  for (const { entityId } of conns) {
    const rows = await db
      .select({
        periodStart: qbReportCache.periodStart,
        periodEnd: qbReportCache.periodEnd,
        data: qbReportCache.data,
        fetchedAt: qbReportCache.fetchedAt,
      })
      .from(qbReportCache)
      .where(and(
        eq(qbReportCache.entityId, entityId),
        eq(qbReportCache.reportType, 'general_ledger'),
      ))

    // Aggregate the per-account GL rows up to one entry per month.
    type MonthAgg = { periodStart: string; periodEnd: string; lineCount: number; rowCount: number; oldest: Date }
    const byMonth = new Map<string, MonthAgg>()
    for (const r of rows) {
      const key = `${r.periodStart}..${r.periodEnd}`
      let lines = 0
      try {
        lines = parseQboGeneralLedgerRows(r.data as never).length
      } catch {
        // Unparseable row: treat as 0 lines so it counts toward "empty" rather
        // than masking an empty month as if it had data.
        lines = 0
      }
      const cur = byMonth.get(key)
        ?? { periodStart: r.periodStart, periodEnd: r.periodEnd, lineCount: 0, rowCount: 0, oldest: r.fetchedAt }
      cur.lineCount += lines
      cur.rowCount += 1
      if (r.fetchedAt < cur.oldest) cur.oldest = r.fetchedAt
      byMonth.set(key, cur)
    }

    for (const m of byMonth.values()) {
      const monthEndMs = Date.parse(`${m.periodEnd}T23:59:59Z`)
      if (!Number.isFinite(monthEndMs)) continue
      const isClosed = monthEndMs < firstOfCurrentMonth
      if (!isClosed) continue          // current / future month — not frozen
      if (m.lineCount > 0) continue     // has data — not frozen-empty (partials: next layer)

      const monthEndAgeDays = Math.floor((now.getTime() - monthEndMs) / DAY_MS)
      findings.push({
        entityId,
        periodStart: m.periodStart,
        periodEnd: m.periodEnd,
        glAccountRowsCached: m.rowCount,
        cachedGlLineCount: 0,
        monthEndAgeDays,
        selfHealReachable: monthEndAgeDays < SELF_HEAL_WINDOW_DAYS,
        oldestFetchedAt: m.oldest.toISOString(),
      })
    }
  }

  // Most dangerous first: unreachable by self-heal, then oldest month.
  findings.sort((a, b) =>
    Number(a.selfHealReachable) - Number(b.selfHealReachable)
    || b.monthEndAgeDays - a.monthEndAgeDays,
  )

  return {
    generatedAt: now.toISOString(),
    totalFrozenMonths: findings.length,
    frozenBeyondSelfHeal: findings.filter((f) => !f.selfHealReachable).length,
    findings,
  }
}
