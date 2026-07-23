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

// Address-based classification for the Overview "By Purpose" section.
// Labels can drift ('ORCA Buyback 1' vs 'Orca Buyback 1' vs 'ORCA Buyback-1'
// etc), addresses can't — Kate's photo shows each wallet's address prefix
// and suffix, so we match on those. `startsWith(prefix) && endsWith(suffix)`
// on a Solana base58 address is effectively unique.
//
// Source of truth: screenshot from Kate (2026-07). If a wallet gets rotated
// (new address), update the entry here.

type AddressPattern = { prefix: string; suffix: string; label: string }

const BUYBACK_ADDRESS_PATTERNS: AddressPattern[] = [
  { prefix: '2qxLG1', suffix: 'L8i8ar', label: 'ORCA Buyback - FlowDesk' },
  { prefix: 'BTUWJU', suffix: 'eFwz3Q', label: 'ORCA Buyback - Team' },
  { prefix: '8dRyge', suffix: 'oXZMda', label: 'ORCA Buyback (Intermediary - Wintermute)' },
  { prefix: 'G2v2mb', suffix: '4qRSYH', label: 'ORCA Buyback 1' },
  { prefix: '4V6tiy', suffix: '4JgwRJ', label: 'ORCA Buyback 2' },
  { prefix: '7gPQyA', suffix: '1cpNQu', label: 'ORCA Buyback 3' },
  { prefix: 'FHmejd', suffix: 'tGf8K9', label: 'ORCA Buyback 4' },
  { prefix: 'HebdVC', suffix: 'rD7147', label: 'ORCA Buyback 5' },
  { prefix: '3JJ55z', suffix: 'PuYiwf', label: 'ORCA Buyback 6' },
  { prefix: 'FMJiNp', suffix: 'ChU1bb', label: 'ORCA Buyback 7' },
  { prefix: '43SAPB', suffix: 'wnn5bi', label: 'ORCA Buyback 8' },
  { prefix: 'B7Azio', suffix: 'dEdQGz', label: 'MM - Wintermute' },
  { prefix: '6FmYt5', suffix: 'zFMQ9F', label: 'MM - Vamient' },
  { prefix: 'FSXJcr', suffix: 'HyWZnT', label: 'MM - Velar' },
  { prefix: '9XG4zF', suffix: 'Pch1Sq', label: 'MM - Keyrock' },
]

const FULLY_ALLOCATED_ADDRESS_PATTERNS: AddressPattern[] = [
  { prefix: '8TMfen', suffix: 'chX1cE', label: 'Bug Bounty' },
  { prefix: 'FNwKaq', suffix: 'Jm6f3d', label: 'Foundation - Pool Ops' },
  { prefix: '5emFju', suffix: 'Quc7Ep', label: 'Orca Council' },
  { prefix: '754rCJ', suffix: 'w7G7rJ', label: 'Pool Ops' },
  { prefix: 'DrhE25', suffix: '3qxh9X', label: 'Climate Fund' },
]

function matchesAnyPattern(address: string, patterns: AddressPattern[]): boolean {
  if (!address) return false
  for (const p of patterns) {
    if (address.startsWith(p.prefix) && address.endsWith(p.suffix)) return true
  }
  return false
}

export function isBuybackWallet(address: string): boolean {
  return matchesAnyPattern(address, BUYBACK_ADDRESS_PATTERNS)
}

export function isFullyAllocatedWallet(address: string): boolean {
  return matchesAnyPattern(address, FULLY_ALLOCATED_ADDRESS_PATTERNS)
}

// A wallet is "Owned by the Team" iff it is neither buyback nor fully-allocated.
export function isOwnedByTeamWallet(address: string): boolean {
  return !isBuybackWallet(address) && !isFullyAllocatedWallet(address)
}
