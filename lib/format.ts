/** Number and date formatters — matches v1 formatting exactly */

export function fmtUSD(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return '$—'
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function pctOf(value: number, total: number): string {
  if (!total) return '0.0'
  return ((value / total) * 100).toFixed(1)
}

/**
 * Spot price ($/token) formatter. Thousands separators, adaptive precision,
 * rounded display. e-notation only for the genuinely tiny (< $0.001) where a
 * plain decimal would be a long string of leading zeros. Zero/null → em dash.
 */
export function fmtPrice(n: number | null | undefined): string {
  if (n == null || isNaN(n) || n === 0) return '—'
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1000) return sign + '$' + a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (a >= 0.001) return sign + '$' + a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
  return sign + '$' + a.toExponential(2)
}

export function fmtAddr(addr: string, chars = 4): string {
  if (!addr || addr.length < chars * 2 + 2) return addr || '—'
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`
}

export const MONTH_SHORT_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

export type DateRange = { from: string; to: string }

export function monthToRange(monthKey: string): DateRange | null {
  if (!monthKey) return null
  const [yearStr, monthStr] = monthKey.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null
  const start = Date.UTC(year, month - 1, 1, 0, 0, 0)
  const end = Date.UTC(year, month, 1, 0, 0, 0)
  return {
    from: String(Math.floor(start / 1000)),
    to: String(Math.floor(end / 1000) - 1),
  }
}

export function yearToRange(yearKey: string): DateRange | null {
  if (!yearKey) return null
  const year = Number(yearKey)
  if (!Number.isFinite(year)) return null
  const start = Date.UTC(year, 0, 1, 0, 0, 0)
  const end = Date.UTC(year + 1, 0, 1, 0, 0, 0)
  return {
    from: String(Math.floor(start / 1000)),
    to: String(Math.floor(end / 1000) - 1),
  }
}

/**
 * Group ["YYYY-MM", ...] (any order) into { years: desc-sorted unique years,
 * byYear: map of year → desc-sorted "MM" months present that year }.
 */
export function groupMonthsByYear(months: string[]): {
  years: string[]
  byYear: Record<string, string[]>
} {
  const byYear: Record<string, Set<string>> = {}
  for (const ym of months) {
    const [y, m] = ym.split('-')
    if (!y || !m) continue
    if (!byYear[y]) byYear[y] = new Set()
    byYear[y].add(m)
  }
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a))
  const sorted: Record<string, string[]> = {}
  for (const y of years) {
    sorted[y] = [...byYear[y]].sort((a, b) => b.localeCompare(a))
  }
  return { years, byYear: sorted }
}
