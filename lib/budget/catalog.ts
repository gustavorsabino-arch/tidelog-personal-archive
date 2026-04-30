const V1_BUDGET_LINE_CATALOG = [
  { key: 'salary', label: 'Salaries & Wages', category: 'Compensation & Benefits' },
  { key: 'benefits', label: 'Benefits', category: 'Compensation & Benefits' },
  { key: 'payroll', label: 'Payroll Taxes', category: 'Compensation & Benefits' },
  { key: 'severance', label: 'Severance Pay', category: 'Compensation & Benefits' },
  { key: 'epdTools', label: 'Department Tools', category: 'Software & SaaS' },
  { key: 'bizTools', label: 'Company Tools', category: 'Software & SaaS' },
  { key: 'hosting', label: 'Cloud Hosting & Compute', category: 'Hosting & Infrastructure' },
  { key: 'blockchainRpc', label: 'Blockchain & RPC', category: 'Hosting & Infrastructure' },
  { key: 'securityMon', label: 'Security & Monitoring', category: 'Hosting & Infrastructure' },
  { key: 'hrCosts', label: 'HR Costs', category: 'HR & Recruiting' },
  { key: 'recruiting', label: 'Third-Party & Referrals', category: 'HR & Recruiting' },
  { key: 'meals', label: 'Events', category: 'Marketing Expense' },
  { key: 'mktExp', label: 'Other', category: 'Marketing Expense' },
  { key: 'profSvc', label: 'Professional Services', category: 'Professional Services' },
  { key: 'corpCompliance', label: 'Corporate Compliance', category: 'Professional Services' },
  { key: 'travel', label: 'Travel & Entertainment', category: 'Travel & Entertainment' },
  { key: 'colos', label: 'Company Offsite', category: 'Travel & Entertainment' },
  { key: 'bankFees', label: 'Transaction Fees', category: 'Transaction Fees' },
  { key: 'rent', label: 'Office', category: 'Office' },
  { key: 'hardware', label: 'Misc Expenses', category: 'Misc Expenses' },
  { key: 'bonus', label: 'Bonus', category: 'Compensation & Benefits' },
  { key: 'commissions', label: 'Commissions', category: 'Compensation & Benefits' },
] as const

const EXTENSION_BUDGET_LINE_CATALOG = [
  { key: 'corpFees', label: 'Corporate Fees', category: 'Professional Services' },
  { key: 'lobbying', label: 'Lobbying', category: 'Professional Services' },
  { key: 'mmFees', label: 'Market Maker Fees', category: 'Transaction Fees' },
  { key: 'industryRelations', label: 'Industry Relations', category: 'Professional Services' },
  { key: 'contingency', label: 'Contingency', category: 'Contingency' },
] as const

export const BUDGET_LINE_CATALOG = [
  ...V1_BUDGET_LINE_CATALOG,
  ...EXTENSION_BUDGET_LINE_CATALOG,
] as const

export type BudgetLineCatalogEntry = (typeof BUDGET_LINE_CATALOG)[number]
export type BudgetLineKey = BudgetLineCatalogEntry['key']

export const BUDGET_LINE_ENTRY_BY_KEY: Record<string, BudgetLineCatalogEntry> = Object.fromEntries(
  BUDGET_LINE_CATALOG.map((entry) => [entry.key, entry]),
)

function normalizeBudgetLineToken(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const BUDGET_LINE_KEY_ALIASES: Record<string, string> = {
  salarys_wages: 'salary',
  salaries_wages: 'salary',
  payroll_tax: 'payroll',
  payroll_taxes: 'payroll',
  department_tools: 'epdTools',
  epd_tools: 'epdTools',
  business_tools: 'bizTools',
  company_tools: 'bizTools',
  cloud_hosting_compute: 'hosting',
  cloud_hosting_and_compute: 'hosting',
  blockchain_rpc: 'blockchainRpc',
  security_monitoring: 'securityMon',
  security: 'securityMon',
  hr_cost: 'hrCosts',
  third_party_referrals: 'recruiting',
  events_meals: 'meals',
  marketing_expense: 'mktExp',
  professional_services: 'profSvc',
  compliance: 'corpCompliance',
  entity_compliance: 'corpCompliance',
  corporate_compliance: 'corpCompliance',
  transaction_fees: 'bankFees',
  bank_fees: 'bankFees',
  misc_expenses: 'hardware',
}

for (const entry of BUDGET_LINE_CATALOG) {
  BUDGET_LINE_KEY_ALIASES[normalizeBudgetLineToken(entry.key)] = entry.key
  BUDGET_LINE_KEY_ALIASES[normalizeBudgetLineToken(entry.label)] = entry.key
}

export function normalizeBudgetLineKey(key: string): string {
  const normalized = normalizeBudgetLineToken(key)
  if (!normalized) return ''
  return BUDGET_LINE_KEY_ALIASES[normalized] ?? normalized
}

export function normalizeBudgetLineAmounts<T extends Record<string, number>>(lines: T): Record<string, number> {
  const normalizedEntries = Object.entries(lines ?? {})
  const result: Record<string, number> = {}

  for (const [rawKey, rawValue] of normalizedEntries) {
    const nextKey = normalizeBudgetLineKey(rawKey)
    if (!nextKey) continue
    result[nextKey] = (result[nextKey] ?? 0) + (rawValue ?? 0)
  }

  return result
}
