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
  // Optional per-tx class/vendor for QB posting (Task 1). Existing callers that
  // omit these continue to compile and behave as before.
  className?: string | null
  vendorName?: string | null
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
  // The transaction's (or bulk group's) description. v1 parity: it is set as
  // QB's PrivateNote — which QB renders as the "Memo" — AND copied onto every
  // line's Description. One description per JE, the same string everywhere.
  // Falls back to `Tidelog · <txHash>` if somehow blank (mirrors v1's guard).
  description: string
  // When provided, every AccountRef value is resolved number → QB account Id
  // (throws UnresolvedAccountError on a missing code). Omitted → raw numbers.
  resolveAccount?: AccountResolver
  // Per-name resolvers for QB Class and Vendor catalogs. When omitted (preview),
  // the raw name is used verbatim so JEs stay human-readable without catalog data.
  // A resolver returning null means the name is not in the catalog — omit the ref.
  resolveClass?: (name: string) => { value: string; name?: string } | null
  resolveVendor?: (name: string) => { value: string } | null
  // Realized Gain/Loss GL for this entity. Callers pass gainLossGlForEntity();
  // defaults to 70150 when omitted (preview / tests without an entity).
  gainLossGl?: string
}

// Realized Gain/Loss GL, per entity. Opco + Zagreus moved to 70510
// (chart-of-accounts change, 2026-09); Foundation + Juku stay on 70150.
const GAIN_LOSS_GL_DEFAULT = '70150'
const GAIN_LOSS_GL_BY_ENTITY: Record<string, string> = {
  opco: '70510',
  zagreus: '70510',
  foundation: '70150',
  juku: '70150',
}
export function gainLossGlForEntity(entity: string): string {
  return GAIN_LOSS_GL_BY_ENTITY[entity.toLowerCase()] ?? GAIN_LOSS_GL_DEFAULT
}
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

// Aggregate {direction, walletAccountCode, counterpartyGl, className, vendorName}
// tuples across txs so bulk groups emit one debit + one credit per unique GL
// pair. className and vendorName are included in the key so txs with different
// classes/vendors produce separate lines (each carrying the correct ClassRef /
// vendor Entity) rather than being merged into one class-less line.
type Aggregated = {
  direction: 'in' | 'out'
  walletAccountCode: string
  counterpartyGl: string
  usd: number
  className: string | null
  vendorName: string | null
}

function aggregateMainLines(txs: TxForPost[]): Aggregated[] {
  const buckets = new Map<string, Aggregated>()
  for (const t of txs) {
    const className = t.className ?? null
    const vendorName = t.vendorName ?? null
    const key = `${t.direction}::${t.walletAccountCode}::${t.counterpartyGl}::${className ?? ''}::${vendorName ?? ''}`
    const existing = buckets.get(key)
    if (existing) {
      existing.usd = round2(existing.usd + t.usd)
    } else {
      buckets.set(key, {
        direction: t.direction,
        walletAccountCode: t.walletAccountCode,
        counterpartyGl: t.counterpartyGl,
        usd: round2(t.usd),
        className,
        vendorName,
      })
    }
  }
  return [...buckets.values()]
}

function buildMainPair(
  agg: Aggregated,
  resolve: AccountResolver,
  resolveClass: (name: string) => { value: string; name?: string } | null,
  resolveVendor: (name: string) => { value: string } | null,
): QbJournalEntryLine[] {
  // Inflow: Debit Wallet GL, Credit Counterparty GL.
  // Outflow: Debit Counterparty GL (AP-side, may carry vendor ref), Credit Wallet GL.

  // Resolve ClassRef once — shared by both lines.
  const classRef = agg.className != null ? resolveClass(agg.className) ?? undefined : undefined

  const walletDetail: QbJournalEntryLine['JournalEntryLineDetail'] = {
    PostingType: agg.direction === 'in' ? 'Debit' : 'Credit',
    AccountRef: resolve(agg.walletAccountCode),
  }
  if (classRef !== undefined) walletDetail.ClassRef = classRef

  const walletLine: QbJournalEntryLine = {
    DetailType: 'JournalEntryLineDetail',
    Amount: agg.usd,
    JournalEntryLineDetail: walletDetail,
  }

  const cpDetail: QbJournalEntryLine['JournalEntryLineDetail'] = {
    PostingType: agg.direction === 'in' ? 'Credit' : 'Debit',
    AccountRef: resolve(agg.counterpartyGl),
  }
  if (classRef !== undefined) cpDetail.ClassRef = classRef

  // Vendor ref attaches to the counterparty line regardless of direction — this
  // is the line that hits the counterparty/AP account (Debit on an outflow,
  // Credit on an inflow). Matches V1 (selector is `lineAcctId === cpId`, not
  // gated on direction or posting type) and satisfies QB's requirement that
  // A/P-account lines carry an Entity. Never attaches to the wallet line.
  if (agg.vendorName != null) {
    const resolved = resolveVendor(agg.vendorName)
    if (resolved !== null) {
      cpDetail.Entity = { Type: 'Vendor', EntityRef: { value: resolved.value } }
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

function buildGainPair(
  walletAccountCode: string,
  gain: number,
  resolve: AccountResolver,
  classRef: { value: string; name?: string } | undefined,
  gainLossGl: string,
): QbJournalEntryLine[] {
  // gain > 0 (profit): Credit gain/loss GL + Debit Wallet GL (reduces net asset
  //                    credit to cost basis; records realized gain).
  // gain < 0 (loss):   Debit gain/loss GL + Credit Wallet GL (records realized loss).
  const abs = round2(Math.abs(gain))
  const isProfit = gain > 0
  const glDetail: QbJournalEntryLine['JournalEntryLineDetail'] = {
    PostingType: isProfit ? 'Credit' : 'Debit',
    AccountRef: resolve(gainLossGl),
  }
  if (classRef !== undefined) glDetail.ClassRef = classRef
  const walletDetail: QbJournalEntryLine['JournalEntryLineDetail'] = {
    PostingType: isProfit ? 'Debit' : 'Credit',
    AccountRef: resolve(walletAccountCode),
  }
  if (classRef !== undefined) walletDetail.ClassRef = classRef
  return [
    { DetailType: 'JournalEntryLineDetail', Amount: abs, JournalEntryLineDetail: glDetail },
    { DetailType: 'JournalEntryLineDetail', Amount: abs, JournalEntryLineDetail: walletDetail },
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

  // Class/vendor resolvers — preview defaults return the raw name so JEs remain
  // human-readable. Real posts supply actual catalog resolvers (may return null
  // for missing names, which causes the ref to be omitted).
  const resolveClass = args.resolveClass ?? ((n) => ({ value: n }))
  const resolveVendor = args.resolveVendor ?? ((n) => ({ value: n }))
  const gainLossGl = args.gainLossGl ?? GAIN_LOSS_GL_DEFAULT

  // 1. Main debit/credit pairs (aggregated across bulk members).
  for (const agg of aggregateMainLines(args.txs)) {
    lines.push(...buildMainPair(agg, resolve, resolveClass, resolveVendor))
  }

  // 2. Gain/loss splits — only for outflows of non-stable tokens with non-zero
  //    ST or LT gain. Each non-zero component yields its own pair (matches v1).
  //    Bulk groups: sum ST and LT separately across members (per wallet+class so
  //    different classes produce separate gain lines with the correct ClassRef).
  type GainAccum = { stGain: number; ltGain: number; className: string | null }
  const gainBuckets = new Map<string, GainAccum>()
  for (const t of args.txs) {
    if (t.direction !== 'out') continue
    if (STABLE_TOKENS.has(t.asset)) continue
    const className = t.className ?? null
    const key = `${t.walletAccountCode}::${className ?? ''}` // pivot on wallet GL + class
    const existing = gainBuckets.get(key) ?? { stGain: 0, ltGain: 0, className }
    existing.stGain += t.gain.stGain ?? 0
    existing.ltGain += t.gain.ltGain ?? 0
    gainBuckets.set(key, existing)
  }
  for (const [key, { stGain, ltGain, className }] of gainBuckets) {
    const walletAccountCode = key.split('::')[0]
    const stRounded = round2(stGain)
    const ltRounded = round2(ltGain)
    const classRef = className != null ? resolveClass(className) ?? undefined : undefined
    if (stRounded !== 0) lines.push(...buildGainPair(walletAccountCode, stRounded, resolve, classRef, gainLossGl))
    if (ltRounded !== 0) lines.push(...buildGainPair(walletAccountCode, ltRounded, resolve, classRef, gainLossGl))
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
