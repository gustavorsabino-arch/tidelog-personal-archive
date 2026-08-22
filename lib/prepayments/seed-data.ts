/**
 * Initial Opco prepayment register (account 14000) — built 2026-08-22 from
 * finance's classified 14000 ledger export (supplier + class per row) and
 * validated against the full ledger: every contract's schedule sums exactly
 * to its prepaid balance, and 11 of 13 land on whole months.
 *
 * Terms use the ORIGINAL start month so past amortizations reconcile green.
 * Descriptions carry the QB memo (hashes included) — the reconciler matches
 * ledger rows by vendor text OR by these distinctive memo tokens.
 *
 * Accounts confirmed by finance 2026-08-22: Argus → 62080 (Legal),
 * CoinGecko → 61010 (Engineering).
 */
export type PrepaymentSeed = {
  vendorName: string
  className: string
  expenseGlAccount: string
  totalAmount: number      // the prepaid balance parked in 14000
  startMonth: string       // first amortization month
  months: number
  description: string
  sourceDate: string
}

export const OPCO_PREPAYMENT_SEED: PrepaymentSeed[] = [
  {
    vendorName: 'Fireblocks', className: 'Finance', expenseGlAccount: '61010',
    totalAmount: 39735.21, startMonth: '2026-07', months: 11,
    description: 'Prepaid Fireblocks Monthly - Total - $43,347.48 (Jul-2026 renewal, 249CLaxVcDMdarP4pwEeEXhRSnAMPTX4wPEQWwvr61pcSj6XfPmrTrShsnc6VGBBMtWbu1zsgDEu9cQPFvdDMnvS)',
    sourceDate: '2026-07-14',
  },
  {
    vendorName: 'Doppel Inc.', className: 'Ops', expenseGlAccount: '62030',
    totalAmount: 57000, startMonth: '2025-04', months: 36,
    description: 'Doppel Inc. - Legal-25 Apr-2025 to Apr-2028 Services - $57,000 (3 years)',
    sourceDate: '2025-06-30',
  },
  {
    vendorName: 'Helius', className: 'Engineering', expenseGlAccount: '61120',
    totalAmount: 21120, startMonth: '2026-07', months: 11,
    description: 'June-2026 - Mercury CC Transfer to Opco - Helius - Total - $23,040.00',
    sourceDate: '2026-06-30',
  },
  {
    vendorName: 'Blockchain Association', className: 'Business Development', expenseGlAccount: '62090',
    totalAmount: 22916.67, startMonth: '2026-04', months: 11,
    description: 'Prepaid Blockchain Association - Total - $25,000.00',
    sourceDate: '2026-03-27',
  },
  {
    vendorName: 'Sprig Technologies', className: 'Product', expenseGlAccount: '61010',
    totalAmount: 10499.99, startMonth: '2026-07', months: 3,
    description: 'Sprig 04/26 to 04/27 - Total $14,000.00 - quarterly releases (2MfuVUpwVbNf7GWr4eLEXg52PjoY1bmfkPE2s7HvrrqWJYZptEeXVLAUEgc329LDr7p8MgS4DH9DSZdPRE3hNVHi)',
    sourceDate: '2026-06-11',
  },
  {
    vendorName: 'TRM Labs', className: 'Legal', expenseGlAccount: '61010',
    totalAmount: 10333.33, startMonth: '2026-07', months: 2,
    description: 'TRM Labs 05/04 to 08/04 - Total $15,500.00 (5UtsKymDjdzN8bF2XVbjyNiVhWKcshewRxmd4JFnbU5JEtVyGSaiKcp8GwB2F9St16dbaAT4Pa7jjsdUo4YYS955)',
    sourceDate: '2026-06-11',
  },
  {
    vendorName: 'CoinGecko', className: 'Engineering', expenseGlAccount: '61010',
    totalAmount: 4904.36, startMonth: '2026-06', months: 11,
    description: 'May-2026 - CoinGecko - Total $5,350.00',
    sourceDate: '2026-05-31',
  },
  {
    vendorName: 'Zedra', className: 'Legal', expenseGlAccount: '62030',
    totalAmount: 7141.73, startMonth: '2026-03', months: 11,
    description: 'Cayman Secretarial Services Invoice CYI007270 - Total $7,788.00',
    sourceDate: '2026-02-10',
  },
  {
    vendorName: 'Token Terminal', className: 'Ops', expenseGlAccount: '61020',
    totalAmount: 7000, startMonth: '2026-07', months: 2,
    description: 'Token Terminal quarterly - Total $10,500.00 (2QesxP3XFsswP77PHKRNGBfqutAvPDUoQdftypHcpLBtNQ68d6V3C6QcvWFFBRz9dYVsnX6YsBg8pPRGeUXFoJt9)',
    sourceDate: '2026-06-10',
  },
  {
    vendorName: 'Figma', className: 'Ops', expenseGlAccount: '61020',
    totalAmount: 3369.99, startMonth: '2026-08', months: 9,
    description: 'Figma - Total $8,000.00 - forward balance after the Jul-2026 correction (-$3,480)',
    sourceDate: '2026-05-31',
  },
  {
    vendorName: 'Argus', className: 'Legal', expenseGlAccount: '62080',
    totalAmount: 5041.67, startMonth: '2026-04', months: 11,
    description: 'Mar-2026 - Mercury CC Transfer to Opco - Argus - Total $5,500.00',
    sourceDate: '2026-03-31',
  },
  {
    vendorName: 'Notion', className: 'Ops', expenseGlAccount: '61020',
    totalAmount: 2860, startMonth: '2026-07', months: 11,
    description: 'June-2026 - Mercury CC Transfer to Opco - Notion - Total - $3,120.00',
    sourceDate: '2026-06-30',
  },
  {
    vendorName: 'Ashby', className: 'Ops', expenseGlAccount: '61010',
    totalAmount: 4950, startMonth: '2026-02', months: 11,
    description: 'Jan-2026 - Mercury CC Transfer to Opco - Ashby - Total $5,500.00',
    sourceDate: '2026-01-31',
  },
]
