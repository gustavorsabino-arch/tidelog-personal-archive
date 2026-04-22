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

export function fmtAddr(addr: string, chars = 4): string {
  if (!addr || addr.length < chars * 2 + 2) return addr || '—'
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`
}
