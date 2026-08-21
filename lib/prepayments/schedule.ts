/**
 * Prepayment amortization math + GL reconciliation. Pure functions — no
 * I/O — so the matching rules are unit-testable and identical between any
 * callers.
 *
 * Model: straight-line schedule (total / months, rounding remainder on the
 * last month) starting at startMonth. Reconciliation compares the schedule
 * against the prepaid account's ACTUAL general ledger:
 *   - negative GL rows are amortizations → matched to items by vendor text
 *   - positive GL rows are additions → import candidates when not linked
 */

export type PrepaymentItem = {
  id: string
  vendorName: string
  description: string | null
  totalAmount: number
  startMonth: string   // 'YYYY-MM'
  months: number
  sourceTxnId: string | null
  sourceDate: string | null
}

export type GlRow = {
  date: string                 // 'YYYY-MM-DD'
  txnId: string | null
  name: string | null
  memo: string | null
  amountUsd: number | null
  className: string | null
  transactionType: string | null
  documentNumber: string | null
}

export type CellStatus = 'posted' | 'overdue' | 'mismatch' | 'scheduled'

export type MonthCell = {
  month: string
  scheduled: number
  posted: number
  status: CellStatus
}

export type ItemReconciliation = {
  itemId: string
  cells: MonthCell[]
  postedTotal: number
  remaining: number            // total − posted (what should still sit in the prepaid account)
}

export type Reconciliation = {
  perItem: Map<string, ItemReconciliation>
  months: string[]             // full covered range, ascending
  orphanNegatives: GlRow[]     // amortizations that matched no item
  candidates: GlRow[]          // additions not linked to any item yet
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Straight-line: total/months, remainder on the LAST month so the schedule
 * sums exactly to the total. */
export function monthlySchedule(item: PrepaymentItem): { month: string; amount: number }[] {
  const per = round2(item.totalAmount / item.months)
  const out: { month: string; amount: number }[] = []
  for (let i = 0; i < item.months; i++) {
    const isLast = i === item.months - 1
    out.push({
      month: addMonths(item.startMonth, i),
      amount: isLast ? round2(item.totalAmount - per * (item.months - 1)) : per,
    })
  }
  return out
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Does this GL row's text mention the item's vendor? Every vendor token of
 * length ≥ 3 must appear as a WHOLE word in name+memo (word-boundary match,
 * so "AWS" never matches "JAWS"). Vendors with only short tokens fall back
 * to matching the full normalized name as one word. */
export function rowMatchesVendor(row: GlRow, vendorName: string): boolean {
  const hay = ` ${normalize(`${row.name ?? ''} ${row.memo ?? ''}`)} `
  const tokens = normalize(vendorName).split(' ').filter((t) => t.length >= 3)
  if (tokens.length === 0) {
    const short = normalize(vendorName)
    return short.length > 0 && hay.includes(` ${short} `)
  }
  return tokens.every((t) => hay.includes(` ${t} `))
}

/** True when a positive GL row is already represented by an item — linked by
 * txnId, or same month + same amount + vendor text match. */
function additionIsLinked(row: GlRow, items: PrepaymentItem[]): boolean {
  return items.some((it) => {
    if (it.sourceTxnId && row.txnId && it.sourceTxnId === row.txnId) return true
    const rowMonth = row.date.slice(0, 7)
    const sourceMonth = it.sourceDate?.slice(0, 7) ?? it.startMonth
    return rowMonth === sourceMonth
      && Math.abs((row.amountUsd ?? 0) - it.totalAmount) < 0.01
      && rowMatchesVendor(row, it.vendorName)
  })
}

export function reconcile(
  items: PrepaymentItem[],
  glRows: GlRow[],
  currentMonth: string, // 'YYYY-MM' — months after this render as plain 'scheduled'
): Reconciliation {
  const negatives = glRows.filter((r) => (r.amountUsd ?? 0) < 0)
  const positives = glRows.filter((r) => (r.amountUsd ?? 0) > 0)

  // Assign each negative row to at most ONE item: the matching item whose
  // vendor text is longest (most specific) — prevents "Orca" swallowing
  // "Orca Security" rows.
  const rowAssignment = new Map<GlRow, string>()
  for (const row of negatives) {
    let best: PrepaymentItem | null = null
    for (const it of items) {
      if (!rowMatchesVendor(row, it.vendorName)) continue
      if (!best || it.vendorName.length > best.vendorName.length) best = it
    }
    if (best) rowAssignment.set(row, best.id)
  }

  const perItem = new Map<string, ItemReconciliation>()
  const allMonths = new Set<string>()

  for (const it of items) {
    const schedule = monthlySchedule(it)
    const scheduledByMonth = new Map(schedule.map((s) => [s.month, s.amount]))

    // Posted per month for this item = |sum of assigned negatives| that month.
    const postedByMonth = new Map<string, number>()
    for (const [row, itemId] of rowAssignment) {
      if (itemId !== it.id) continue
      const m = row.date.slice(0, 7)
      postedByMonth.set(m, round2((postedByMonth.get(m) ?? 0) + Math.abs(row.amountUsd ?? 0)))
    }

    const months = [...new Set([...scheduledByMonth.keys(), ...postedByMonth.keys()])].sort()
    const cells: MonthCell[] = months.map((month) => {
      const scheduled = scheduledByMonth.get(month) ?? 0
      const posted = postedByMonth.get(month) ?? 0
      let status: CellStatus
      if (month > currentMonth && posted === 0) status = 'scheduled'
      else if (Math.abs(posted - scheduled) < 0.01) status = 'posted'
      else if (posted === 0) status = 'overdue'
      else status = 'mismatch'
      return { month, scheduled, posted, status }
    })
    for (const m of months) allMonths.add(m)

    const postedTotal = round2([...postedByMonth.values()].reduce((s, v) => s + v, 0))
    perItem.set(it.id, {
      itemId: it.id,
      cells,
      postedTotal,
      remaining: round2(it.totalAmount - postedTotal),
    })
  }

  return {
    perItem,
    months: [...allMonths].sort(),
    orphanNegatives: negatives.filter((r) => !rowAssignment.has(r)),
    candidates: positives.filter((r) => !additionIsLinked(r, items)),
  }
}
