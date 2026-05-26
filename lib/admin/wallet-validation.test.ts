import { test, expect } from 'bun:test'
import { CreateWalletSchema, validateAddress, normalizeAddress } from './wallet-validation'

test('validateAddress accepts a valid SOL pubkey', () => {
  expect(validateAddress('SOL', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')).toBe(true)
})

test('validateAddress rejects a non-base58 SOL address', () => {
  expect(validateAddress('SOL', '0xnot-base58')).toBe(false)
})

test('validateAddress accepts a checksummed ETH address case-insensitively', () => {
  expect(validateAddress('ETH', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe(true)
})

test('validateAddress rejects an ETH address with wrong length', () => {
  expect(validateAddress('ETH', '0xA0b8')).toBe(false)
})

test('validateAddress accepts BTC legacy, P2SH, and bech32', () => {
  expect(validateAddress('BTC', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true)         // legacy
  expect(validateAddress('BTC', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true)         // P2SH
  expect(validateAddress('BTC', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true) // bech32
})

test('validateAddress rejects nonsense BTC string', () => {
  expect(validateAddress('BTC', 'not-a-btc-address')).toBe(false)
})

test('CreateWalletSchema validates a minimal SOL wallet', () => {
  const result = CreateWalletSchema.safeParse({
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    label: 'Test Wallet',
    chain: 'SOL',
    entityId: 'opco',
  })
  expect(result.success).toBe(true)
})

test('CreateWalletSchema rejects address mismatched with chain', () => {
  const result = CreateWalletSchema.safeParse({
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // ETH address
    label: 'Test',
    chain: 'SOL',                                              // but chain SOL
    entityId: 'opco',
  })
  expect(result.success).toBe(false)
})

test('CreateWalletSchema rejects backfill=true on ETH', () => {
  const result = CreateWalletSchema.safeParse({
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    label: 'ETH wallet',
    chain: 'ETH',
    entityId: 'opco',
    backfill: true,
  })
  expect(result.success).toBe(false)
})

test('CreateWalletSchema rejects backfill=true on external SOL wallet', () => {
  const result = CreateWalletSchema.safeParse({
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    label: 'Test',
    chain: 'SOL',
    entityId: 'opco',
    type: 'external',
    backfill: true,
  })
  expect(result.success).toBe(false)
})

test('label too long is rejected', () => {
  const result = CreateWalletSchema.safeParse({
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    label: 'x'.repeat(81),
    chain: 'SOL',
    entityId: 'opco',
  })
  expect(result.success).toBe(false)
})

test('normalizeAddress lowercases ETH addresses', () => {
  expect(normalizeAddress('ETH', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'))
    .toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
})

test('normalizeAddress leaves SOL and BTC addresses unchanged', () => {
  const sol = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
  expect(normalizeAddress('SOL', sol)).toBe(sol)
  const btc = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
  expect(normalizeAddress('BTC', btc)).toBe(btc)
})

test('CreateWalletSchema rejects backfill=true on BTC', () => {
  const result = CreateWalletSchema.safeParse({
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    label: 'BTC wallet',
    chain: 'BTC',
    entityId: 'opco',
    backfill: true,
  })
  expect(result.success).toBe(false)
})

test('CreateWalletSchema accepts type=internal as default', () => {
  const result = CreateWalletSchema.safeParse({
    address: 'GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV',
    label: 'Test Wallet',
    chain: 'SOL',
    entityId: 'opco',
  })
  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data.type).toBe('internal')
    expect(result.data.hiddenFromFinance).toBe(false)
  }
})

test('CreateWalletSchema accepts type=external', () => {
  const result = CreateWalletSchema.safeParse({
    address: 'GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV',
    label: 'External CP',
    chain: 'SOL',
    entityId: 'opco',
    type: 'external',
  })
  expect(result.success).toBe(true)
})

test('CreateWalletSchema rejects type=external + hiddenFromFinance=true', () => {
  const result = CreateWalletSchema.safeParse({
    address: 'GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV',
    label: 'Bad combo',
    chain: 'SOL',
    entityId: 'opco',
    type: 'external',
    hiddenFromFinance: true,
  })
  expect(result.success).toBe(false)
})

test('CreateWalletSchema rejects backfill=true for external wallet', () => {
  const result = CreateWalletSchema.safeParse({
    address: 'GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV',
    label: 'External',
    chain: 'SOL',
    entityId: 'opco',
    type: 'external',
    backfill: true,
  })
  expect(result.success).toBe(false)
})
