import { test, expect, beforeEach, afterEach } from 'bun:test'

const origFetch = globalThis.fetch
let captured: Array<{ url: string; init?: RequestInit }> = []

beforeEach(() => {
  captured = []
  process.env.HELIUS_API_KEY = process.env.HELIUS_API_KEY || 'TESTKEY'
})

afterEach(() => {
  globalThis.fetch = origFetch
})

test('heliusGetAddressTransactions: builds GET URL with all query params', async () => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    captured.push({ url, init })
    return new Response(JSON.stringify([{ signature: 'abc', timestamp: 1 }]))
  }) as any

  const { heliusGetAddressTransactions } = await import('./helius')
  const result = await heliusGetAddressTransactions('SomeAddr', {
    before: 'BEF',
    until: 'UNT',
    limit: 50,
    commitment: 'finalized',
  })

  expect(captured).toHaveLength(1)
  const url = captured[0].url
  expect(url).toContain('https://api.helius.xyz/v0/addresses/SomeAddr/transactions')
  expect(url).toContain('api-key=')
  expect(url).toContain('limit=50')
  expect(url).toContain('before=BEF')
  expect(url).toContain('until=UNT')
  expect(url).toContain('commitment=finalized')
  expect(result).toEqual([{ signature: 'abc', timestamp: 1 }])
})

test('heliusGetAddressTransactions: omits unset optional params', async () => {
  globalThis.fetch = (async (url: string) => {
    captured.push({ url })
    return new Response(JSON.stringify([]))
  }) as any

  const { heliusGetAddressTransactions } = await import('./helius')
  await heliusGetAddressTransactions('Addr')
  const url = captured[0].url
  expect(url).not.toContain('before=')
  expect(url).not.toContain('until=')
  expect(url).toContain('limit=100') // default
})

test('heliusGetAddressTransactions: returns [] after retries exhausted on HTTP 429', async () => {
  globalThis.fetch = (async () => new Response('rate-limited', { status: 429 })) as any

  const { heliusGetAddressTransactions } = await import('./helius')
  const result = await heliusGetAddressTransactions('Addr', { limit: 1 })
  expect(result).toEqual([])
}, 30_000)

test('heliusGetTokenAccountsByOwner: returns focus-mint ATAs only', async () => {
  // Helius RPC returns a list of token accounts; filter to focus mints.
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    captured.push({ url, init })
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        value: [
          { pubkey: 'ATA_ORCA', account: { data: { parsed: { info: {
            mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
            owner: 'OWNER_X',
            tokenAmount: { uiAmountString: '100', decimals: 6 },
          }}}}},
          { pubkey: 'ATA_USDC', account: { data: { parsed: { info: {
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: 'OWNER_X',
            tokenAmount: { uiAmountString: '500', decimals: 6 },
          }}}}},
          // Non-focus mint (random Solana token) — should be filtered out.
          { pubkey: 'ATA_OTHER', account: { data: { parsed: { info: {
            mint: 'NOTAFOCUSMINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            owner: 'OWNER_X',
            tokenAmount: { uiAmountString: '0', decimals: 0 },
          }}}}},
        ],
      },
    }))
  }) as any

  const { heliusGetTokenAccountsByOwner } = await import('./helius')
  const atas = await heliusGetTokenAccountsByOwner('OWNER_X')

  expect(atas).toHaveLength(2)
  expect(atas.find(a => a.mint === 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE')?.ata).toBe('ATA_ORCA')
  expect(atas.find(a => a.mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')?.ata).toBe('ATA_USDC')
  // Non-focus mint excluded:
  expect(atas.find(a => a.ata === 'ATA_OTHER')).toBeUndefined()
})

test('heliusGetTokenAccountsByOwner: returns [] on RPC error', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32000, message: 'rpc oops' },
  }))) as any

  const { heliusGetTokenAccountsByOwner } = await import('./helius')
  const atas = await heliusGetTokenAccountsByOwner('OWNER_X')
  expect(atas).toEqual([])
})

test('heliusEnhanced: returns parsed tx array on success', async () => {
  globalThis.fetch = (async (url: string) => {
    captured.push({ url })
    return new Response(JSON.stringify([{ signature: 'sigA', timestamp: 1 }, { signature: 'sigB', timestamp: 2 }]))
  }) as any

  const { heliusEnhanced } = await import('./helius')
  const result = await heliusEnhanced(['sigA', 'sigB'])
  expect(result).toHaveLength(2)
  expect(captured[0].url).toContain('https://api.helius.xyz/v0/transactions?api-key=')
})

test('heliusEnhanced: returns [] after retries exhausted on HTTP 429', async () => {
  globalThis.fetch = (async () => new Response('rate-limited', { status: 429 })) as any

  const { heliusEnhanced } = await import('./helius')
  const result = await heliusEnhanced(['sigA'])
  expect(result).toEqual([])
}, 30_000)
