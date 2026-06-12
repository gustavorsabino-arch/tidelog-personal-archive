import type { QbJournalEntry, QbJournalEntryLine } from './types.ts'
import { STABLE_TOKENS } from '../constants.ts'

// Pure JE construction. NO QB API calls, NO DB. Returns a payload ready to POST
// to /v3/company/<realm>/journalentry. Tested via lib/qb/post-journal-entry.test.ts.
//
// Per D8: out-transactions of non-stable tokens may emit ST/LT gain lines on
// GL 70150 (Realized Gain/Loss). Mirrors v1 logic at tidelog-frontend/index.html
// ~lines 12957-12982: gain pair = (Debit asset, Credit 70150) for profits or
// (Credit asset, Debit 70150) for losses, with `abs(gain)` as the amount. Net
// effect on the asset/wallet GL = cost basis (proceeds minus gain).

export type TxForPost = {
  id: string
  txHash: string
  direction: 'in' | 'out'
  asset: string
  qty: number
  usd: number
  blockTime: Date
  walletAccountCode: string // required per D5
  counterpartyGl: string // required per D5
  counterpartyLabel: string | null
  gain: { stGain: number | null; ltGain: number | null }
}

// Resolves a GL account NUMBER to a QB AccountRef. The real post path passes a
// resolver so AccountRef.value is the internal QB account Id — which the QB API
// requires; posting the bare account number is rejected. When omitted (dry-run
// preview), the raw number is used so the JE stays human-readable.
export type AccountResolver = (accountNumber: string) => { value: string; name?: string }

export class UnresolvedAccountError extends Error {
  constructor(public readonly accountNumber: string) {
    super(`GL account ${accountNumber} not found in the QuickBooks account catalog — refresh the catalog or fix the code`)
    this.name = 'UnresolvedAccountError'
  }
}

export type BuildArgs = {
  txs: TxForPost[] // 1 element for individual; many for bulk
  docNumber: string
  vendorEntityRef: { type: 'Vendor'; value: string } | null
  // The transaction's (or bulk group's) description. v1 parity: it is set as
  // QB's PrivateNote — which QB renders as the "Memo" — AND copied onto every
  // line's Description. One description per JE, the same string everywhere.
  // Falls back to `Tidelog · <txHash>` if somehow blank (mirrors v1's guard).
  description: string
  // When provided, every AccountRef value is resolved number → QB account Id
  // (throws UnresolvedAccountError on a missing code). Omitted → raw numbers.
  resolveAccount?: AccountResolver
}

const GAIN_LOSS_GL = '70150'
const BALANCE_EPSILON = 0.005 // half a cent — JE amounts are rounded to 2 dp

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function toUtcDate(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Aggregate {direction, walletAccountCode, counterpartyGl} pairs across txs so
// bulk groups emit one debit + one credit per unique GL pair, not N pairs.
type Aggregated = {
  direction: 'in' | 'out'
  walletAccountCode: string
  counterpartyGl: string
  usd: number
}

function aggregateMainLines(txs: TxForPost[]): Aggregated[] {
  const buckets = new Map<string, Aggregated>()
  for (const t of txs) {
    const key = `${t.direction}::${t.walletAccountCode}::${t.counterpartyGl}`
    const existing = buckets.get(key)
    if (existing) {
      existing.usd = round2(existing.usd + t.usd)
    } else {
      buckets.set(key, {
        direction: t.direction,
        walletAccountCode: t.walletAccountCode,
        counterpartyGl: t.counterpartyGl,
        usd: round2(t.usd),
      })
    }
  }
  return [...buckets.values()]
}

function buildMainPair(
  agg: Aggregated,
  vendorEntityRef: BuildArgs['vendorEntityRef'],
  resolve: AccountResolver,
): QbJournalEntryLine[] {
  // Inflow: Debit Wallet GL, Credit Counterparty GL.
  // Outflow: Debit Counterparty GL (AP-side, may carry vendor ref), Credit Wallet GL.
  const walletLine: QbJournalEntryLine = {
    DetailType: 'JournalEntryLineDetail',
    Amount: agg.usd,
    JournalEntryLineDetail: {
      PostingType: agg.direction === 'in' ? 'Debit' : 'Credit',
      AccountRef: resolve(agg.walletAccountCode),
    },
  }
  const cpDetail: QbJournalEntryLine['JournalEntryLineDetail'] = {
    PostingType: agg.direction === 'in' ? 'Credit' : 'Debit',
    AccountRef: resolve(agg.counterpartyGl),
  }
  // Vendor ref attaches ONLY to the AP-side of an outflow (the counterparty
  // line where PostingType=Debit). Inflows never carry a vendor ref.
  if (agg.direction === 'out' && vendorEntityRef) {
    cpDetail.Entity = {
      Type: 'Vendor',
      EntityRef: { value: vendorEntityRef.value },
    }
  }
  const cpLine: QbJournalEntryLine = {
    DetailType: 'JournalEntryLineDetail',
    Amount: agg.usd,
    JournalEntryLineDetail: cpDetail,
  }
  // Order: Wallet first for inflow (Debit first), Counterparty first for
  // outflow (Debit first). i.e. Debit lines come first in every pair.
  return agg.direction === 'in' ? [walletLine, cpLine] : [cpLine, walletLine]
}

function buildGainPair(walletAccountCode: string, gain: number, resolve: AccountResolver): QbJournalEntryLine[] {
  // gain > 0 (profit): Credit 70150 + Debit Wallet GL (reduces net asset credit
  //                    to cost basis; records realized gain).
  // gain < 0 (loss):   Debit 70150 + Credit Wallet GL (records realized loss).
  const abs = round2(Math.abs(gain))
  const isProfit = gain > 0
  return [
    {
      DetailType: 'JournalEntryLineDetail',
      Amount: abs,
      JournalEntryLineDetail: {
        PostingType: isProfit ? 'Credit' : 'Debit',
        AccountRef: resolve(GAIN_LOSS_GL),
      },
    },
    {
      DetailType: 'JournalEntryLineDetail',
      Amount: abs,
      JournalEntryLineDetail: {
        PostingType: isProfit ? 'Debit' : 'Credit',
        AccountRef: resolve(walletAccountCode),
      },
    },
  ]
}

function assertBalanced(je: QbJournalEntry): void {
  let debits = 0
  let credits = 0
  for (const l of je.Line) {
    if (l.JournalEntryLineDetail.PostingType === 'Debit') debits += l.Amount
    else credits += l.Amount
  }
  if (Math.abs(debits - credits) > BALANCE_EPSILON) {
    throw new Error(
      `Unbalanced journal entry ${je.DocNumber}: debits=${debits.toFixed(2)} credits=${credits.toFixed(2)}`,
    )
  }
}

export function buildJournalEntry(args: BuildArgs): QbJournalEntry {
  if (args.txs.length === 0) {
    throw new Error('buildJournalEntry: txs is empty')
  }

  // TxnDate = earliest blockTime across all members (UTC YYYY-MM-DD).
  const earliest = args.txs.reduce(
    (min, t) => (t.blockTime.getTime() < min.getTime() ? t.blockTime : min),
    args.txs[0].blockTime,
  )
  const txnDate = toUtcDate(earliest)

  const lines: QbJournalEntryLine[] = []

  // Real posts pass resolveAccount (number → QB account Id); preview omits it
  // and the raw number is used verbatim.
  const resolve: AccountResolver = args.resolveAccount ?? ((n) => ({ value: n }))

  // 1. Main debit/credit pairs (aggregated across bulk members).
  for (const agg of aggregateMainLines(args.txs)) {
    lines.push(...buildMainPair(agg, args.vendorEntityRef, resolve))
  }

  // 2. Gain/loss splits — only for outflows of non-stable tokens with non-zero
  //    ST or LT gain. Each non-zero component yields its own pair (matches v1).
  //    Bulk groups: sum ST and LT separately across members (per asset+wallet).
  type GainAccum = { stGain: number; ltGain: number }
  const gainBuckets = new Map<string, GainAccum>()
  for (const t of args.txs) {
    if (t.direction !== 'out') continue
    if (STABLE_TOKENS.has(t.asset)) continue
    const key = t.walletAccountCode // gain pair pivots on wallet GL
    const existing = gainBuckets.get(key) ?? { stGain: 0, ltGain: 0 }
    existing.stGain += t.gain.stGain ?? 0
    existing.ltGain += t.gain.ltGain ?? 0
    gainBuckets.set(key, existing)
  }
  for (const [walletAccountCode, { stGain, ltGain }] of gainBuckets) {
    const stRounded = round2(stGain)
    const ltRounded = round2(ltGain)
    if (stRounded !== 0) lines.push(...buildGainPair(walletAccountCode, stRounded, resolve))
    if (ltRounded !== 0) lines.push(...buildGainPair(walletAccountCode, ltRounded, resolve))
  }

  // Description → the Memo (PrivateNote) AND every line's Description. v1 used
  // one description across the whole JE; we match that. Fallback keeps a
  // breadcrumb if the description is blank (txs is non-empty by the guard above).
  const memo = args.description || `Tidelog · ${args.txs[0].txHash}`
  for (const line of lines) {
    line.Description = memo
  }

  const je: QbJournalEntry = {
    DocNumber: args.docNumber,
    TxnDate: txnDate,
    PrivateNote: memo,
    Line: lines,
  }

  assertBalanced(je)
  return je
}
