// One-off: insert the 29-30 missing Solana wallets from finance's sheet diff.
//
// All chain='SOL', isExternal=false, overviewOnly=false, includeInOverview=true,
// accountCode=null. Entity per the spreadsheet (foundation / opco / zagreus).
//
// The "Test Vault for Devs" wallet was tagged "Technically by the Dao" in the
// sheet — mapped to opco here since that's the closest of the 4 entities and
// matches the "Managed by OpCo" note elsewhere in the sheet.
//
// The 7HCqB4fcKYFz7TKzx[w]mAJN6DiU5XRUr[h]E2hgVfMoAGSy entry is included by
// default. Comment it out if Solscan verification shows it's actually a typo
// of the existing 7HCqB4fcKYFz7TKzx[v]mAJN6DiU5XRUr[H]E2hgVfMoAGSy.
//
// Idempotent: onConflictDoNothing skips any already-present address.
// Backfill is NOT triggered.
//
//   bun scripts/add-missing-solana-wallets.ts   # local DB (likely no-op)
//   scripts/add-missing-solana-wallets-prod.sh  # production

import { db } from '../lib/db'
import { wallet } from '../lib/db/schema/reference'
import { logAudit } from '../lib/audit'

type W = { address: string; label: string; entityId: 'foundation' | 'opco' | 'zagreus' | 'juku' }

const TO_ADD: W[] = [
  // Foundation (17)
  { address: '6c828EcfUcjzRdwtAPjr2B32NqDjLAHYuHsYnLR4t6TM', label: 'ALT Indexer Wallet', entityId: 'foundation' },
  { address: 'EHTUALsEZLxQMCU3GJrnsqNSJsUeuM2rc3s8G662MibA', label: 'Circle - Foundation', entityId: 'foundation' },
  { address: 'C4zqiEgbBTPTNajdBDMb2MA3LyeiKn78tmg9q2HieNmU', label: 'Fireblocks - Airdrop', entityId: 'foundation' },
  { address: '38cJgZgAisoGayX4BzRdaaACvMagteF14DhDTkG8VCiz', label: 'Fireblocks - Default', entityId: 'foundation' },
  { address: 'EaegSTCtCaVD74eUKTWifV669ETjPneMkRE7e6Mthw49', label: 'Fireblocks - Network Deposits', entityId: 'foundation' },
  { address: 'W1YodmnUv76BpZCCt681ABBeffLoWtJ6hDszFMtUauL', label: 'Fireblocks - Foundation Airdrops', entityId: 'foundation' },
  { address: '6BLTtBS9miUZruZtR9reTzp6ctGc4kVY4xrcxQwurYtw', label: 'Protocol Fee Setter Wallet', entityId: 'foundation' },
  { address: 'DaQM6b6dbxShqjRdaxPEgMorgjtRtdpfPJWkWYrKgNPa', label: 'Treasury Converter Wallet', entityId: 'foundation' },
  { address: '6ZRCB7AAqGre6c72PRz3MHLC73VMYvJ8bi9KHf1HFpNk', label: 'Foundation - FTX', entityId: 'foundation' },
  { address: 'HVxKTKbv3vcmYEBYkZFZh88nLp1Ve4hUwXQjzczGJFcZ', label: 'Foundation - Fundraise', entityId: 'foundation' },
  { address: 'F8VMNGZSfWNqkNbTK1kyytUf1wpJto3ceCsWhg2iSRr7', label: 'Orca Foundation - Phantom (Kiko Operates)', entityId: 'foundation' },
  { address: 'Buh5Dk3vovaATpcgfCRZjgi7ukjSwTAtMJcCL2X4Kzfd', label: 'Ledger Nano - (TZ Operates)', entityId: 'foundation' },
  { address: 'E3G6ujBGbusExBAPL5hg62xu5ncWeVh9CLjU9qbusVvs', label: 'Orcanaut - Magic Eden Royalty Wallet v2', entityId: 'foundation' },
  { address: 'EL91NSCGKtDdH9Zxa3MWewQRUSC3x45GpFewpuhLgZ4d', label: 'Orcanaut - Magic Eden Royalty Wallet', entityId: 'foundation' },
  { address: '6Qub9ja2NMTmJmLtTZk4TqYhmsVt7kXpGYKwqCksTiEg', label: 'Circle - Foundation (EURC)', entityId: 'foundation' },
  { address: '7mkDkvGrDMEsbKarEiZE7CzhG4gpzXcRvs4AxMDvF8Lm', label: 'Nathan Ledger for Reward Emissions', entityId: 'foundation' },
  { address: '4NbHdA4S52zVxw5iJpRtWTXQJtjRv36RNFBj2hpK3bMZ', label: 'Fireblocks Vault - New - Foundation - ORCA Vault', entityId: 'foundation' },

  // Opco / Panama OpCo (6)
  { address: '12dorF2tBj2uD5prSAUipD8KUQtpSoCBsdz8vYcdZwqS', label: 'Fireblocks Vault - Loopscale Partnership', entityId: 'opco' },
  { address: '4qVFTzCxwkxGdaSZVABKfqGBFCeyWhecbQYPEZSai3zD', label: 'Fireblocks Vault - New - Orca Management - ORCA Vault', entityId: 'opco' },
  { address: '8A5mDnwzGXFseoX34Ek5MkRnDA3QieqoW8DUMJbksJbS', label: 'OpCo Airdrop Phantom Wallet', entityId: 'opco' },
  { address: '9oRtAojR9FKq6SkENyE1xCohAk2VsYtoS7TchjpmxkhU', label: 'Old Treasury Fee Wallet', entityId: 'opco' },
  { address: 'B3AvcCKZTcHHCftfVaC7zbwrTJeKuBJZXGwTomCsJzNR', label: 'Sphere - Panama OpCo Phantom Wallet', entityId: 'opco' },
  { address: 'Hi9UHHMnjsUPD1MjVxZLTeafDw7MxmzHfUH5Zo6TCSYt', label: 'Tick Array', entityId: 'opco' },

  // Zagreus (2)
  { address: 'FiHvCXMMPSwKL4L9pAiLqFvhVjRTSSQxxEDKsBen4LhB', label: 'Circle - Zagreus', entityId: 'zagreus' },
  { address: '3v4CvDMNfLkLthXWJwch4RARwMi8NXXDAxj5yBb9ZDgN', label: 'Zagreus Sphere Pay SPL Wallet', entityId: 'zagreus' },

  // DAO-labeled → opco (1)
  { address: '5detsU46W7ue4zHVYn1KgT5mH5Q5e3ATnQD8LAfcx8sa', label: 'Fireblocks - Test Vault for Devs', entityId: 'opco' },

  // Vampire Pool wallets — verified to exist on Solscan (43 chars, valid base58) (3)
  { address: 'aHor21dHAA2ns6E3B9Eygo8Ndki9MikdVLTWFC9XVJP', label: 'Vampire Pool 1 - USD1 LP', entityId: 'opco' },
  { address: 'rrTdwJeNWrBnNXgrWrmapiD394WqCwQHkQdq8YVzUfq', label: 'Vampire Pool 2 - USD1 LP', entityId: 'opco' },
  { address: 'xvrzsm38smFYDqMAQJ2JgEAa8pAbExKffLXCRoaN37k', label: 'Vampire Pool 3 - USD1 LP', entityId: 'opco' },

  // Possible typo of existing 7HCqB4fcKYFz7TKzxvmAJN6DiU5XRUrHE2hgVfMoAGSy — comment out if Solscan confirms it's a typo.
  { address: '7HCqB4fcKYFz7TKzxwmAJN6DiU5XRUrhE2hgVfMoAGSy', label: 'Fireblocks Vault - Intake Wallet 10', entityId: 'opco' },
]

console.log(`[add-missing-solana-wallets] inserting ${TO_ADD.length} wallets`)
console.log(`  foundation: ${TO_ADD.filter((w) => w.entityId === 'foundation').length}`)
console.log(`  opco:       ${TO_ADD.filter((w) => w.entityId === 'opco').length}`)
console.log(`  zagreus:    ${TO_ADD.filter((w) => w.entityId === 'zagreus').length}`)

const values = TO_ADD.map((w) => ({
  address: w.address,
  label: w.label,
  chain: 'SOL',
  entityId: w.entityId,
  accountCode: null,
  isExternal: false,
  overviewOnly: false,
  includeInOverview: true,
}))

const inserted = await db
  .insert(wallet)
  .values(values)
  .onConflictDoNothing()
  .returning({ address: wallet.address, label: wallet.label, entityId: wallet.entityId })

console.log(`[add-missing-solana-wallets] inserted ${inserted.length} new wallets (skipped ${TO_ADD.length - inserted.length} duplicates)`)
for (const w of inserted) {
  console.log(`  [${w.entityId}] ${w.address}  ${w.label}`)
}

let auditFailures = 0
for (const w of inserted) {
  try {
    await logAudit({
      userId: null,
      action: 'admin.wallet.created',
      metadata: { address: w.address, label: w.label, chain: 'SOL', entityId: w.entityId, source: 'scripts/add-missing-solana-wallets.ts' },
    })
  } catch (e) {
    auditFailures++
    console.warn(`[audit] failed for ${w.address}: ${(e as Error).message}`)
  }
}
if (auditFailures > 0) console.warn(`[add-missing-solana-wallets] ${auditFailures} audit log writes failed`)

process.exit(0)
