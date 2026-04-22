#!/usr/bin/env bun
/**
 * Seed budget_qb_mapping with v1's canonical QB account assignments.
 *
 * Idempotent: saveBudgetQbMappingRows DELETEs every existing row before
 * reinserting, so this script can be re-run safely.
 *
 * Run once:
 *   bun run scripts/seed-qb-mapping.ts
 *
 * After: `bun run cron:fetch-qb-reports` to pull GL for any accounts that
 * weren't previously cached.
 */

import { validateBudgetQbMappingRows } from '@/lib/budget/qb-mapping'
import { saveBudgetQbMappingRows } from '@/lib/budget/qb-mapping-db'
import type { BudgetQbMappingRow } from '@/lib/budget/types'

const V1_MAPPING: Array<Partial<BudgetQbMappingRow>> = [
  // Compensation & Benefits
  { cat: 'Compensation & Benefits', line: 'Salaries & Wages', key: 'salary', accounts: [60110, 60310] },
  { cat: 'Compensation & Benefits', line: 'Bonus', key: 'bonus', accounts: [60120, 60320] },
  { cat: 'Compensation & Benefits', line: 'Commissions', key: 'commissions', accounts: [60140, 60340] },
  { cat: 'Compensation & Benefits', line: 'Benefits', key: 'benefits', accounts: [60130, 60330, 60510, 60520] },
  { cat: 'Compensation & Benefits', line: 'Payroll Taxes', key: 'payroll', accounts: [60150] },
  { cat: 'Compensation & Benefits', line: 'Severance Pay', key: 'severance', accounts: [60160, 60350] },

  // Software & SaaS
  { cat: 'Software & SaaS', line: 'Department Tools', key: 'epdTools', accounts: [61010] },
  { cat: 'Software & SaaS', line: 'Company Tools', key: 'bizTools', accounts: [61020] },

  // Hosting & Infrastructure
  { cat: 'Hosting & Infrastructure', line: 'Cloud Hosting & Compute', key: 'hosting', accounts: [61110] },
  { cat: 'Hosting & Infrastructure', line: 'Blockchain & RPC', key: 'blockchainRpc', accounts: [61120] },
  { cat: 'Hosting & Infrastructure', line: 'Security & Monitoring', key: 'securityMon', accounts: [61130] },

  // HR & Recruiting
  { cat: 'HR & Recruiting', line: 'HR Costs', key: 'hrCosts', accounts: [63020, 63030, 63040, 63050] },
  { cat: 'HR & Recruiting', line: 'Third-Party & Referrals', key: 'recruiting', accounts: [63010] },

  // Marketing Expense
  { cat: 'Marketing Expense', line: 'Events', key: 'meals', accounts: [65030] },
  { cat: 'Marketing Expense', line: 'Other', key: 'mktExp', accounts: [65010, 65020, 65040, 65050, 65099] },

  // Travel & Entertainment
  { cat: 'Travel & Entertainment', line: 'Travel & Entertainment', key: 'travel', accounts: [64010, 64020, 64030, 64040, 64050, 64060, 64070] },
  { cat: 'Travel & Entertainment', line: 'Company Offsite', key: 'colos', accounts: [64110, 64120, 64130, 64140, 64150, 64160, 64170] },

  // Professional Services
  { cat: 'Professional Services', line: 'Professional Services', key: 'profSvc', accounts: [62010, 62020, 62030, 62050, 62060, 62070] },
  { cat: 'Professional Services', line: 'Corporate Compliance', key: 'corpCompliance', accounts: [62040] },

  // Transaction Fees
  { cat: 'Transaction Fees', line: 'Transaction Fees', key: 'bankFees', accounts: [66010, 66020, 66040] },

  // Office
  { cat: 'Office', line: 'Office', key: 'rent', accounts: [67010, 67020, 67030] },

  // Misc Expenses
  { cat: 'Misc Expenses', line: 'Misc Expenses', key: 'hardware', accounts: [69010, 69020, 69040, 69099] },
]

const normalized = validateBudgetQbMappingRows(V1_MAPPING)
await saveBudgetQbMappingRows(normalized)

const accountCount = normalized.reduce((sum, row) => sum + row.accounts.length, 0)
console.log(`seeded budget_qb_mapping: ${normalized.length} lines, ${accountCount} account rows`)
process.exit(0)
