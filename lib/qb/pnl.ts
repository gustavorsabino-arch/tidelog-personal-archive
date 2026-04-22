type QbColData = { value?: string; id?: string }

type QbRow = {
  type?: string
  ColData?: QbColData[]
  Header?: { ColData?: QbColData[] }
  Summary?: { ColData?: QbColData[] }
  Rows?: { Row?: QbRow[] }
}

export type PnlAccount = {
  kind: 'account'
  label: string
  glCode: string | null
  amount: number
}

export type PnlSection = {
  kind: 'section'
  title: string
  total: number
  sectionKind: 'income' | 'expense' | 'other-income' | 'other-expense' | 'other'
  children: Array<PnlSection | PnlAccount>
}

export type PnlTree = {
  sections: PnlSection[]
  totals: {
    revenue: number
    expense: number
    otherIncome: number
    otherExpense: number
    netIncome: number
  }
}

export type QboProfitAndLossReport = {
  Rows?: { Row?: QbRow[] }
}

const GL_CODE_RE = /^(\d{4,})/

function toNumber(raw: unknown): number {
  if (raw == null) return 0
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  return Number.isFinite(n) ? n : 0
}

function classifySection(title: string): PnlSection['sectionKind'] {
  const t = title.toLowerCase()
  if (/other income/.test(t)) return 'other-income'
  if (/other expense/.test(t)) return 'other-expense'
  if (/^income|^revenue/.test(t)) return 'income'
  if (/expense/.test(t)) return 'expense'
  return 'other'
}

function parseSection(row: QbRow): PnlSection {
  const title = row.Header?.ColData?.[0]?.value?.trim() ?? ''
  const children: Array<PnlSection | PnlAccount> = []

  for (const child of row.Rows?.Row ?? []) {
    if (child.type === 'Section') {
      children.push(parseSection(child))
      continue
    }
    if (child.type === 'Data' && child.ColData) {
      const label = child.ColData[0]?.value?.trim() ?? ''
      if (!label || label === 'Net Income') continue
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

  const total = toNumber(row.Summary?.ColData?.[1]?.value)
  return { kind: 'section', title, total, sectionKind: classifySection(title), children }
}

/**
 * Parse a QB ProfitAndLoss report response into a semantic tree.
 * The raw response has a nested Section/Data structure where section totals
 * live on a sibling `Summary` object; this flattens that into something a
 * React component can render without further walking.
 */
export function parsePnlReport(report: QboProfitAndLossReport): PnlTree {
  const allRows = report?.Rows?.Row ?? []
  const allSections = allRows.filter((r): r is QbRow => r.type === 'Section').map(parseSection)

  const namedSections = allSections.filter((s) => s.title.length > 0)

  const revenue = namedSections.filter((s) => s.sectionKind === 'income').reduce((a, s) => a + s.total, 0)
  const expense = namedSections.filter((s) => s.sectionKind === 'expense').reduce((a, s) => a + s.total, 0)
  const otherIncome = namedSections.filter((s) => s.sectionKind === 'other-income').reduce((a, s) => a + s.total, 0)
  const otherExpense = namedSections.filter((s) => s.sectionKind === 'other-expense').reduce((a, s) => a + s.total, 0)

  // QB emits a final unnamed section whose Summary is Net Income. Fall back to
  // (revenue + otherIncome) - (|expense| + |otherExpense|) if absent.
  const trailingUnnamed = allSections.filter((s) => s.title === '')
  const qbNetIncome = trailingUnnamed.length > 0
    ? trailingUnnamed[trailingUnnamed.length - 1].total
    : 0
  const netIncome = qbNetIncome !== 0
    ? qbNetIncome
    : revenue + otherIncome - Math.abs(expense) - Math.abs(otherExpense)

  return {
    sections: namedSections,
    totals: { revenue, expense, otherIncome, otherExpense, netIncome },
  }
}

function accountKey(node: PnlAccount): string {
  return node.glCode ? `glCode:${node.glCode}` : `label:${node.label}`
}

function sectionKey(node: PnlSection): string {
  return `${node.sectionKind}:${node.title}`
}

function mergeChildren(
  a: ReadonlyArray<PnlSection | PnlAccount>,
  b: ReadonlyArray<PnlSection | PnlAccount>,
): Array<PnlSection | PnlAccount> {
  const byKey = new Map<string, PnlSection | PnlAccount>()
  const order: string[] = []
  for (const node of [...a, ...b]) {
    const key = node.kind === 'account' ? `a:${accountKey(node)}` : `s:${sectionKey(node)}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, node.kind === 'account' ? { ...node } : { ...node, children: [...node.children] })
      order.push(key)
      continue
    }
    if (existing.kind === 'account' && node.kind === 'account') {
      existing.amount += node.amount
    } else if (existing.kind === 'section' && node.kind === 'section') {
      existing.total += node.total
      existing.children = mergeChildren(existing.children, node.children)
    }
  }
  return order.map((k) => byKey.get(k)!)
}

function mergeSections(a: ReadonlyArray<PnlSection>, b: ReadonlyArray<PnlSection>): PnlSection[] {
  const byKey = new Map<string, PnlSection>()
  const order: string[] = []
  for (const section of [...a, ...b]) {
    const key = sectionKey(section)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...section, children: [...section.children] })
      order.push(key)
      continue
    }
    existing.total += section.total
    existing.children = mergeChildren(existing.children, section.children)
  }
  return order.map((k) => byKey.get(k)!)
}

/**
 * Sum a list of PnL trees (one per cached month) into a single tree. The cron
 * caches one P&L row per calendar month; range views (e.g. YTD) merge those
 * monthly trees rather than issuing live QB calls.
 */
export function mergePnlTrees(trees: readonly PnlTree[]): PnlTree {
  if (trees.length === 0) {
    return {
      sections: [],
      totals: { revenue: 0, expense: 0, otherIncome: 0, otherExpense: 0, netIncome: 0 },
    }
  }

  let sections: PnlSection[] = []
  const totals = { revenue: 0, expense: 0, otherIncome: 0, otherExpense: 0, netIncome: 0 }
  for (const tree of trees) {
    sections = mergeSections(sections, tree.sections)
    totals.revenue += tree.totals.revenue
    totals.expense += tree.totals.expense
    totals.otherIncome += tree.totals.otherIncome
    totals.otherExpense += tree.totals.otherExpense
    totals.netIncome += tree.totals.netIncome
  }

  return { sections, totals }
}
