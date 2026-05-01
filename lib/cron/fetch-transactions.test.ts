import { test, expect, mock } from 'bun:test'

// Stub modules that require DB / external config so parseTransaction
// can be imported without a live database.
mock.module('@/lib/db', () => ({ db: {} }))
mock.module('@/lib/db/schema', () => ({ wallet: {}, transaction: {} }))
mock.module('@/lib/helius', () => ({ heliusRpc: async () => ({}) }))
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
    blockTime: 1659104590,
    transaction: {
      message: { accountKeys: [W_SENDER, '<ata1>', '<ata2>', USDC, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'] },
      signatures: ['testSig'],
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [], postBalances: [],
      preTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: W_SENDER,   uiTokenAmount: { uiAmountString: '1226405.82' } },
        { accountIndex: 2, mint: USDC, owner: W_RECEIVER, uiTokenAmount: { uiAmountString: '1000.01' } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: W_SENDER,   uiTokenAmount: { uiAmountString: '0' } },
        { accountIndex: 2, mint: USDC, owner: W_RECEIVER, uiTokenAmount: { uiAmountString: '1227405.83' } },
      ],
    },
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
    blockTime: 1659104590,
    transaction: {
      message: { accountKeys: [W_SENDER, '<ata1>', '<ata2>', USDC] },
      signatures: ['testSig'],
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [], postBalances: [],
      preTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: W_SENDER,   uiTokenAmount: { uiAmountString: '1226405.82' } },
        { accountIndex: 2, mint: USDC, owner: W_RECEIVER, uiTokenAmount: { uiAmountString: '1000.01' } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: W_SENDER,   uiTokenAmount: { uiAmountString: '0' } },
        { accountIndex: 2, mint: USDC, owner: W_RECEIVER, uiTokenAmount: { uiAmountString: '1227405.83' } },
      ],
    },
  }
  const moves = parseTransaction(tx, W_SENDER, 'opco')
  const usdcMove = moves.find(m => m.asset === 'USDC')
  expect(usdcMove!.direction).toBe('out')
  expect(usdcMove!.counterparty).toBe(W_RECEIVER)
})

// 3. SOL transfer: counterparty extracted from preBalances/postBalances by accountKeys.
test('counterparty: SOL transfer sees the opposite-side wallet', () => {
  const SOL_W1 = 'WalletA111111111111111111111111111111111111'
  const SOL_W2 = 'WalletB222222222222222222222222222222222222'
  const tx = {
    blockTime: 1659104590,
    transaction: {
      message: { accountKeys: [SOL_W1, SOL_W2] },
      signatures: ['testSig'],
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances:  [10_000_000_000, 1_000_000_000], // 10 SOL, 1 SOL (lamports)
      postBalances: [ 9_000_000_000, 2_000_000_000], //  9 SOL, 2 SOL — W1 sends 1 SOL to W2
      preTokenBalances: [],
      postTokenBalances: [],
    },
  }
  const moves = parseTransaction(tx, SOL_W1, 'opco')
  const solMove = moves.find(m => m.asset === 'SOL')
  expect(solMove!.direction).toBe('out')
  // Note: fee charged to W1 = 5000 lamports, and the actual send is 1 SOL.
  // delta_W1 = (9_000_000_000 - 10_000_000_000) / 1e9 + (5000/1e9) = -1.000 + 0.000005 ≈ -0.999995
  // delta_W2 = (2_000_000_000 - 1_000_000_000) / 1e9 = +1.000
  // Largest opposite-direction delta = +1.000 → counterparty = SOL_W2.
  expect(solMove!.counterparty).toBe(SOL_W2)
})

// 4. Multi-ATA same owner: aggregates correctly, doesn't double-pick.
test('counterparty: aggregates same owner across multiple ATAs', () => {
  const tx = {
    blockTime: 1,
    transaction: {
      message: { accountKeys: [W_SENDER, '<ata1>', '<ata2>', '<ata3>'] },
      signatures: ['testSig'],
    },
    meta: {
      err: null, fee: 5000,
      preBalances: [], postBalances: [],
      preTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: W_SENDER,   uiTokenAmount: { uiAmountString: '500' } },
        { accountIndex: 2, mint: USDC, owner: W_SENDER,   uiTokenAmount: { uiAmountString: '500' } },
        { accountIndex: 3, mint: USDC, owner: W_RECEIVER, uiTokenAmount: { uiAmountString: '0' } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: W_SENDER,   uiTokenAmount: { uiAmountString: '0' } },
        { accountIndex: 2, mint: USDC, owner: W_SENDER,   uiTokenAmount: { uiAmountString: '0' } },
        { accountIndex: 3, mint: USDC, owner: W_RECEIVER, uiTokenAmount: { uiAmountString: '1000' } },
      ],
    },
  }
  const moves = parseTransaction(tx, W_SENDER, 'opco')
  const usdcMove = moves.find(m => m.asset === 'USDC')
  expect(usdcMove!.direction).toBe('out')
  expect(usdcMove!.counterparty).toBe(W_RECEIVER)
})

// 5. No clear counterparty: returns null gracefully.
test('counterparty: no opposite-side movement → null', () => {
  // A program creates an account funding only one wallet (no opposite wallet).
  const tx = {
    blockTime: 1,
    transaction: {
      message: { accountKeys: [W_RECEIVER, '<ata1>'] },
      signatures: ['testSig'],
    },
    meta: {
      err: null, fee: 5000,
      preBalances: [], postBalances: [],
      preTokenBalances: [],
      postTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: W_RECEIVER, uiTokenAmount: { uiAmountString: '100' } },
      ],
    },
  }
  const moves = parseTransaction(tx, W_RECEIVER, 'opco')
  const usdcMove = moves.find(m => m.asset === 'USDC')
  expect(usdcMove).toBeDefined()
  expect(usdcMove!.counterparty).toBeNull()
})

// 6. Owner-less token balance entries don't crash.
test('counterparty: tolerates missing owner fields', () => {
  const tx = {
    blockTime: 1,
    transaction: {
      message: { accountKeys: [W_SENDER, '<ata1>', '<ata2>'] },
      signatures: ['testSig'],
    },
    meta: {
      err: null, fee: 5000,
      preBalances: [], postBalances: [],
      preTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: W_SENDER, uiTokenAmount: { uiAmountString: '100' } },
        { accountIndex: 2, mint: USDC, /* no owner */ uiTokenAmount: { uiAmountString: '0' } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: USDC, owner: W_SENDER, uiTokenAmount: { uiAmountString: '0' } },
        { accountIndex: 2, mint: USDC, /* no owner */ uiTokenAmount: { uiAmountString: '100' } },
      ],
    },
  }
  // Owner-less entries should be skipped in aggregation, returning null counterparty.
  const moves = parseTransaction(tx, W_SENDER, 'opco')
  const usdcMove = moves.find(m => m.asset === 'USDC')
  expect(usdcMove!.counterparty).toBeNull()
})
