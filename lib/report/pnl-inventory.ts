import type { PnlAccount, PnlSection, PnlTree } from '@/lib/qb/pnl'

/** Management groups are independent of QB's four signed P&L sections. */
export const PNL_GROUPS = {
  'protocol-revenue': 'Protocol & product revenue',
  'managed-services': 'Managed services & intercompany revenue',
  'treasury-income': 'Treasury & investment income',
  'asset-gains': 'Digital asset gains and losses',
  'other-income': 'Other income',
  'employee-cash': 'Employee cash compensation',
  'employee-token': 'Employee token compensation',
  'contractor-cash': 'Contractor cash compensation',
  'contractor-token': 'Contractor token compensation',
  'benefits-severance': 'Benefits, insurance & severance',
  'software': 'Software & SaaS',
  'infrastructure': 'Hosting, blockchain & security',
  'tech-audits': 'Smart contract audits',
  'professional': 'Professional services & governance',
  'people-operations': 'HR & recruiting',
  'travel': 'Travel & entertainment',
  'offsite': 'Company offsite',
  'marketing': 'Marketing & incentives',
  'transaction-fees': 'Transaction & treasury fees',
  'office': 'Office & hardware',
  'intercompany': 'Intercompany charges',
  'other-operating': 'Other operating expenses',
  'financing': 'Interest & financing',
  'other-nonoperating': 'Other non-operating expense',
  'depreciation': 'Depreciation',
  'taxes': 'Company taxes',
  'reconciliation': 'Reconciliation discrepancies',
  'unclassified': 'Unclassified QB accounts',
} as const

export type PnlGroup = keyof typeof PNL_GROUPS
export type PnlKind = PnlSection['sectionKind']

// Explicit inventory of account numbers observed in the January–August 2026
// monthly QuickBooks P&Ls. Unknown/new accounts remain visible and fail audit
// classification instead of disappearing from a slide.
const ACCOUNT_GROUPS: Record<string, PnlGroup> = (() => {
  const groups: Record<string, PnlGroup> = {}
  for (const [group, codes] of Object.entries({
    'protocol-revenue': '40110 40905',
    'managed-services': '40001 40102',
    'treasury-income': '70110 70140 71020 70002',
    'asset-gains': '70003 70004 70005 70150 70510 73001',
    'other-income': '70001 70009 70015 71010 71099',
    'employee-cash': '60110 60120 60130 60150',
    'employee-token': '60210 60220',
    'contractor-cash': '60310 60320 60330 60340',
    'contractor-token': '60410',
    'benefits-severance': '60160 60350 60520 60610 60650',
    software: '61010 61020',
    infrastructure: '61110 61120 61130',
    'tech-audits': '62050',
    professional: '62010 62020 62030 62040 62060 62080 62090',
    'people-operations': '63030 63040 63050',
    travel: '64010 64020 64030 64050 64060 64070',
    offsite: '64110 64120 64130 64140 64150 64160 64170',
    marketing: '65030 65040 65099',
    'transaction-fees': '66010 66020 66030 66040',
    office: '67010 67020 67030',
    intercompany: '68140',
    'other-operating': '69020 69030 69040 69050',
    financing: '71002',
    'other-nonoperating': '71001',
    depreciation: '71003 72000',
    taxes: '75001 75002',
    reconciliation: '74000',
  }) as [PnlGroup, string][]) {
    for (const code of codes.split(' ')) {
      if (groups[code]) throw new Error(`QB account ${code} has multiple P&L groups`)
      groups[code] = group
    }
  }
  return groups
})()

// 69099 means different things in two companies; the label wins here.
export function classifyPnlAccount(account: PnlAccount): PnlGroup {
  if (account.glCode === '69099') {
    if (/uncategorized/i.test(account.label)) return 'other-operating'
    if (/reconciliation discrepancies/i.test(account.label)) return 'reconciliation'
    return 'unclassified'
  }
  return (account.glCode && ACCOUNT_GROUPS[account.glCode]) || 'unclassified'
}

export type PnlInventoryAccount = {
  glCode: string | null
  label: string
  kind: PnlKind
  group: PnlGroup
  amount: number
}

export type PnlInventory = {
  accounts: PnlInventoryAccount[]
  groups: Array<{ kind: PnlKind; group: PnlGroup; amount: number }>
  sectionResiduals: Array<{ section: string; amount: number }>
  netIncomeResidual: number
  unclassified: PnlInventoryAccount[]
}

const cents = (value: number) => Math.round(value * 100)

/** Every leaf counts once; QB parent subtotals are reconciliation targets. */
export function inventoryPnlTree(tree: PnlTree): PnlInventory {
  const accounts: PnlInventoryAccount[] = []
  const sectionResiduals: PnlInventory['sectionResiduals'] = []
  const grouped = new Map<string, number>()

  function walk(section: PnlSection, kind: PnlKind): number {
    let leafCents = 0
    for (const child of section.children) {
      if (child.kind === 'section') {
        leafCents += walk(child, kind)
      } else {
        const group = classifyPnlAccount(child)
        const amountCents = cents(child.amount)
        accounts.push({ glCode: child.glCode, label: child.label, kind, group, amount: child.amount })
        const key = `${kind}|${group}`
        grouped.set(key, (grouped.get(key) ?? 0) + amountCents)
        leafCents += amountCents
      }
    }
    const residual = cents(section.total) - leafCents
    if (residual) sectionResiduals.push({ section: section.title, amount: residual / 100 })
    return leafCents
  }

  for (const section of tree.sections) walk(section, section.sectionKind)
  const groups = [...grouped].map(([key, amount]) => {
    const [kind, group] = key.split('|') as [PnlKind, PnlGroup]
    return { kind, group, amount: amount / 100 }
  })
  const { revenue, expense, otherIncome, otherExpense, netIncome } = tree.totals
  return {
    accounts,
    groups,
    sectionResiduals,
    netIncomeResidual: (cents(revenue) + cents(otherIncome) - cents(expense) - cents(otherExpense) - cents(netIncome)) / 100,
    unclassified: accounts.filter((account) => account.group === 'unclassified'),
  }
}
