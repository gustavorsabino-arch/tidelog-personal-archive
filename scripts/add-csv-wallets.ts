// One-off: insert the 21 CSV-only Opco wallets into app.wallet.
//
// All wallets: chain='SOL', entityId='opco', isExternal=false, accountCode=null.
// Five [Test]/(Testing) wallets get includeInOverview=false so they don't
// pollute finance reporting; the other 16 default to includeInOverview=true.
//
// Backfill is NOT triggered here — run as a separate step once we're happy
// with the wallets in the registry.
//
// Idempotent: onConflictDoNothing skips any address already present, so this
// script is safe to re-run.
//
//   cd /Users/orca/Projects/tidelog-v2 && bun scripts/add-csv-wallets.ts
//
// Reads DB connection from .env.local via lib/db.

import { db } from '../lib/db'
import { wallet } from '../lib/db/schema/reference'
import { logAudit } from '../lib/audit'

type W = { address: string; label: string; includeInOverview: boolean }

// 16 wallets — default visibility in Overview.
const STANDARD: W[] = [
  { address: '4SeDRs3yV5Ld27emtXi8aNvAeR7u8Ha9ttJ3GMK6az6y', label: 'Fireblocks - Eclipse Funds', includeInOverview: true },
  { address: '6FmYt5Pfw2jUyKiLdYvA5sCjqf5rc2RZMXyqKxzFMQ9F', label: 'Fireblocks - MM - Vamient', includeInOverview: true },
  { address: 'FSXJcr1E7HCEFZ9GVigpDpj9uaFGNn9Uk4zU7rHyWZhT', label: 'Fireblocks - MM - Velar', includeInOverview: true },
  { address: '9XP3Us9tm8QLNS1zyM5jhqcypKyGuHNLbhZdfEQ8NqMi', label: 'Fireblocks - Rewards - Galaxy Validator Reward', includeInOverview: true },
  { address: '4Sz8UuJ2Vuic4uhx9LgvfnX6Y17yQxzPmuDKTjMgZY7q', label: 'Fireblocks (Engineering) - TreasureHunt', includeInOverview: true },
  { address: 'EA3pngfdYiwqDezaPoorX4SixQeYAKVgdHF81Z24UyPJ', label: 'Fireblocks (Engineering) - Transaction Fuel', includeInOverview: true },
  { address: '4y8H9ke4kJXqqXJRkFrqW7GqhwELAWXx8HQruidAzXYa', label: 'Fireblocks (Engineering) - [Live] USDC-USDT-HAT-1', includeInOverview: true },
  { address: 'aacXtmneYTJugGhDw21Cp3kwmn6jnEqqFtekkvPjkdE', label: 'Fireblocks (Engineering) - [Live] USDG-USDC-HAT-1', includeInOverview: true },
  { address: 'HfuniF9MJAaQ74z9peU8zeKLWnjnUPpVMZwxZ3eLPLj4', label: 'Fireblocks (Engineering) - [Live] cbBTC-wBTC-HAT-1', includeInOverview: true },
  { address: '71qCZGiDjCMD8RiiqbjuDgkAehgN2jKQ4c54hHdYzswY', label: 'Fireblocks (Engineering) - [Live] xORCA-ORCA-2', includeInOverview: true },
  { address: 'fv4tMzfT7aXU7j93DBXfT6AADB1YvwpTh1rjDPv8Mso', label: 'Fireblocks (Engineering) - [Live] USDC-USDT-TICK-CHASING-1', includeInOverview: true },
  { address: 'CGYAxnDF1bYwmbzTtVx2pdo8xd3aviqE58WumVYRLYRH', label: 'Fireblocks (Engineering) - PAMM - Internal Strategies', includeInOverview: true },
  { address: '2qbZU1snfdQM1Gqg4AMcNMw32mTa9ao6PNaseS4TLFio', label: 'Fireblocks (Engineering) - Treasure Hunt Funds - Engineering', includeInOverview: true },
  { address: '8pTegn1H9PkrWsnK5kwWgRQh5i9CNm2KLsxj1wCVxfDM', label: 'Phantom - PAMM Perps Hot Wallet Funded by Treasure Hunt', includeInOverview: true },
  { address: 'BXqUyiFi7ghZ3oXddWPz9Sp8juE9jwXRzQYE5BccnaHb', label: 'Phantom - Orca Shirt Sales', includeInOverview: true },
  { address: 'rrtoqwBRgBa8Pzuwk4HnqjzNJ4sbpPxR5KfGXv7xpFN', label: 'Phantom - PAMM Hot Wallet Funded by DAO', includeInOverview: true },
]

// 5 [Test]/(Testing) wallets — hidden from Overview, still tracked in registry.
// Flip include_in_overview to true later via SQL or (soon) the Wallets UI.
const TEST: W[] = [
  { address: 'vmQBLgdyX4VxaBH7n6pczRg4d6v69KtW35sGAeuXJsv', label: 'Fireblocks (Engineering) - [Test] USDC-USDT-1-HAT-AC', includeInOverview: false },
  { address: 'F3kyYNB8fiy1pGBeQfkaWjKwWDixE5ezPD87pKYdLTzA', label: 'Fireblocks (Engineering) - [Test] xORCA-ORCA-2-Escalator', includeInOverview: false },
  { address: '2PEcXj9jMLHZexPUi1YoNYe2sosomqRghUmGuY5fURkN', label: 'Phantom - TreasureHunt 1 - PYUSD-USDT-HAT (Testing) Funded by Treasure Hunt', includeInOverview: false },
  { address: '5cMFiRs2WCE9ACsb1HWrAQXo4g6Ve1FZDyfwHzdo5BVV', label: 'Phantom - TreasureHunt 2 - PYUSD-USDT-USDC-1-Hat (Testing) Funded by Treasure Hunt', includeInOverview: false },
  { address: '4Jzm5Xe5C22uDEsfh6dTjeGeui7GGj3gVjLtuedHd7Wg', label: 'Phantom - TreasureHunt 3 (Testing) Funded by Treasure Hunt', includeInOverview: false },
]

const all = [...STANDARD, ...TEST]

console.log(`[add-csv-wallets] inserting ${all.length} wallets (${STANDARD.length} standard + ${TEST.length} hidden) under entity=opco, chain=SOL`)

const values = all.map((w) => ({
  address: w.address,
  label: w.label,
  chain: 'SOL',
  entityId: 'opco',
  accountCode: null,
  isExternal: false,
  overviewOnly: false,
  includeInOverview: w.includeInOverview,
}))

const inserted = await db
  .insert(wallet)
  .values(values)
  .onConflictDoNothing()
  .returning({ address: wallet.address, label: wallet.label, includeInOverview: wallet.includeInOverview })

console.log(`[add-csv-wallets] inserted ${inserted.length} new wallets (skipped ${all.length - inserted.length} duplicates)`)
for (const w of inserted) {
  const tag = w.includeInOverview ? '' : '  [hidden from overview]'
  console.log(`  ${w.address}  ${w.label}${tag}`)
}

// Audit-log each insert so there's a trail for "where did this wallet come from".
let auditFailures = 0
for (const w of inserted) {
  try {
    await logAudit({
      userId: null,
      action: 'admin.wallet.created',
      metadata: {
        address: w.address,
        label: w.label,
        chain: 'SOL',
        entityId: 'opco',
        source: 'scripts/add-csv-wallets.ts',
      },
    })
  } catch (e) {
    auditFailures++
    console.warn(`[audit] failed for ${w.address}: ${(e as Error).message}`)
  }
}
if (auditFailures > 0) {
  console.warn(`[add-csv-wallets] ${auditFailures} audit log writes failed (wallets are still inserted)`)
}

process.exit(0)
