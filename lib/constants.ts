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
