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
  // The ledger rows that produced `posted` — surfaced in the UI tooltip so
  // any surprising number explains itself.
  postedRows: { date: string; memo: string | null; amount: number }[]
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

// Generic words that appear in almost every 14000 memo — useless as
// discriminators when matching by description tokens.
const GENERIC_MEMO_TOKENS = new Set([
  'total', 'prepaid', 'monthly', 'services', 'service', 'invoice', 'transfer',
  'mercury', 'opco', 'withdrawal', 'usdc', 'inc', 'labs', 'llc', 'ltd',
])

/** Does this GL row belong to the item? Two signals, either suffices:
 *  1. the vendor name appears in the row text (whole-word tokens), or
 *  2. the item's DESCRIPTION shares distinctive tokens with the row memo —
 *     needed because many QB entries carry only a tx-hash memo (identical
 *     on the addition and every amortization) and no vendor text at all.
 *     One long token (≥10 chars, e.g. a hash) or two medium ones (≥5) count. */
export function itemMatchesRow(
  item: { vendorName: string; description: string | null },
  row: GlRow,
): boolean {
  if (rowMatchesVendor(row, item.vendorName)) return true
  if (!item.description) return false
  const hay = ` ${normalize(`${row.name ?? ''} ${row.memo ?? ''}`)} `
  const tokens = normalize(item.description)
    .split(' ')
    .filter((t) => t.length >= 5 && !GENERIC_MEMO_TOKENS.has(t) && !/^\d{1,4}$/.test(t))
  const hits = tokens.filter((t) => hay.includes(` ${t} `))
  return hits.some((t) => t.length >= 10) || hits.length >= 2
}

/** True when a positive GL row is already represented by an item — linked by
 * txnId, or same month + same amount + vendor/description match. */
function additionIsLinked(row: GlRow, items: PrepaymentItem[]): boolean {
  return items.some((it) => {
    if (it.sourceTxnId && row.txnId && it.sourceTxnId === row.txnId) return true
    const rowMonth = row.date.slice(0, 7)
    const sourceMonth = it.sourceDate?.slice(0, 7) ?? it.startMonth
    return rowMonth === sourceMonth
      && Math.abs((row.amountUsd ?? 0) - it.totalAmount) < 0.02
      && itemMatchesRow(it, row)
  })
}

/** Loose money parser for QB memo text — formats seen in real data:
 * "$15,500.00", "$ 43.347,48", "$5.350.00" (dots only, 2-digit tail),
 * "$ 23.040.00". */
export function parseMemoMoney(raw: string): number | null {
  const s = raw.replace(/[$\s]/g, '')
  if (!/\d/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let normalized: string
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastDot > lastComma
      ? s.replace(/,/g, '')
      : s.replace(/\./g, '').replace(',', '.')
  } else if (lastComma >= 0) {
    const tail = s.length - lastComma - 1
    normalized = tail === 2 && (s.match(/,/g) ?? []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (lastDot >= 0) {
    const dots = (s.match(/\./g) ?? []).length
    const tail = s.length - lastDot - 1
    if (dots > 1) {
      // "5.350.00" → last dot is the decimal when the tail has 2 digits;
      // "12.345.678" → all thousands.
      normalized = tail === 2
        ? s.slice(0, lastDot).replace(/\./g, '') + '.' + s.slice(lastDot + 1)
        : s.replace(/\./g, '')
    } else {
      normalized = tail === 3 && s.length > 4 ? s.replace(/\./g, '') : s
    }
  } else {
    normalized = s
  }
  const n = parseFloat(normalized)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

export type AdditionSuggestion = {
  vendorGuess: string | null
  contractTotal: number | null   // from "Total $X" in the memo, when present
  months: number                 // remaining months to amortize the prepaid
  monthlyAmount: number
  startMonth: string             // month after the addition
}

/**
 * Derive registration terms from a prepaid ADDITION row, per finance's
 * booking convention: the original JE expenses the first month directly
 * and parks the remainder in 14000, so:
 *   contract total (memo "Total $X") − prepaid = one month
 *   → term n = total / (total − prepaid); prepaid amortizes over n−1 months.
 * Without a usable memo total, assume a 12-month contract (prepaid = 11
 * months). Always a DRAFT for the human to confirm.
 */
export function suggestFromAddition(row: GlRow): AdditionSuggestion {
  const memo = row.memo ?? ''
  const prepaid = Math.abs(row.amountUsd ?? 0)

  // Vendor guess: explicit name field, else memo patterns.
  let vendorGuess: string | null = row.name?.trim() || null
  if (!vendorGuess) {
    const mercury = memo.match(/Mercury CC Transfer to Opco\s*-\s*([^-\n]+?)\s*(?:-|$)/i)
    if (mercury) vendorGuess = mercury[1].trim()
  }
  if (!vendorGuess && !/^out\b/i.test(memo)) {
    // "May-2026 - CoinGecko - Total ..." → the segment before " - Total".
    const beforeTotal = memo.match(/(?:^|-\s*)([A-Za-z][^-\n]{2,40}?)\s*-\s*Total/i)
    if (beforeTotal) vendorGuess = beforeTotal[1].trim()
  }
  if (vendorGuess && /^\d{4}-\d{2}/.test(vendorGuess)) vendorGuess = null

  const totalMatch = memo.match(/total\s*[-–—]?\s*\$?\s*([\d.,][\d.,\s]*)/i)
  const contractTotal = totalMatch ? parseMemoMoney(totalMatch[1]) : null

  let months = 11
  let monthlyAmount = Math.round((prepaid / 11) * 100) / 100
  if (contractTotal && contractTotal > prepaid + 0.01) {
    const firstMonth = contractTotal - prepaid
    const n = Math.round(contractTotal / firstMonth)
    if (n >= 2 && n <= 36) {
      const monthly = Math.round((contractTotal / n) * 100) / 100
      const remaining = Math.max(1, Math.round(prepaid / monthly))
      months = remaining
      monthlyAmount = monthly
    }
  }

  return {
    vendorGuess,
    contractTotal,
    months,
    monthlyAmount,
    startMonth: addMonths(row.date.slice(0, 7), 1),
  }
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
    const rowMonth = row.date.slice(0, 7)
    let best: PrepaymentItem | null = null
    for (const it of items) {
      // An amortization can only belong to a contract FROM its start month
      // on (allowing a couple of trailing months for late bookings) — the
      // previous year's contract for the same vendor amortizes the same
      // monthly amount with near-identical memos, and without this window
      // its rows would light up the NEW contract as mismatches.
      if (rowMonth < it.startMonth) continue
      if (rowMonth > addMonths(it.startMonth, it.months + 2)) continue
      if (!itemMatchesRow(it, row)) continue
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
    const rowsByMonth = new Map<string, { date: string; memo: string | null; amount: number }[]>()
    for (const [row, itemId] of rowAssignment) {
      if (itemId !== it.id) continue
      const m = row.date.slice(0, 7)
      postedByMonth.set(m, round2((postedByMonth.get(m) ?? 0) + Math.abs(row.amountUsd ?? 0)))
      rowsByMonth.set(m, [
        ...(rowsByMonth.get(m) ?? []),
        { date: row.date, memo: row.memo ?? row.name, amount: row.amountUsd ?? 0 },
      ])
    }

    const months = [...new Set([...scheduledByMonth.keys(), ...postedByMonth.keys()])].sort()
    const cells: MonthCell[] = months.map((month) => {
      const scheduled = scheduledByMonth.get(month) ?? 0
      const posted = postedByMonth.get(month) ?? 0
      const postedRows = rowsByMonth.get(month) ?? []
      let status: CellStatus
      if (month > currentMonth && posted === 0) status = 'scheduled'
      else if (Math.abs(posted - scheduled) <= 0.02) status = 'posted' // 2¢ rounding tolerance
      else if (posted === 0) status = 'overdue'
      else status = 'mismatch'
      return { month, scheduled, posted, status, postedRows }
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
