import { describe, it, expect } from 'bun:test'
import { buildJournalEntry, UnresolvedAccountError, type TxForPost } from './post-journal-entry'

// Common fields shared by all fixture txs. Each test overrides the specifics.
const baseTx = {
  id: 'tx1',
  txHash: '0xabc',
  blockTime: new Date('2026-02-15T10:00:00Z'),
  counterpartyLabel: 'AWS',
  gain: { stGain: null, ltGain: null },
} as const

function makeTx(overrides: Partial<TxForPost> & Pick<TxForPost, 'direction' | 'asset' | 'qty' | 'usd' | 'walletAccountCode' | 'counterpartyGl'>): TxForPost {
  return {
    ...baseTx,
    ...overrides,
  }
}

function sumByPostingType(je: ReturnType<typeof buildJournalEntry>, pt: 'Debit' | 'Credit'): number {
  return je.Line
    .filter((l) => l.JournalEntryLineDetail.PostingType === pt)
    .reduce((s, l) => s + l.Amount, 0)
}

describe('buildJournalEntry', () => {
  describe('individual inflow', () => {
    it('debits Wallet GL and credits Counterparty GL for usd', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'in', asset: 'USDC', qty: 100, usd: 100, walletAccountCode: '1010', counterpartyGl: '4010' })],
        docNumber: 'TL-Feb-JE07',
        description:'uuid-1',
      })

      expect(je.DocNumber).toBe('TL-Feb-JE07')
      // Description → Memo (PrivateNote) AND every line's Description.
      expect(je.PrivateNote).toBe('uuid-1')
      expect(je.TxnDate).toBe('2026-02-15')
      expect(je.Line).toHaveLength(2)
      expect(je.Line.every((l) => l.Description === 'uuid-1')).toBe(true)

      const debit = je.Line[0]
      const credit = je.Line[1]
      expect(debit.DetailType).toBe('JournalEntryLineDetail')
      expect(debit.JournalEntryLineDetail.PostingType).toBe('Debit')
      expect(debit.JournalEntryLineDetail.AccountRef.value).toBe('1010')
      expect(debit.Amount).toBe(100)

      expect(credit.JournalEntryLineDetail.PostingType).toBe('Credit')
      expect(credit.JournalEntryLineDetail.AccountRef.value).toBe('4010')
      expect(credit.Amount).toBe(100)

      // No vendor attachment on inflow
      expect(debit.JournalEntryLineDetail.Entity).toBeUndefined()
      expect(credit.JournalEntryLineDetail.Entity).toBeUndefined()
    })

    it('inflow with vendorName set: vendor attaches to the counterparty (Credit) line, not the wallet line (matches V1)', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'in', asset: 'USDC', qty: 50, usd: 50, walletAccountCode: '1010', counterpartyGl: '4010', vendorName: 'AWS' })],
        docNumber: 'TL-Feb-JE99',
        description:'uuid-x',
        resolveVendor: (n) => n === 'AWS' ? { value: 'V42' } : null,
      })
      // V1 selector is the counterparty-account line regardless of direction;
      // on an inflow that's the Credit line. QB requires Entity on A/P lines.
      const cpLine = je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '4010')!
      const walletLine = je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '1010')!
      expect(cpLine.JournalEntryLineDetail.PostingType).toBe('Credit')
      expect(cpLine.JournalEntryLineDetail.Entity).toEqual({
        Type: 'Vendor',
        EntityRef: { value: 'V42' },
      })
      expect(walletLine.JournalEntryLineDetail.Entity).toBeUndefined()
    })
  })

  describe('individual outflow', () => {
    it('debits Counterparty GL and credits Wallet GL for usd', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'USDC', qty: 50, usd: 50, walletAccountCode: '1010', counterpartyGl: '6010' })],
        docNumber: 'TL-Feb-JE08',
        description:'uuid-2',
      })
      expect(je.Line).toHaveLength(2)
      expect(je.Line[0].JournalEntryLineDetail.AccountRef.value).toBe('6010')
      expect(je.Line[0].JournalEntryLineDetail.PostingType).toBe('Debit')
      expect(je.Line[0].Amount).toBe(50)
      expect(je.Line[1].JournalEntryLineDetail.AccountRef.value).toBe('1010')
      expect(je.Line[1].JournalEntryLineDetail.PostingType).toBe('Credit')
      expect(je.Line[1].Amount).toBe(50)
    })

    it('attaches per-tx vendorName to the AP (counterparty Debit) line only', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'USDC', qty: 50, usd: 50, walletAccountCode: '1010', counterpartyGl: '6010', vendorName: 'AWS' })],
        docNumber: 'TL-Feb-JE09',
        description:'uuid-3',
        resolveVendor: (n) => n === 'AWS' ? { value: 'V42' } : null,
      })
      const apLine = je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '6010')!
      const cashLine = je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '1010')!
      expect(apLine.JournalEntryLineDetail.Entity).toEqual({
        Type: 'Vendor',
        EntityRef: { value: 'V42' },
      })
      expect(cashLine.JournalEntryLineDetail.Entity).toBeUndefined()
    })
  })

  describe('gain/loss splits (outflow, non-stable, D8)', () => {
    it('positive ST gain on non-stable outflow: adds Credit on 70150 + Debit on Wallet GL', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'ORCA', qty: 10, usd: 100, walletAccountCode: '1300', counterpartyGl: '6010', gain: { stGain: 20, ltGain: null } })],
        docNumber: 'TL-Feb-JE10',

        description:'uuid-4',
      })
      // Expect a credit-line on 70150 of $20 (gain)
      const gainCredit = je.Line.find(
        (l) =>
          l.JournalEntryLineDetail.AccountRef.value === '70150' &&
          l.JournalEntryLineDetail.PostingType === 'Credit',
      )
      expect(gainCredit?.Amount).toBe(20)

      // Net asset (wallet) — main Credit usd, plus extra Debit gain
      // Per v1: outflow main line credits wallet GL for $100, gain pair debits
      // wallet GL for $20 — net Credit $80 (= cost basis).
      const walletDebits = je.Line
        .filter((l) => l.JournalEntryLineDetail.AccountRef.value === '1300' && l.JournalEntryLineDetail.PostingType === 'Debit')
        .reduce((s, l) => s + l.Amount, 0)
      const walletCredits = je.Line
        .filter((l) => l.JournalEntryLineDetail.AccountRef.value === '1300' && l.JournalEntryLineDetail.PostingType === 'Credit')
        .reduce((s, l) => s + l.Amount, 0)
      expect(walletCredits).toBe(100)
      expect(walletDebits).toBe(20)

      // JE balanced overall
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'))
    })

    it('negative LT loss on non-stable outflow: adds Debit on 70150 + Credit on Wallet GL', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'ORCA', qty: 10, usd: 100, walletAccountCode: '1300', counterpartyGl: '6010', gain: { stGain: null, ltGain: -15 } })],
        docNumber: 'TL-Feb-JE11',

        description:'uuid-5',
      })
      const lossDebit = je.Line.find(
        (l) =>
          l.JournalEntryLineDetail.AccountRef.value === '70150' &&
          l.JournalEntryLineDetail.PostingType === 'Debit',
      )
      expect(lossDebit?.Amount).toBe(15)
      // Balance check
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'))
    })

    it('both ST gain and LT loss: emits two separate gain/loss pairs (one per non-zero component)', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'ORCA', qty: 10, usd: 100, walletAccountCode: '1300', counterpartyGl: '6010', gain: { stGain: 25, ltGain: -5 } })],
        docNumber: 'TL-Feb-JE12',

        description:'uuid-6',
      })
      const gainCredit = je.Line.find(
        (l) => l.JournalEntryLineDetail.AccountRef.value === '70150' && l.JournalEntryLineDetail.PostingType === 'Credit' && l.Amount === 25,
      )
      const lossDebit = je.Line.find(
        (l) => l.JournalEntryLineDetail.AccountRef.value === '70150' && l.JournalEntryLineDetail.PostingType === 'Debit' && l.Amount === 5,
      )
      expect(gainCredit).toBeDefined()
      expect(lossDebit).toBeDefined()
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'))
    })

    it('zero gain (both ST and LT are 0 or null) on non-stable outflow: no gain lines', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'ORCA', qty: 10, usd: 100, walletAccountCode: '1300', counterpartyGl: '6010', gain: { stGain: 0, ltGain: 0 } })],
        docNumber: 'TL-Feb-JE13',

        description:'uuid-7',
      })
      expect(je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '70150')).toBeUndefined()
      expect(je.Line).toHaveLength(2)
    })

    it('stable token (USDC) outflow: NO gain lines even if stGain/ltGain are populated', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'USDC', qty: 100, usd: 100, walletAccountCode: '1010', counterpartyGl: '6010', gain: { stGain: 5, ltGain: null } })],
        docNumber: 'TL-Feb-JE14',

        description:'uuid-8',
      })
      // No 70150 lines for stable-token transactions
      expect(je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '70150')).toBeUndefined()
      expect(je.Line).toHaveLength(2)
    })

    it('inflow with gain: no gain lines (gains only apply to disposals)', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'in', asset: 'ORCA', qty: 10, usd: 100, walletAccountCode: '1300', counterpartyGl: '4010', gain: { stGain: 50, ltGain: 50 } })],
        docNumber: 'TL-Feb-JE15',

        description:'uuid-9',
      })
      expect(je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '70150')).toBeUndefined()
      expect(je.Line).toHaveLength(2)
    })
  })

  describe('bulk grouping', () => {
    it('3 USDC inflows to same wallet+counterparty GL: 1 debit + 1 credit, amounts summed', () => {
      const je = buildJournalEntry({
        txs: [
          makeTx({ id: 't1', direction: 'in', asset: 'USDC', qty: 100, usd: 100, walletAccountCode: '1010', counterpartyGl: '4010' }),
          makeTx({ id: 't2', direction: 'in', asset: 'USDC', qty: 200, usd: 200, walletAccountCode: '1010', counterpartyGl: '4010' }),
          makeTx({ id: 't3', direction: 'in', asset: 'USDC', qty: 50, usd: 50, walletAccountCode: '1010', counterpartyGl: '4010' }),
        ],
        docNumber: 'BULK-USDC-2026-02',

        description:'uuid-bulk',
      })
      expect(je.Line).toHaveLength(2)
      expect(je.Line[0].Amount).toBe(350)
      expect(je.Line[1].Amount).toBe(350)
      expect(sumByPostingType(je, 'Debit')).toBe(350)
      expect(sumByPostingType(je, 'Credit')).toBe(350)
    })

    it('mixed counterparty GLs in same bulk: one credit/debit per unique GL pair, totals balanced', () => {
      const je = buildJournalEntry({
        txs: [
          makeTx({ id: 't1', direction: 'in', asset: 'USDC', qty: 100, usd: 100, walletAccountCode: '1010', counterpartyGl: '4010' }),
          makeTx({ id: 't2', direction: 'in', asset: 'USDC', qty: 200, usd: 200, walletAccountCode: '1010', counterpartyGl: '4020' }),
        ],
        docNumber: 'BULK-USDC-2026-02',

        description:'uuid-bulk2',
      })
      // Two credit lines (one per CP GL) + summed Wallet debit OR
      // per-pair debit/credit lines — either way: balanced and 70150 absent.
      expect(sumByPostingType(je, 'Debit')).toBe(300)
      expect(sumByPostingType(je, 'Credit')).toBe(300)
      // Credit lines hit BOTH counterparty GLs
      const credit4010 = je.Line.filter((l) => l.JournalEntryLineDetail.AccountRef.value === '4010' && l.JournalEntryLineDetail.PostingType === 'Credit').reduce((s, l) => s + l.Amount, 0)
      const credit4020 = je.Line.filter((l) => l.JournalEntryLineDetail.AccountRef.value === '4020' && l.JournalEntryLineDetail.PostingType === 'Credit').reduce((s, l) => s + l.Amount, 0)
      expect(credit4010).toBe(100)
      expect(credit4020).toBe(200)
    })

    it('TxnDate is the earliest blockTime across bulk members', () => {
      const je = buildJournalEntry({
        txs: [
          makeTx({ id: 't1', direction: 'in', asset: 'USDC', qty: 1, usd: 1, walletAccountCode: '1010', counterpartyGl: '4010', blockTime: new Date('2026-02-20T00:00:00Z') }),
          makeTx({ id: 't2', direction: 'in', asset: 'USDC', qty: 1, usd: 1, walletAccountCode: '1010', counterpartyGl: '4010', blockTime: new Date('2026-02-05T00:00:00Z') }),
          makeTx({ id: 't3', direction: 'in', asset: 'USDC', qty: 1, usd: 1, walletAccountCode: '1010', counterpartyGl: '4010', blockTime: new Date('2026-02-12T00:00:00Z') }),
        ],
        docNumber: 'BULK-USDC-2026-02',

        description:'uuid-bulk-date',
      })
      expect(je.TxnDate).toBe('2026-02-05')
    })
  })

  describe('balance', () => {
    it('throws on empty txs (defensive)', () => {
      expect(() =>
        buildJournalEntry({ txs: [], docNumber: 'X', description:'u' }),
      ).toThrow()
    })

    it('outflow with non-stable gain stays balanced to the cent', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'ORCA', qty: 10, usd: 123.45, walletAccountCode: '1300', counterpartyGl: '6010', gain: { stGain: 12.34, ltGain: -5.67 } })],
        docNumber: 'TL-Feb-JE99',

        description:'uuid-bal',
      })
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'), 2)
    })
  })

  describe('description → Memo + every line', () => {
    it('copies the description onto gain/loss lines too', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'SOL', qty: 1, usd: 100, walletAccountCode: '1010', counterpartyGl: '4010', gain: { stGain: 20, ltGain: null } })],
        docNumber: 'TL-Feb-JE10',

        description: 'Out - SOL - 1 - $100 - 0xabc',
      })
      // gain on a non-stable outflow → more than the 2 main lines
      expect(je.Line.length).toBeGreaterThan(2)
      expect(je.PrivateNote).toBe('Out - SOL - 1 - $100 - 0xabc')
      expect(je.Line.every((l) => l.Description === 'Out - SOL - 1 - $100 - 0xabc')).toBe(true)
    })

    it('falls back to `Tidelog · <txHash>` when description is empty', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'in', asset: 'USDC', qty: 1, usd: 1, walletAccountCode: '1010', counterpartyGl: '4010' })],
        docNumber: 'TL-Feb-JE11',

        description: '',
      })
      expect(je.PrivateNote).toBe('Tidelog · 0xabc')
      expect(je.Line.every((l) => l.Description === 'Tidelog · 0xabc')).toBe(true)
    })
  })

  describe('TxnDate', () => {
    it('uses blockTime UTC date (YYYY-MM-DD) for individual', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'in', asset: 'USDC', qty: 1, usd: 1, walletAccountCode: '1010', counterpartyGl: '4010', blockTime: new Date('2026-02-15T23:59:59Z') })],
        docNumber: 'TL-Feb-JE01',

        description:'uuid-d',
      })
      expect(je.TxnDate).toBe('2026-02-15')
    })
  })

  describe('resolveAccount (number → QB account Id)', () => {
    it('emits resolved Ids + names when a resolver is provided', () => {
      const known: Record<string, { value: string; name: string }> = {
        '1010': { value: '42', name: 'Cash' },
        '4010': { value: '77', name: 'Revenue' },
      }
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'in', asset: 'USDC', qty: 100, usd: 100, walletAccountCode: '1010', counterpartyGl: '4010' })],
        docNumber: 'TL-Feb-JE07', description:'uuid-r',
        resolveAccount: (n) => known[n],
      })
      expect(je.Line[0].JournalEntryLineDetail.AccountRef.value).toBe('42')
      expect(je.Line[0].JournalEntryLineDetail.AccountRef.name).toBe('Cash')
      expect(je.Line[1].JournalEntryLineDetail.AccountRef.value).toBe('77')
      expect(je.Line[1].JournalEntryLineDetail.AccountRef.name).toBe('Revenue')
    })

    it('resolves the gain/loss account (70150) through the same resolver', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'SOL', qty: 1, usd: 100, walletAccountCode: '1010', counterpartyGl: '4010', gain: { stGain: 20, ltGain: null } })],
        docNumber: 'TL-Feb-JE08', description:'uuid-g',
        resolveAccount: (n) => ({ value: `id:${n}` }),
      })
      const refs = je.Line.map((l) => l.JournalEntryLineDetail.AccountRef.value)
      expect(refs).toContain('id:70150')
      expect(refs.every((v) => v.startsWith('id:'))).toBe(true)
    })

    it('throws UnresolvedAccountError when a code is missing from the catalog', () => {
      const known: Record<string, { value: string }> = { '4010': { value: '77' } }
      expect(() =>
        buildJournalEntry({
          txs: [makeTx({ direction: 'in', asset: 'USDC', qty: 100, usd: 100, walletAccountCode: '9999', counterpartyGl: '4010' })],
          docNumber: 'TL-Feb-JE09', description:'uuid-x',
          resolveAccount: (n) => { const a = known[n]; if (!a) throw new UnresolvedAccountError(n); return a },
        }),
      ).toThrow(UnresolvedAccountError)
    })
  })

  // ── CLASS / VENDOR REFS (Task 1) ─────────────────────────────────────────────

  describe('ClassRef + per-tx vendor EntityRef', () => {
    const classMap: Record<string, { value: string; name?: string }> = {
      Ops: { value: '5', name: 'Ops' },
      Finance: { value: '8', name: 'Finance' },
    }
    const vendorMap: Record<string, { value: string }> = {
      AWS: { value: 'V10' },
      GCP: { value: 'V20' },
    }
    const resolveClass = (n: string) => classMap[n] ?? null
    const resolveVendor = (n: string) => vendorMap[n] ?? null

    it('individual inflow with className: both lines carry ClassRef; no vendor on any line', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'in', asset: 'USDC', qty: 100, usd: 100, walletAccountCode: '1010', counterpartyGl: '4010', className: 'Ops' })],
        docNumber: 'TL-CLASS-01',

        description: 'inflow-class',
        resolveClass,
        resolveVendor,
      })
      expect(je.Line).toHaveLength(2)
      // Both lines should have ClassRef resolved to {value:'5', name:'Ops'}
      for (const line of je.Line) {
        expect(line.JournalEntryLineDetail.ClassRef).toEqual({ value: '5', name: 'Ops' })
      }
      // No vendor on any line for inflows
      for (const line of je.Line) {
        expect(line.JournalEntryLineDetail.Entity).toBeUndefined()
      }
      // Balance
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'))
    })

    it('individual outflow with className + vendorName: all lines have ClassRef; AP-side Debit has vendor Entity; wallet Credit does not', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'USDC', qty: 50, usd: 50, walletAccountCode: '1010', counterpartyGl: '6010', className: 'Ops', vendorName: 'AWS' })],
        docNumber: 'TL-CLASS-02',

        description: 'outflow-class-vendor',
        resolveClass,
        resolveVendor,
      })
      expect(je.Line).toHaveLength(2)
      // Both lines have ClassRef
      for (const line of je.Line) {
        expect(line.JournalEntryLineDetail.ClassRef).toEqual({ value: '5', name: 'Ops' })
      }
      // AP line (counterparty Debit on 6010) has vendor Entity
      const apLine = je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '6010')!
      expect(apLine.JournalEntryLineDetail.Entity).toEqual({ Type: 'Vendor', EntityRef: { value: 'V10' } })
      // Wallet Credit line (1010) has NO vendor
      const walletLine = je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '1010')!
      expect(walletLine.JournalEntryLineDetail.Entity).toBeUndefined()
      // Balance
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'))
    })

    it('outflow with gain (non-stable): gain pair lines also carry ClassRef', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'ORCA', qty: 10, usd: 100, walletAccountCode: '1300', counterpartyGl: '6010', gain: { stGain: 20, ltGain: null }, className: 'Ops' })],
        docNumber: 'TL-CLASS-03',

        description: 'outflow-gain-class',
        resolveClass,
        resolveVendor,
      })
      // 2 main lines + 2 gain lines = 4 total
      expect(je.Line).toHaveLength(4)
      // Every single line has ClassRef
      for (const line of je.Line) {
        expect(line.JournalEntryLineDetail.ClassRef).toEqual({ value: '5', name: 'Ops' })
      }
      // Balance
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'))
    })

    it('bulk: same direction/wallet/counterpartyGl but different className → two separate debit/credit pairs with correct ClassRefs', () => {
      const je = buildJournalEntry({
        txs: [
          makeTx({ id: 't1', direction: 'out', asset: 'USDC', qty: 50, usd: 50, walletAccountCode: '1010', counterpartyGl: '6010', className: 'Ops' }),
          makeTx({ id: 't2', direction: 'out', asset: 'USDC', qty: 30, usd: 30, walletAccountCode: '1010', counterpartyGl: '6010', className: 'Finance' }),
        ],
        docNumber: 'TL-CLASS-04',

        description: 'bulk-diff-class',
        resolveClass,
        resolveVendor,
      })
      // Different className → different buckets → 4 lines (2 pairs)
      expect(je.Line).toHaveLength(4)
      // Find the two AP (Debit on 6010) lines
      const apLines = je.Line.filter((l) => l.JournalEntryLineDetail.AccountRef.value === '6010' && l.JournalEntryLineDetail.PostingType === 'Debit')
      expect(apLines).toHaveLength(2)
      const classRefs = apLines.map((l) => l.JournalEntryLineDetail.ClassRef?.value).sort()
      expect(classRefs).toEqual(['5', '8'])
      // Balance
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'))
    })

    it('className: null → no ClassRef on any line; outflow with vendorName → AP Debit line gets vendor Entity via resolveVendor', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'USDC', qty: 50, usd: 50, walletAccountCode: '1010', counterpartyGl: '6010', className: null, vendorName: 'AWS' })],
        docNumber: 'TL-CLASS-05',
        description: 'null-class-per-tx-vendor',
        resolveClass,
        resolveVendor,
      })
      // No ClassRef anywhere (className is null)
      for (const line of je.Line) {
        expect(line.JournalEntryLineDetail.ClassRef).toBeUndefined()
      }
      // AP line (counterparty Debit on 6010) gets vendor Entity from per-tx vendorName
      const apLine = je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '6010')!
      expect(apLine.JournalEntryLineDetail.Entity).toEqual({ Type: 'Vendor', EntityRef: { value: 'V10' } })
      // Balance
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'))
    })

    it('resolveClass returning null (name not in catalog) → ClassRef omitted on all lines', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'in', asset: 'USDC', qty: 100, usd: 100, walletAccountCode: '1010', counterpartyGl: '4010', className: 'UnknownClass' })],
        docNumber: 'TL-CLASS-06',

        description: 'unknown-class',
        resolveClass,
        resolveVendor,
      })
      for (const line of je.Line) {
        expect(line.JournalEntryLineDetail.ClassRef).toBeUndefined()
      }
    })

    it('resolveVendor returning null (name not in catalog) → Entity omitted on AP line', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'USDC', qty: 50, usd: 50, walletAccountCode: '1010', counterpartyGl: '6010', vendorName: 'UnknownVendor' })],
        docNumber: 'TL-CLASS-07',

        description: 'unknown-vendor',
        resolveClass,
        resolveVendor,
      })
      const apLine = je.Line.find((l) => l.JournalEntryLineDetail.AccountRef.value === '6010')!
      expect(apLine.JournalEntryLineDetail.Entity).toBeUndefined()
    })

    it('no resolvers provided (preview mode) → ClassRef.value is the raw class name string', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'in', asset: 'USDC', qty: 100, usd: 100, walletAccountCode: '1010', counterpartyGl: '4010', className: 'Ops' })],
        docNumber: 'TL-CLASS-08',

        description: 'preview-class',
        // No resolveClass or resolveVendor provided
      })
      for (const line of je.Line) {
        expect(line.JournalEntryLineDetail.ClassRef).toEqual({ value: 'Ops' })
      }
    })

    it('balance holds in all class/vendor cases (outflow with class+vendor+gain)', () => {
      const je = buildJournalEntry({
        txs: [makeTx({ direction: 'out', asset: 'ORCA', qty: 5, usd: 80, walletAccountCode: '1300', counterpartyGl: '6010', gain: { stGain: 10, ltGain: -3 }, className: 'Ops', vendorName: 'AWS' })],
        docNumber: 'TL-CLASS-09',

        description: 'full-balance',
        resolveClass,
        resolveVendor,
      })
      expect(sumByPostingType(je, 'Debit')).toBeCloseTo(sumByPostingType(je, 'Credit'))
    })
  })
})
