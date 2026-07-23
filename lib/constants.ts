/** Constants extracted from v1 index.html */

// API base — relative in v2 (same origin, Next.js API routes)
export const PROXY_BASE = ''

export const ENTITIES = ['Opco', 'Foundation', 'Juku', 'Zagreus'] as const
export const BUDGET_ENTITIES = ['Opco', 'Foundation', 'Zagreus'] as const

export const FOCUS_TOKENS = ['SOL', 'ORCA', 'USDC', 'USDT', 'PYUSD', 'USDG'] as const

// STABLE_TOKENS drives the 1:1 USD valuation in getTokenUsdValue. USD (bank
// cash) is included so bank balances price as $1 without needing a Birdeye
// entry.
export const STABLE_TOKENS = new Set(['USDC', 'USDT', 'PYUSD', 'USDG', 'USD'])

// BANK_TOKENS is a UI-only category: the Overview renders these in a
// separate "Bank" card instead of aggregating them into "Stablecoins".
// A token in BANK_TOKENS should also be in STABLE_TOKENS (for 1:1 pricing).
export const BANK_TOKENS = new Set(['USD'])

export const TOKEN_COLORS: Record<string, string> = {
  SOL: '#9945ff',
  ORCA: '#00A8A8',
  USDC: '#2775ca',
  USDT: '#26a17b',
  PYUSD: '#0052FF',
  USDG: '#1a365d',
  ETH: '#627EEA',
  USD: '#4C9F70',
  default: '#6b7a8d',
}

export const ENTITY_COLORS: Record<string, string> = {
  Opco: '#2775ca',
  Foundation: '#9945ff',
  Juku: '#06D6A0',
  Zagreus: '#D4A017',
}

// Token mint addresses
export const ORCA_MINT = 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE'

export const PRICE_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  ORCA: ORCA_MINT,
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  PYUSD: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  USDG: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
}

export const KNOWN_MINTS: Record<string, string> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': 'PYUSD',
  '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH': 'USDG',
  'So11111111111111111111111111111111111111112': 'SOL',
  'So11111111111111111111111111111111111111111': 'SOL',
  [ORCA_MINT]: 'ORCA',
}

// Focus token set (used by balance fetcher, tx indexer, and parsing)
export const FOCUS_SET = new Set<string>(FOCUS_TOKENS)

// Mint → symbol lookup (shared across cron routes)
export function getSym(mint: string): string | null {
  return KNOWN_MINTS[mint] || null
}

// Budget departments
export const BUDGET_DEPTS = [
  'General', 'Ops', 'Finance', 'Legal',
  'Product', 'Engineering', 'Marketing', 'Business Development',
] as const

// Wallets earmarked for the buyback programme (ORCA Buyback + Market Maker
// counterparties). Used by the Overview "By Purpose" section to split
// wallets into "Owned by the Team" vs "BuyBack". Match is exact against
// wallet.label — if Kate renames one of these in /wallets, update here.
export const BUYBACK_WALLET_LABELS = new Set<string>([
  'ORCA Buyback - FlowDesk',
  'ORCA Buyback - Team',
  'ORCA Buyback (Intermediary - Wintermute)',
  'ORCA Buyback 1',
  'ORCA Buyback 2',
  'ORCA Buyback 3',
  'ORCA Buyback 4',
  'ORCA Buyback 5',
  'ORCA Buyback 6',
  'ORCA Buyback 7',
  'ORCA Buyback 8',
  'MM - Wintermute',
  'MM - Vamient',
  'MM - Velar',
  'MM - Keyrock',
])

// Normalize a wallet label for tolerant comparison — collapses whitespace
// and lowercases. Handles typos/spacing drift between the image Kate sent
// and what's actually in the DB (e.g. "ORCA Buyback  1" vs "ORCA Buyback 1").
function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

const BUYBACK_LABELS_NORMALIZED = new Set(
  Array.from(BUYBACK_WALLET_LABELS).map(normalizeLabel),
)

// Names of the MM-partner counterparties that live in the buyback bucket.
// Match uses CONTAINS on the normalized label so spacing/prefix drift is
// tolerated ("MM - Wintermute" / "MM-Wintermute" / "Mm Wintermute" all pass).
const BUYBACK_MM_NAMES = ['wintermute', 'vamient', 'velar', 'keyrock'] as const

export function isBuybackWallet(label: string): boolean {
  if (!label) return false
  const n = normalizeLabel(label)
  // Exact (normalized) match against the curated 15-label list.
  if (BUYBACK_LABELS_NORMALIZED.has(n)) return true
  // Broad match on 'buyback' anywhere in the label — catches any spacing
  // / prefix variant Kate uses ('ORCABuyback 9', 'orca-buyback-team', etc).
  if (n.includes('buyback')) return true
  // MM-partner wallets: must contain the counterparty name AND have an 'mm'
  // marker (prefix or ' mm ' word) so we don't falsely match unrelated
  // wallets that happen to include the counterparty name.
  const hasMmMarker = n.startsWith('mm ') || n.startsWith('mm-') || n.startsWith('mm:') || / mm[- ]/.test(` ${n}`)
  if (hasMmMarker && BUYBACK_MM_NAMES.some(name => n.includes(name))) return true
  return false
}

// Wallets in the "Fully Allocated" bucket (funds committed to specific
// mandates — Bug Bounty pool, Council allocation, etc). Excluded from
// "Owned by the Team" so the team-owned figure reflects only free/liquid
// treasury.
export const FULLY_ALLOCATED_WALLET_LABELS = new Set<string>([
  'Bug Bounty',
  'Foundation - Pool Ops',
  'Orca Council',
  'Pool Ops',
  'Climate Fund',
])

const FULLY_ALLOCATED_LABELS_NORMALIZED = new Set(
  Array.from(FULLY_ALLOCATED_WALLET_LABELS).map(normalizeLabel),
)

export function isFullyAllocatedWallet(label: string): boolean {
  if (!label) return false
  const n = normalizeLabel(label)
  // CONTAINS match — catches suffix drift like "Climate Fund - OpCo" /
  // "Bug Bounty (Foundation)" that would miss an exact-string check.
  for (const allocated of FULLY_ALLOCATED_LABELS_NORMALIZED) {
    if (n.includes(allocated)) return true
  }
  return false
}

// A wallet is "Owned by the Team" iff it is neither buyback nor fully-allocated.
export function isOwnedByTeamWallet(label: string): boolean {
  return !isBuybackWallet(label) && !isFullyAllocatedWallet(label)
}
