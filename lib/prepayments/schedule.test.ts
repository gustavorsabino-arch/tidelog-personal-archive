import { describe, expect, test } from 'bun:test'
import { addMonths, monthlySchedule, reconcile, rowMatchesVendor, type GlRow, type PrepaymentItem } from './schedule'

function item(over: Partial<PrepaymentItem> = {}): PrepaymentItem {
  return {
    id: 'p1',
    vendorName: 'D&O Insurance Co',
    description: null,
    totalAmount: 24000,
    startMonth: '2026-07',
    months: 12,
    sourceTxnId: null,
    sourceDate: '2026-07-01',
    ...over,
  }
}

function row(over: Partial<GlRow> = {}): GlRow {
  return {
    date: '2026-07-15',
    txnId: null,
    name: 'D&O Insurance Co',
    memo: null,
    amountUsd: -2000,
    className: null,
    transactionType: 'Journal Entry',
    documentNumber: null,
    ...over,
  }
}

describe('addMonths', () => {
  test('rolls years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2026-01', 0)).toBe('2026-01')
  })
})

describe('monthlySchedule', () => {
  test('straight line with remainder on last month', () => {
    const s = monthlySchedule(item({ totalAmount: 10000, months: 3, startMonth: '2026-01' }))
    expect(s).toEqual([
      { month: '2026-01', amount: 3333.33 },
      { month: '2026-02', amount: 3333.33 },
      { month: '2026-03', amount: 3333.34 },
    ])
    expect(s.reduce((t, x) => t + x.amount, 0)).toBeCloseTo(10000, 2)
  })
})

describe('rowMatchesVendor', () => {
  test('token match through memo (short tokens dropped, "insurance" carries)', () => {
    expect(rowMatchesVendor(row({ name: null, memo: 'Amortization D&O insurance Jul' }), 'D&O Insurance Co')).toBe(true)
  })
  test('plain name match', () => {
    expect(rowMatchesVendor(row({ name: 'Rippling Payroll' }), 'Rippling')).toBe(true)
    expect(rowMatchesVendor(row({ name: 'Some Other Vendor' }), 'Rippling')).toBe(false)
  })
  test('short vendor whole-token', () => {
    expect(rowMatchesVendor(row({ name: 'AWS monthly' }), 'AWS')).toBe(true)
    expect(rowMatchesVendor(row({ name: 'JAWS media' }), 'AWS')).toBe(false)
  })
})

describe('reconcile', () => {
  test('posted, overdue, mismatch and future months', () => {
    const it = item({ totalAmount: 6000, months: 3, startMonth: '2026-06', vendorName: 'Rippling' })
    const gl: GlRow[] = [
      row({ date: '2026-06-20', name: 'Rippling', amountUsd: -2000 }), // exact → posted
      row({ date: '2026-07-20', name: 'Rippling', amountUsd: -1500 }), // wrong amount → mismatch
      // 2026-08: nothing posted; current month = 2026-08 → overdue
    ]
    const r = reconcile([it], gl, '2026-08')
    const cells = r.perItem.get('p1')!.cells
    expect(cells.find((c) => c.month === '2026-06')!.status).toBe('posted')
    expect(cells.find((c) => c.month === '2026-07')!.status).toBe('mismatch')
    expect(cells.find((c) => c.month === '2026-08')!.status).toBe('overdue')
    expect(r.perItem.get('p1')!.postedTotal).toBe(3500)
    expect(r.perItem.get('p1')!.remaining).toBe(2500)
  })

  test('future months are scheduled, not overdue', () => {
    const it = item({ totalAmount: 6000, months: 3, startMonth: '2026-09', vendorName: 'Rippling' })
    const r = reconcile([it], [], '2026-08')
    for (const c of r.perItem.get('p1')!.cells) expect(c.status).toBe('scheduled')
  })

  test('negative row assigned to the most specific vendor only', () => {
    const a = item({ id: 'a', vendorName: 'Orca', startMonth: '2026-07', totalAmount: 1200, months: 12 })
    const b = item({ id: 'b', vendorName: 'Orca Security', startMonth: '2026-07', totalAmount: 2400, months: 12 })
    const gl = [row({ date: '2026-07-10', name: 'Orca Security Ltd', amountUsd: -200 })]
    const r = reconcile([a, b], gl, '2026-07')
    expect(r.perItem.get('b')!.postedTotal).toBe(200)
    expect(r.perItem.get('a')!.postedTotal).toBe(0)
    expect(r.orphanNegatives.length).toBe(0)
  })

  test('orphans and candidates', () => {
    const it = item({ vendorName: 'Rippling', startMonth: '2026-07', totalAmount: 12000, months: 12, sourceDate: '2026-07-01' })
    const gl: GlRow[] = [
      row({ date: '2026-07-05', name: 'Mystery Corp', amountUsd: -999 }),           // orphan negative
      row({ date: '2026-07-01', name: 'Rippling', amountUsd: 12000 }),              // linked addition (same month+amount+vendor)
      row({ date: '2026-07-03', name: 'New SaaS Annual', amountUsd: 5000 }),        // candidate
    ]
    const r = reconcile([it], gl, '2026-07')
    expect(r.orphanNegatives.map((o) => o.name)).toEqual(['Mystery Corp'])
    expect(r.candidates.map((c) => c.name)).toEqual(['New SaaS Annual'])
  })
})
