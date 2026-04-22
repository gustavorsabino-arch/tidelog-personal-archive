type QbColData = { value?: string; id?: string }

type QbRow = {
  type?: string
  ColData?: QbColData[]
  Header?: { ColData?: QbColData[] }
  Summary?: { ColData?: QbColData[] }
  Rows?: { Row?: QbRow[] }
}

export type BsAccount = {
  kind: 'account'
  label: string
  glCode: string | null
  amount: number
}

export type BsSection = {
  kind: 'section'
  title: string
  total: number
  children: Array<BsSection | BsAccount>
}

export type BsTree = {
  sections: BsSection[]
  totals: {
    assets: number
    liabilities: number
    equity: number
  }
}

export type QboBalanceSheetReport = {
  Rows?: { Row?: QbRow[] }
}

const GL_CODE_RE = /^(\d{4,})/

function toNumber(raw: unknown): number {
  if (raw == null) return 0
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  return Number.isFinite(n) ? n : 0
}

function parseSection(row: QbRow): BsSection {
  const title = row.Header?.ColData?.[0]?.value?.trim() ?? ''
  const children: Array<BsSection | BsAccount> = []

  for (const child of row.Rows?.Row ?? []) {
    if (child.type === 'Section') {
      children.push(parseSection(child))
      continue
    }
    if (child.type === 'Data' && child.ColData) {
      const label = child.ColData[0]?.value?.trim() ?? ''
      if (!label) continue
      const amount = toNumber(child.ColData[1]?.value)
      const match = label.match(GL_CODE_RE)
      children.push({
        kind: 'account',
        label,
        glCode: match ? match[1] : null,
        amount,
      })
    }
  }

  return { kind: 'section', title, total: toNumber(row.Summary?.ColData?.[1]?.value), children }
}

function classifySection(title: string): 'assets' | 'liabilities' | 'equity' | 'other' {
  const t = title.toLowerCase()
  if (/asset/.test(t)) return 'assets'
  if (/liabilit/.test(t)) return 'liabilities'
  if (/equity/.test(t)) return 'equity'
  return 'other'
}

/**
 * Parse a QB BalanceSheet response into a semantic tree.
 * QB returns three top-level sections: Assets, Liabilities, Equity
 * (sometimes combined into nested summary blocks). We flatten and classify.
 */
export function parseBsReport(report: QboBalanceSheetReport): BsTree {
  const allRows = report?.Rows?.Row ?? []
  const sections = allRows.filter((r): r is QbRow => r.type === 'Section').map(parseSection)

  const named = sections.filter((s) => s.title.length > 0)
  const totals = { assets: 0, liabilities: 0, equity: 0 }
  for (const section of named) {
    const kind = classifySection(section.title)
    if (kind === 'other') continue
    totals[kind] += section.total
  }

  return { sections: named, totals }
}
