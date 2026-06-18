/** Shared TypeScript types — mirrors v1 data structures */

export interface Wallet {
  address: string
  label: string
  chain: string
  entity: string
  accountCode: string | null
  qbVendorName?: string | null
  qbClassName?: string | null
  type: 'internal' | 'external'
  hiddenFromFinance: boolean
  needsBackfill: boolean
  lastFullBackfillAt: string | null
  // Wave 2c — when true, transactions on this wallet are grouped by
  // (token, month) into a single bulk QB journal entry on post.
  isBulkTreasury?: boolean
  // Task 13b — per-token GL mappings; empty array when none are set.
  tokenGls?: { tokenSymbol: string; accountCode: string }[]
  createdAt: string
  updatedAt: string
  balances?: Record<string, number>
  totalUSD?: number
}

export interface Transaction {
  txHash: string
  walletAddr: string
  wallet: string
  entity: string
  blockTime: number
  date: string
  asset: string
  qty: number
  dir: 'In' | 'Out'
  price: number | null
  usd: number | null
  priceSource: string | null
  counterparty: string | null
  category: string | null
  // ---- enrichment (populated server-side via JOINs; undefined when the producer didn't compute them,
  //      null when joined but no match). Marked optional (`?`) so existing producers like
  //      lib/cron/fetch-transactions.ts:27 (moveToTx) and inline test fixtures keep compiling without edits.
  counterpartyLabel?: string | null
  stGain?: number | null
  ltGain?: number | null
  realizedTerm?: 'ST' | 'LT' | 'mixed' | null
  internal?: boolean | null
  internalPairedWalletAddr?: string | null
  noBasis?: boolean | null
  lots?: LotTraceEntry[] | null
  // Wave 2 — populated by the server's tx_qb_state JOIN. id is optional because
  // the cron's moveToTx (lib/cron/fetch-transactions.ts:27) constructs Transaction
  // objects without it; in practice every row that flows through getTreasuryTransactions
  // has id populated from the DB row.
  id?: string
  description?: string | null      // user-saved override; null = use descriptionDefault
  descriptionDefault?: string      // computed via defaultDescription(); server populates
  // Wave 2b — GL accounts surfaced from joins:
  walletGlAccount?: string | null       // wallet.accountCode (read-only display)
  counterpartyGlAccount?: string | null // counterparty_gl_map.gl_account_number
  glAccountOverride?: string | null     // tx_qb_state.gl_account_override
  counterpartyGlOverride?: string | null// tx_qb_state.counterparty_gl_override
  // Wave 2c — qb_post fields surfaced via tx_qb_state.post_id → qb_post LEFT JOIN.
  // qbPostId is the FK value itself; null/undefined = unposted. The other three
  // are projected from the qbPost row and are null when no post exists.
  qbPostId?: string | null
  qbPostingStatus?: 'unposted' | 'posted' | 'posted_modified' | 'posted_manually' | 'voided' | 'failed' | null
  qbDocNumber?: string | null
  qbJournalEntryId?: string | null
  // Hotfix backstop — true when the post-POST duplicate scan saw >1 JE in QB
  // with the same DocNumber + TxnDate. Surfaced as a "⚠ dup" badge in the
  // QB Status column so the user knows to manually void the extra entry.
  // Derived from qb_post.duplicate_warning_at IS NOT NULL.
  qbDuplicateWarning?: boolean | null
  // Task 10 — effective GL + provenance. effectiveGlAccount is the GL number that
  // was (or would be) posted: for posted rows this is the faithful immutable
  // snapshot from tx_qb_state.posted_gl_account; for unposted rows it is the
  // live resolution of override → per-token → wallet default.
  effectiveGlAccount?: string | null
  glSource?: 'override' | 'token' | 'default' | null
  isPosted?: boolean
  // Task 2 (vendor/class) — counterparty wallet defaults, per-tx overrides, and
  // effective resolved values. Follows the same posted-snapshot vs. live pattern
  // as effectiveGlAccount: posted rows use the immutable snapshot (postedVendor/
  // postedClass written at post time); unposted rows resolve live from per-tx
  // override → counterparty wallet default → null.
  counterpartyVendorName?: string | null
  counterpartyClassName?: string | null
  vendorOverride?: string | null
  classOverride?: string | null
  effectiveVendor?: string | null
  effectiveClass?: string | null
}

export interface TransactionSummary {
  inflowsUSD: number
  outflowsUSD: number
  netUSD: number
}

export interface TransactionsResponse {
  transactions: Transaction[]
  total: number
  limit: number
  offset: number
  summary: TransactionSummary
}

export interface Prices {
  SOL?: number
  ORCA?: number
  USDC?: number
  USDT?: number
  [key: string]: number | undefined
}

export type PriceSourceTag = 'birdeye' | 'defillama' | 'stable' | 'cache' | 'genesis' | 'ln'
export type PriceKind = 'close' | 'live'
export interface PriceMeta {
  source: PriceSourceTag
  kind: PriceKind
}

export interface BalanceSnapshot {
  date: string
  fetchedAt: string
  prices: Prices
  balances: Record<string, Record<string, number>>
}

export interface TreasuryOverviewWallet extends Wallet {
  balances: Record<string, number>
  tokenUsd: Record<string, number>
  totalUSD: number
}

export interface TreasuryOverviewEntityTotal {
  tokens: Record<string, number>
  tokenUsd: Record<string, number>
  totalUSD: number
  walletCount: number
}

export interface TreasuryOverviewTokenTotal {
  amount: number
  usd: number
  walletCount: number
}

export interface TreasuryOverviewDrilldownRow {
  walletAddr: string
  walletLabel: string
  entity: string
  totalUSD: number
  tokenAmounts: Record<string, number>
  tokenUsd: Record<string, number>
}

export interface TreasuryOverviewDrilldown {
  key: string
  title: string
  accentColor: string
  walletCount: number
  subtotalUSD: number
  portfolioPct: number
  rowTokens: string[]
  showEntityColumn: boolean
  rows: TreasuryOverviewDrilldownRow[]
}

export interface TreasuryOverviewTrendPoint {
  date: string
  totalUsd: number
  tokenAmounts: Record<string, number>
  tokenUsd: Record<string, number>
}

export interface TreasuryOverviewTrendResponse {
  walletAddr: string
  tokens: string[]
  points: TreasuryOverviewTrendPoint[]
  firstDate: string | null
  lastDate: string | null
  source: PriceSourceTag
}

export interface TreasuryOverview {
  prices: Prices
  priceMeta: Record<string, PriceMeta>
  wallets: TreasuryOverviewWallet[]
  entityTotals: Record<string, TreasuryOverviewEntityTotal>
  tokenTotals: Record<string, TreasuryOverviewTokenTotal>
  snapshotDate: string | null
  fetchedAt: string | null
  grandTotalUSD: number
}

export interface GainLossEntry {
  wallet: string
  walletAddr: string
  entity: string
  asset: string
  qty: number
  buyPrice: number
  sellPrice: number
  buyDate: string
  soldDate: string
  gain: number
  term: 'ST' | 'LT'
  txHash: string
}

export interface GainLossSummary {
  totalGain: number
  shortTermGain: number
  longTermGain: number
  dispositions: number
  tokens: string[]
}

export interface GainLossPagination {
  page: number
  pageSize: number
  totalRows: number
  hasMore: boolean
}

export interface GainLossResponse {
  gainLoss: GainLossEntry[]
  summary: GainLossSummary
  pagination: GainLossPagination
}

export interface TreasuryManagementProtocolError {
  protocol: string
  message: string
}

export interface TreasuryManagementSnapshotPosition {
  protocol: string
  chain: string
  walletAddress: string
  asset: string
  assetAddress: string
  totalBalance: string
  principal: string
  yield: string
  balanceUsd: string
  principalUsd: string
  yieldUsd: string
  positionKey?: string
  trackedPositionId?: string | null
  principalSource?: 'deployed' | 'received' | 'mixed' | 'unknown' | null
  platform?: string
  vaultLabel?: string | null
  fundedUsd?: string | null
  fundedAt?: string | null
  deployedPrincipalUsd?: string | null
  deployedAt?: string | null
  marketTvlUsd?: string | null
  yieldPct?: string | null
}

export interface TreasuryManagementSnapshotWallet {
  walletAddress: string
  chain: string
  label: string
  positions: TreasuryManagementSnapshotPosition[]
  errors?: TreasuryManagementProtocolError[]
  fetchedAt: string
}

export interface TreasuryManagementSnapshot {
  wallets: TreasuryManagementSnapshotWallet[]
  totalUsd: string
  snapshotAt: string
}

export interface TreasuryManagementPosition {
  protocol: string
  chain: string
  entity: string
  walletAddr: string
  walletLabel: string
  accountCode: string | null
  asset: string
  assetAddress: string
  totalBalance: number
  principal: number
  yield: number
  balanceUsd: number
  principalUsd: number
  yieldUsd: number
  positionKey: string | null
  trackedPositionId: string | null
  principalSource: 'deployed' | 'received' | 'mixed' | 'unknown' | null
  platform: string
  vaultLabel: string | null
  fundedUsd: number | null
  fundedAt: string | null
  deployedPrincipalUsd: number | null
  deployedAt: string | null
  marketTvlUsd: number | null
  yieldPct: number | null
}

export interface TreasuryManagementWalletSummary {
  walletAddr: string
  walletLabel: string
  sourceLabel: string
  entity: string
  chain: string
  accountCode: string | null
  totalUsd: number
  positionCount: number
  protocols: string[]
  errors: TreasuryManagementProtocolError[]
  fetchedAt: string | null
}

export interface TreasuryManagementEntitySummary {
  entity: string
  walletCount: number
  positionCount: number
  totalUsd: number
  yieldUsd: number
}

export interface TreasuryManagementSummary {
  totalUsd: number
  principalUsd: number
  yieldUsd: number
  walletCount: number
  positionCount: number
  protocolCount: number
  walletsWithErrors: number
}

export interface TreasuryManagementWalletRegistryEntry {
  address: string
  label: string
  entity: string
  accountCode: string | null
  chain: string
}

export interface TreasuryManagementWalletRegistry {
  generatedAt: string
  wallets: TreasuryManagementWalletRegistryEntry[]
}

export interface TreasuryManagementResponse {
  hasSnapshot: boolean
  snapshotAt: string | null
  sourceFile: string | null
  entities: TreasuryManagementEntitySummary[]
  summary: TreasuryManagementSummary
  wallets: TreasuryManagementWalletSummary[]
  positions: TreasuryManagementPosition[]
}

export interface UnrealizedEntry {
  wallet: string
  walletAddr: string
  entity: string
  asset: string
  qty: number
  costBasis: number
  currentPrice: number
  unrealGain: number
}

export type Entity = 'Opco' | 'Foundation' | 'Juku' | 'Zagreus'

// ── ORCA Ledger ─────────────────────────────────────────────────────────────
// Per-acquisition-lot contribution to a single tx.
// External Out: each lot consumed by this disposal.
// External In:  one entry describing the lot just created.
// Internal In:  one entry per lot moved from sender's queue (cost basis preserved).
// Internal Out: empty (no realization; basis just moved).
export interface LotTraceEntry {
  qty: number              // qty taken from / added to this lot for this tx
  costPerUnit: number      // $ per unit on the lot
  acqDate: string          // ISO — the lot's original acquisition date
  acqTxHash: string        // for click-to-jump back to source row
  acqWalletAddr: string    // important for internal transfers
  daysHeld: number         // (txDate - acqDate) / 86400
  term: 'ST' | 'LT'        // <365 days = ST
  gain: number             // disposal-only: proceeds - cost; In rows = 0
}

// Public projection of an open lot (engine's internal Lot type stays internal).
export interface OpenLotView {
  entity: string
  asset: string
  wallet: string
  walletAddr: string
  qty: number
  costPerUnit: number
  acqDate: string
}

// Full enrichment of a single ORCA tx row.
export interface OrcaLedgerRow {
  txHash: string
  walletAddr: string
  wallet: string
  entity: string
  blockTime: number
  date: string
  asset: 'ORCA'
  qty: number
  dir: 'In' | 'Out'
  price: number | null
  usd: number | null
  priceSource: string | null
  counterparty: string | null
  counterpartyLabel: string | null
  counterpartyEntity: string | null
  internal: boolean
  internalPairedWalletAddr: string | null
  internalPairedWalletLabel: string | null
  balanceAfter: number
  lots: LotTraceEntry[]
  realizedGain: number
  realizedTerm: 'ST' | 'LT' | 'mixed' | null
  noBasis: boolean
}

export interface OrcaWalletSummary {
  walletAddr: string
  wallet: string
  totalQty: number
  avgCostPerUnit: number
  remainingLots: { qty: number; costPerUnit: number; acqDate: string }[]
  lifetimeRealizedGain: number
  noBasis: boolean
}

export interface OrcaLedgerResponse {
  rows: OrcaLedgerRow[]
  summaryByWallet: Record<string, OrcaWalletSummary>
  computedAt: string
}

// ── Unrealized ─────────────────────────────────────────────────────────────
export interface UnrealizedPosition {
  entity: string
  asset: string
  wallet: string
  walletAddr: string
  qty: number
  costBasis: number
  avgCostPerUnit: number
  currentPrice: number | null
  currentValue: number | null
  unrealGain: number | null
  returnPct: number | null
  acqDateMin: string
  acqDateMax: string
  lotCount: number
  priorPrice: number | null
  currentPriceSource: PriceSourceTag
  priorPriceSource: PriceSourceTag
  priorValue: number | null
  deltaMonth: number | null
}

export interface UnrealizedLot {
  entity: string
  asset: string
  wallet: string
  walletAddr: string
  acqDate: string
  qty: number
  costPerUnit: number
  costBasis: number
  currentPrice: number | null
  currentValue: number | null
  unrealGain: number | null
  returnPct: number | null
}

export interface UnrealizedResponse {
  positions: UnrealizedPosition[]
  lots: UnrealizedLot[]
  asOf: string | null
  priorAsOf: string | null
  monthsAvailable: string[]
  walletOptions: Array<{ walletAddr: string; wallet: string }>
  tokenOptions: string[]
  missingPrices: string[]
  computedAt: string
}
