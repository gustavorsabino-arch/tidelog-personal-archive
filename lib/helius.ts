/**
 * Helius RPC + Enhanced API client with rate limiting.
 * Server-side only (uses env vars).
 */
import { RateLimiter } from './rate-limiter'
import { getSym } from '@/lib/constants'

const HELIUS_KEY = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || ''
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
const REST_URL = 'https://api.helius.xyz/v0'

// Free tier caps differ per API surface: JSON-RPC ~10 RPS, Enhanced API 2 RPS.
const HELIUS_RPS = Math.max(1, Number.parseInt(process.env.HELIUS_RPS || '8', 10) || 8)
const HELIUS_ENHANCED_RPS = Math.max(1, Number.parseInt(process.env.HELIUS_ENHANCED_RPS || '2', 10) || 2)
const limiter = new RateLimiter(HELIUS_RPS, HELIUS_RPS)
const enhancedLimiter = new RateLimiter(HELIUS_ENHANCED_RPS, HELIUS_ENHANCED_RPS)
let rpcId = 1

// -32413 = Helius-specific "Too many requests" returned as JSON-RPC error (HTTP 200 body)
const RATE_LIMIT_ERROR_CODES = new Set([-32413, -32029])

// Compact param summary for log lines — we want to know which call dropped
// without dumping the entire request body (some methods take big objects).
function summarizeParams(method: string, params: unknown[]): string {
  if (method === 'getTransaction') {
    const sig = typeof params[0] === 'string' ? params[0] : ''
    return sig.slice(0, 8) + '…'
  }
  if (method === 'getSignaturesForAddress' || method === 'getBalance' || method === 'getTokenAccountsByOwner') {
    const addr = typeof params[0] === 'string' ? params[0] : ''
    return addr.slice(0, 4) + '…' + addr.slice(-4)
  }
  return '…'
}

export async function heliusRpc(method: string, params: unknown[], retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.acquire()
    try {
      const r = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
      })
      if (r.status === 429) {
        if (attempt >= retries) {
          console.error(`[Helius] DROPPED ${method}(${summarizeParams(method, params)}) after ${retries + 1} attempts (all HTTP 429)`)
          return undefined
        }
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000)
        console.warn(`[Helius] 429, waiting ${wait}ms (attempt ${attempt + 1})`)
        await new Promise((res) => setTimeout(res, wait))
        continue
      }
      const data = await r.json()
      if (data?.error?.code && RATE_LIMIT_ERROR_CODES.has(data.error.code)) {
        if (attempt >= retries) {
          console.error(`[Helius] DROPPED ${method}(${summarizeParams(method, params)}) after ${retries + 1} attempts (rpc rate-limit code=${data.error.code} msg=${data.error.message})`)
          return data
        }
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000)
        console.warn(`[Helius] rpc ${data.error.code} ${data.error.message}, waiting ${wait}ms (attempt ${attempt + 1})`)
        await new Promise((res) => setTimeout(res, wait))
        continue
      }
      if (data.error) {
        if (attempt >= retries) {
          console.error(`[Helius] FAILED ${method}(${summarizeParams(method, params)}) after ${retries + 1} attempts: ${JSON.stringify(data.error)}`)
          return data
        }
        continue
      }
      return data
    } catch (e) {
      if (attempt === retries) {
        console.error(`[Helius] DROPPED ${method}(${summarizeParams(method, params)}) after ${retries + 1} attempts (exception): ${(e as Error).message}`)
        throw e
      }
      await new Promise(res => setTimeout(res, 1000 * (attempt + 1)))
    }
  }
  // Defensive: loop should always return or throw above. Logging here means a code change broke that invariant.
  console.error(`[Helius] DROPPED ${method}(${summarizeParams(method, params)}) — unreachable code path`)
  return undefined
}

type BatchRequest = { method: string; params: unknown[] }
type BatchResponse = { id: number; jsonrpc: '2.0'; result?: unknown; error?: { code: number; message: string } }

/**
 * JSON-RPC batch: POST an array of requests, receive an array of responses.
 * Counts as ONE HTTP request against the rate limit regardless of batch size.
 * Responses may come back in any order; match on id or ignore order if not needed.
 *
 * NOTE: Helius **free tier rejects batch requests** with code -32403. Use this
 * only on paid plans. Free-tier callers should stick to per-request `heliusRpc`.
 */
export async function heliusRpcBatch(requests: BatchRequest[], retries = 3): Promise<BatchResponse[]> {
  if (requests.length === 0) return []
  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.acquire()
    try {
      const body = requests.map((req) => ({
        jsonrpc: '2.0',
        id: rpcId++,
        method: req.method,
        params: req.params,
      }))
      const r = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.status === 429) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000)
        console.warn(`[Helius] batch 429, waiting ${wait}ms (attempt ${attempt + 1})`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      const data = await r.json()
      if (!Array.isArray(data)) {
        throw new Error(`Expected batch array, got: ${JSON.stringify(data).slice(0, 200)}`)
      }
      return data as BatchResponse[]
    } catch (e) {
      if (attempt === retries) throw e
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  return []
}

export async function heliusEnhanced(signatures: string[], retries = 3): Promise<any[]> {
  const url = `${REST_URL}/transactions?api-key=${HELIUS_KEY}`
  for (let attempt = 0; attempt <= retries; attempt++) {
    await enhancedLimiter.acquire()
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: signatures }),
      })
      if (r.status === 429) {
        if (attempt >= retries) {
          console.error(`[Helius] DROPPED enhancedTransactions(${signatures.length} sigs) after ${retries + 1} attempts (all HTTP 429)`)
          return []
        }
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000)
        console.warn(`[Helius] 429, waiting ${wait}ms (attempt ${attempt + 1})`)
        await new Promise((res) => setTimeout(res, wait))
        continue
      }
      if (!r.ok) {
        if (attempt >= retries) {
          console.error(`[Helius] DROPPED enhancedTransactions(${signatures.length} sigs) after ${retries + 1} attempts (HTTP ${r.status})`)
          return []
        }
        await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
        continue
      }
      const data = await r.json()
      if (!Array.isArray(data)) {
        if (attempt >= retries) {
          console.error(`[Helius] DROPPED enhancedTransactions(${signatures.length} sigs) — non-array response: ${JSON.stringify(data).slice(0, 200)}`)
          return []
        }
        await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
        continue
      }
      return data
    } catch (e) {
      if (attempt >= retries) {
        console.error(`[Helius] DROPPED enhancedTransactions(${signatures.length} sigs) after ${retries + 1} attempts (exception): ${(e as Error).message}`)
        return []
      }
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
    }
  }
  return []
}

type AddressTxOpts = {
  before?: string
  until?: string
  limit?: number
  commitment?: 'finalized' | 'confirmed'
}

/**
 * GET https://api.helius.xyz/v0/addresses/<address>/transactions
 * Returns Helius's pre-parsed tx array. Uses the Enhanced API rate limiter (2 RPS free tier).
 * Returns [] on terminal failure so callers' loops terminate cleanly. Failures are logged
 * via [Helius] DROPPED in the same format as heliusRpc.
 */
export async function heliusGetAddressTransactions(
  address: string,
  opts: AddressTxOpts = {},
  retries = 3,
): Promise<any[]> {
  const params = new URLSearchParams()
  params.set('api-key', HELIUS_KEY)
  params.set('limit', String(opts.limit ?? 100))
  if (opts.before) params.set('before', opts.before)
  if (opts.until) params.set('until', opts.until)
  if (opts.commitment) params.set('commitment', opts.commitment)
  const url = `${REST_URL}/addresses/${address}/transactions?${params.toString()}`
  const tag = `${address.slice(0, 4)}…${address.slice(-4)}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    await enhancedLimiter.acquire()
    try {
      const r = await fetch(url, { method: 'GET' })
      if (r.status === 429) {
        if (attempt >= retries) {
          console.error(`[Helius] DROPPED getAddressTransactions(${tag}) after ${retries + 1} attempts (all HTTP 429)`)
          return []
        }
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000)
        console.warn(`[Helius] 429, waiting ${wait}ms (attempt ${attempt + 1})`)
        await new Promise((res) => setTimeout(res, wait))
        continue
      }
      if (!r.ok) {
        if (attempt >= retries) {
          console.error(`[Helius] DROPPED getAddressTransactions(${tag}) after ${retries + 1} attempts (HTTP ${r.status})`)
          return []
        }
        await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
        continue
      }
      const data = await r.json()
      if (!Array.isArray(data)) {
        if (attempt >= retries) {
          console.error(`[Helius] DROPPED getAddressTransactions(${tag}) — non-array response: ${JSON.stringify(data).slice(0, 200)}`)
          return []
        }
        await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
        continue
      }
      return data
    } catch (e) {
      if (attempt >= retries) {
        console.error(`[Helius] DROPPED getAddressTransactions(${tag}) after ${retries + 1} attempts (exception): ${(e as Error).message}`)
        return []
      }
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
    }
  }
  return []
}

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

/**
 * Enumerate a wallet's known ATAs for focus tokens across BOTH the legacy
 * SPL token program and Token-2022. PYUSD and USDG (and any future newer
 * stablecoins) are issued on Token-2022 for compliance hooks; querying only
 * the legacy program silently drops them.
 *
 * Filters to focus mints (via getSym). Returns [] on RPC error so callers
 * can proceed without ATA enumeration.
 *
 * SOL is native (no ATA), so getSym will map it but we exclude it by only
 * accepting mints that map to non-SOL focus symbols.
 */
export async function heliusGetTokenAccountsByOwner(
  owner: string,
): Promise<Array<{ ata: string; mint: string }>> {
  const out: Array<{ ata: string; mint: string }> = []
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const r = await heliusRpc('getTokenAccountsByOwner', [
      owner,
      { programId },
      { encoding: 'jsonParsed' },
    ])
    if (!r || r.error || !r.result?.value) continue
    for (const acc of r.result.value as any[]) {
      const ata = acc?.pubkey
      const mint = acc?.account?.data?.parsed?.info?.mint
      if (!ata || !mint) continue
      const sym = getSym(mint)
      if (!sym || sym === 'SOL') continue  // non-focus or native (no ATA)
      out.push({ ata, mint })
    }
  }
  return out
}
