import { test, expect, mock } from 'bun:test'

// Stub modules that require DB / external config so parseTransaction
// can be imported without a live database.
mock.module('@/lib/db', () => ({ db: {} }))
mock.module('@/lib/db/schema', () => ({ wallet: {}, transaction: {} }))
mock.module('@/lib/helius', () => ({
  heliusRpc: async () => ({ result: [] }),
  heliusEnhanced: async () => [],
  heliusGetAddressTransactions: async () => [],
  heliusGetTokenAccountsByOwner: async () => [],
}))
mock.module('@/lib/transaction-pricing', () => ({
  hydrateTransactionPrices: async (txs: unknown[]) => ({ transactions: txs }),
  primeLatestPrices: async () => {},
}))

import { parseTransaction } from './fetch-transactions'

const ORCA = 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const W_SENDER = 'HnfkTtEG1ZEfyv3bkXeHu1J7ef2DzuDmQ99DDbQs8jg1'
const W_RECEIVER = 'DrhE25wu3PRGtBCtzsry6ToiGjhwBzCnYGpvv53qxh9X'

// 1. SPL transfer: receiver wallet sees sender as counterparty.
test('counterparty: SPL In sees the sender owner', () => {
  const tx = {
    signature: 'testSig1',
    timestamp: 1659104590,
    fee: 5000,
    feePayer: W_SENDER,
    transactionError: null,
    tokenTransfers: [
      { fromTokenAccount: 'ata1', toTokenAccount: 'ata2', fromUserAccount: W_SENDER, toUserAccount: W_RECEIVER, tokenAmount: 1000.01, mint: USDC, tokenStandard: 'Fungible' },
    ],
    nativeTransfers: [],
    accountData: [
      { account: 'ata1', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: W_SENDER,   tokenAccount: 'ata1', mint: USDC, rawTokenAmount: { tokenAmount: '-1000010000', decimals: 6 } },
      ] },
      { account: 'ata2', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: W_RECEIVER, tokenAccount: 'ata2', mint: USDC, rawTokenAmount: { tokenAmount: '1000010000', decimals: 6 } },
      ] },
    ],
  }
  // From the receiver's perspective:
  const moves = parseTransaction(tx, W_RECEIVER, 'opco')
  const usdcMove = moves.find(m => m.asset === 'USDC')
  expect(usdcMove).toBeDefined()
  expect(usdcMove!.direction).toBe('in')
  expect(usdcMove!.counterparty).toBe(W_SENDER)
})

// 2. SPL Out: sender sees receiver as counterparty.
test('counterparty: SPL Out sees the receiver owner', () => {
  const tx = {
    signature: 'testSig2',
    timestamp: 1659104590,
    fee: 5000,
    feePayer: W_SENDER,
    transactionError: null,
    tokenTransfers: [],
    nativeTransfers: [],
    accountData: [
      { account: 'ata1', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: W_SENDER,   tokenAccount: 'ata1', mint: USDC, rawTokenAmount: { tokenAmount: '-1000010000', decimals: 6 } },
      ] },
      { account: 'ata2', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: W_RECEIVER, tokenAccount: 'ata2', mint: USDC, rawTokenAmount: { tokenAmount: '1000010000', decimals: 6 } },
      ] },
    ],
  }
  const moves = parseTransaction(tx, W_SENDER, 'opco')
  const usdcMove = moves.find(m => m.asset === 'USDC')
  expect(usdcMove!.direction).toBe('out')
  expect(usdcMove!.counterparty).toBe(W_RECEIVER)
})

// 3. SOL transfer: counterparty extracted from accountData[].nativeBalanceChange.
test('counterparty: SOL transfer sees the opposite-side wallet', () => {
  const SOL_W1 = 'WalletA111111111111111111111111111111111111'
  const SOL_W2 = 'WalletB222222222222222222222222222222222222'
  const tx = {
    signature: 'testSig3',
    timestamp: 1659104590,
    fee: 5000,
    feePayer: SOL_W1,
    transactionError: null,
    tokenTransfers: [],
    nativeTransfers: [
      { fromUserAccount: SOL_W1, toUserAccount: SOL_W2, amount: 1_000_000_000 },
    ],
    accountData: [
      // W1 sends 1 SOL to W2; W1 also pays the 5000-lamport fee.
      // Helius-style nativeBalanceChange reflects net delta in lamports.
      { account: SOL_W1, nativeBalanceChange: -1_000_005_000, tokenBalanceChanges: [] },
      { account: SOL_W2, nativeBalanceChange: 1_000_000_000, tokenBalanceChanges: [] },
    ],
  }
  const moves = parseTransaction(tx, SOL_W1, 'opco')
  const solMove = moves.find(m => m.asset === 'SOL')
  expect(solMove!.direction).toBe('out')
  // From W1's view: nativeBalanceChange = -1_000_005_000; add back fee 5000 (W1 is feePayer)
  // ⇒ adjusted delta = -1_000_000_000 lamports = -1.000 SOL.
  // W2's nativeBalanceChange = +1_000_000_000 ⇒ counterparty.
  expect(solMove!.counterparty).toBe(SOL_W2)
  expect(Math.abs(solMove!.qty - 1.0)).toBeLessThan(1e-6)
})

// 4. Multi-ATA same owner: aggregates correctly, doesn't double-pick.
test('counterparty: aggregates same owner across multiple ATAs', () => {
  const tx = {
    signature: 'testSig4',
    timestamp: 1,
    fee: 5000,
    feePayer: W_SENDER,
    transactionError: null,
    tokenTransfers: [],
    nativeTransfers: [],
    accountData: [
      { account: 'ata1', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: W_SENDER, tokenAccount: 'ata1', mint: USDC, rawTokenAmount: { tokenAmount: '-500000000', decimals: 6 } },
      ] },
      { account: 'ata2', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: W_SENDER, tokenAccount: 'ata2', mint: USDC, rawTokenAmount: { tokenAmount: '-500000000', decimals: 6 } },
      ] },
      { account: 'ata3', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: W_RECEIVER, tokenAccount: 'ata3', mint: USDC, rawTokenAmount: { tokenAmount: '1000000000', decimals: 6 } },
      ] },
    ],
  }
  const moves = parseTransaction(tx, W_SENDER, 'opco')
  const usdcMove = moves.find(m => m.asset === 'USDC')
  expect(usdcMove!.direction).toBe('out')
  expect(usdcMove!.counterparty).toBe(W_RECEIVER)
  expect(Math.abs(usdcMove!.qty - 1000)).toBeLessThan(1e-6)
})

// 5. No clear counterparty: returns null gracefully.
test('counterparty: no opposite-side movement → null', () => {
  // A program funds OTM's ATA without an opposite wallet (e.g., a mint instruction).
  const tx = {
    signature: 'testSig5',
    timestamp: 1,
    fee: 5000,
    feePayer: W_RECEIVER,
    transactionError: null,
    tokenTransfers: [],
    nativeTransfers: [],
    accountData: [
      { account: 'ata1', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: W_RECEIVER, tokenAccount: 'ata1', mint: USDC, rawTokenAmount: { tokenAmount: '100000000', decimals: 6 } },
      ] },
    ],
  }
  const moves = parseTransaction(tx, W_RECEIVER, 'opco')
  const usdcMove = moves.find(m => m.asset === 'USDC')
  expect(usdcMove).toBeDefined()
  expect(usdcMove!.counterparty).toBeNull()
})

// 6. tokenBalanceChange entries with missing userAccount on irrelevant entries don't crash.
test('counterparty: tolerates missing userAccount fields', () => {
  const tx = {
    signature: 'testSig6',
    timestamp: 1,
    fee: 5000,
    feePayer: W_SENDER,
    transactionError: null,
    tokenTransfers: [],
    nativeTransfers: [],
    accountData: [
      { account: 'ata1', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: W_SENDER, tokenAccount: 'ata1', mint: USDC, rawTokenAmount: { tokenAmount: '-100000000', decimals: 6 } },
      ] },
      { account: 'ata2', nativeBalanceChange: 0, tokenBalanceChanges: [
        // Owner-less entry (e.g., escrow PDA): should be skipped.
        { tokenAccount: 'ata2', mint: USDC, rawTokenAmount: { tokenAmount: '100000000', decimals: 6 } },
      ] },
    ],
  }
  const moves = parseTransaction(tx, W_SENDER, 'opco')
  const usdcMove = moves.find(m => m.asset === 'USDC')
  expect(usdcMove!.direction).toBe('out')
  expect(usdcMove!.counterparty).toBeNull()
})

// 7. REGRESSION: pre-2022-schema receive (the bug being fixed).
// Mirrors the 2021-08-09 1-ORCA receive into Orca Tokens Main.
// Under raw-RPC parsing, the corresponding `meta.postTokenBalances` entries lacked
// the `owner` field, so the parser silently dropped the move. Helius's Enhanced API
// always populates `userAccount`, so the parser ingests it correctly.
test('counterparty: pre-2022-schema ATA receive parses correctly via accountData.userAccount', () => {
  const OTM = 'GjKxauMroc9MT27xXYyjLYNfy9nSS5EuHTmzhdkjCAR1'
  const SENDER = '2YM8LrJGRtsDcWeqsjX2EQwJfhArxyDdtDzgt7vrwwbV'
  const tx = {
    signature: '3ULKVq4AxtbZPd8zoELj6SWXwxpAMEyTvZrQ5eBt1kXLA6aCengp3JeLnwkcH8oCvGesuaQCVCG1FTYnpUTj5ysF',
    timestamp: 1628540334,
    fee: 5000,
    feePayer: SENDER,
    transactionError: null,
    tokenTransfers: [
      { fromTokenAccount: 'GBaPEhgfcAveY6cB3V4ERsVxQbadWkXamGnssSLdXteN', toTokenAccount: 'EXfMuea3TGiKJCvbhySsX6UPMue6wA6NTPDPBWBUyujy', fromUserAccount: SENDER, toUserAccount: OTM, tokenAmount: 1, mint: ORCA, tokenStandard: 'Fungible' },
    ],
    nativeTransfers: [],
    accountData: [
      { account: 'GBaPEhgfcAveY6cB3V4ERsVxQbadWkXamGnssSLdXteN', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: SENDER, tokenAccount: 'GBaPEhgfcAveY6cB3V4ERsVxQbadWkXamGnssSLdXteN', mint: ORCA, rawTokenAmount: { tokenAmount: '-1000000', decimals: 6 } },
      ] },
      { account: 'EXfMuea3TGiKJCvbhySsX6UPMue6wA6NTPDPBWBUyujy', nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: OTM, tokenAccount: 'EXfMuea3TGiKJCvbhySsX6UPMue6wA6NTPDPBWBUyujy', mint: ORCA, rawTokenAmount: { tokenAmount: '1000000', decimals: 6 } },
      ] },
    ],
  }
  const moves = parseTransaction(tx, OTM, 'foundation')
  const orcaIn = moves.find(m => m.asset === 'ORCA' && m.direction === 'in')
  expect(orcaIn).toBeDefined()
  expect(Math.abs(orcaIn!.qty - 1)).toBeLessThan(1e-6)
  expect(orcaIn!.counterparty).toBe(SENDER)
})

// 8. ATA-fallback: when Helius leaves userAccount null, recover the move via walletAtas.
test('parser: ATA-fallback recovers In when userAccount is missing but tokenAccount is wallet ATA', () => {
  const OTM = 'GjKxauMroc9MT27xXYyjLYNfy9nSS5EuHTmzhdkjCAR1'
  const OTM_ORCA_ATA = 'EXfMuea3TGiKJCvbhySsX6UPMue6wA6NTPDPBWBUyujy'
  const SENDER = '2YM8LrJGRtsDcWeqsjX2EQwJfhArxyDdtDzgt7vrwwbV'
  const tx = {
    signature: 'testSig8',
    timestamp: 1628540334,
    fee: 5000,
    feePayer: SENDER,
    transactionError: null,
    tokenTransfers: [],
    nativeTransfers: [],
    accountData: [
      { account: OTM_ORCA_ATA, nativeBalanceChange: 0, tokenBalanceChanges: [
        // Helius can't resolve userAccount for this legacy entry — but tokenAccount
        // is OTM's ORCA ATA, so the fallback should attribute it to OTM.
        { /* userAccount intentionally missing */ tokenAccount: OTM_ORCA_ATA, mint: ORCA, rawTokenAmount: { tokenAmount: '50000000', decimals: 6 } },
      ] },
    ],
  }

  // Without walletAtas: move is dropped (existing behavior preserved).
  const movesNoAtas = parseTransaction(tx, OTM, 'foundation')
  expect(movesNoAtas.find(m => m.asset === 'ORCA')).toBeUndefined()

  // With walletAtas containing the matching ATA: fallback recovers the In.
  const movesWithAtas = parseTransaction(tx, OTM, 'foundation', undefined, new Set([OTM_ORCA_ATA]))
  const orcaIn = movesWithAtas.find(m => m.asset === 'ORCA' && m.direction === 'in')
  expect(orcaIn).toBeDefined()
  expect(Math.abs(orcaIn!.qty - 50)).toBeLessThan(1e-6)
})

// 10. Structural: fetchTransactionsJob accepts beforeSig in opts.
import type { fetchTransactionsJob } from './fetch-transactions'

test('fetchTransactionsJob accepts beforeSig in opts', () => {
  type Opts = Parameters<typeof fetchTransactionsJob>[0]
  const opts: Opts = { full: true, walletAddr: 'x', beforeSig: 'abc' }
  expect(opts.beforeSig).toBe('abc')
})

// 9. ATA-fallback: Helius returns userAccount: "" (empty string) on mint-style events.
test('parser: ATA-fallback recovers In when userAccount is EMPTY STRING (mint-style event)', () => {
  const OTM = 'GjKxauMroc9MT27xXYyjLYNfy9nSS5EuHTmzhdkjCAR1'
  const OTM_ORCA_ATA = 'EXfMuea3TGiKJCvbhySsX6UPMue6wA6NTPDPBWBUyujy'
  const SENDER = '2YM8LrJGRtsDcWeqsjX2EQwJfhArxyDdtDzgt7vrwwbV'
  // Mirrors actual TGE mint sig 3SBbqGDj... where Helius returns
  // userAccount: "" (empty string) on the destination ATA.
  const tx = {
    signature: 'testSig9_TGEmint',
    timestamp: 1628540543,
    fee: 0,
    feePayer: SENDER,
    transactionError: null,
    tokenTransfers: [],
    nativeTransfers: [],
    accountData: [
      { account: OTM_ORCA_ATA, nativeBalanceChange: 0, tokenBalanceChanges: [
        { userAccount: '', tokenAccount: OTM_ORCA_ATA, mint: ORCA, rawTokenAmount: { tokenAmount: '94250000000000', decimals: 6 } },
      ] },
    ],
  }

  // With walletAtas: the empty-string userAccount must NOT block the fallback.
  const moves = parseTransaction(tx, OTM, 'foundation', undefined, new Set([OTM_ORCA_ATA]))
  const orcaIn = moves.find(m => m.asset === 'ORCA' && m.direction === 'in')
  expect(orcaIn).toBeDefined()
  expect(Math.abs(orcaIn!.qty - 94250000)).toBeLessThan(1e-6)
})
