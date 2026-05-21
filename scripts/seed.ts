// Seeds reference data: entities and tokens only.
//
// Wallets are no longer bundled with the repo — they're registered through
// the admin UI (or inserted via Studio) once the operator has onboarded each
// entity's wallet set. The cron balance fetcher iterates `wallet` rows, so
// an empty `wallet` table simply means no balances are fetched.
//
// Safe to re-run — uses onConflictDoNothing so existing rows are preserved.
//   bun run db:seed

import { db } from '../lib/db'
import { entity, token } from '../lib/db/schema/reference'

// Entities (matching legacy QB realm map + External for counterparties)
await db.insert(entity).values([
  { id: 'opco', name: 'Orca Opco', qbRealmId: process.env.QB_REALM_OPCO ?? null, isActive: true },
  { id: 'foundation', name: 'Orca Foundation', qbRealmId: process.env.QB_REALM_FOUNDATION ?? null, isActive: true },
  { id: 'juku', name: 'Juku', qbRealmId: process.env.QB_REALM_JUKU ?? null, isActive: true },
  { id: 'zagreus', name: 'Zagreus', qbRealmId: process.env.QB_REALM_ZAGREUS ?? null, isActive: true },
  { id: 'external', name: 'External (counterparties)', qbRealmId: null, isActive: true },
]).onConflictDoNothing()

// Tokens tracked by DefiLlama
await db.insert(token).values([
  { symbol: 'SOL', name: 'Solana', decimals: 9, coinId: 'coingecko:solana' },
  { symbol: 'ORCA', name: 'Orca', decimals: 6, coinId: 'coingecko:orca' },
  { symbol: 'USDC', name: 'USD Coin', decimals: 6, coinId: 'coingecko:usd-coin' },
  { symbol: 'USDT', name: 'Tether USD', decimals: 6, coinId: 'coingecko:tether' },
  { symbol: 'ETH', name: 'Ethereum', decimals: 18, coinId: 'coingecko:ethereum' },
  { symbol: 'BTC', name: 'Bitcoin', decimals: 8, coinId: 'coingecko:bitcoin' },
]).onConflictDoNothing()

console.log('seed complete: entities + tokens. Register wallets via the admin UI.')
process.exit(0)
