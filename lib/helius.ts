/**
 * Helius RPC + Enhanced API client with rate limiting.
 * Server-side only (uses env vars).
 */
import { RateLimiter } from './rate-limiter'

const HELIUS_KEY = process.env.HELIUS_API_KEY || process.env.HELIUS_KEY || ''
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
const REST_URL = 'https://api.helius.xyz/v0'

// Free tier is ~10 req/s. Set HELIUS_RPS to match your plan (8 is safe for free).
const HELIUS_RPS = Math.max(1, Number.parseInt(process.env.HELIUS_RPS || '8', 10) || 8)
const limiter = new RateLimiter(HELIUS_RPS, HELIUS_RPS)
let rpcId = 1

// -32413 = Helius-specific "Too many requests" returned as JSON-RPC error (HTTP 200 body)
const RATE_LIMIT_ERROR_CODES = new Set([-32413, -32029])

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
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000)
        console.warn(`[Helius] 429, waiting ${wait}ms (attempt ${attempt + 1})`)
        await new Promise((res) => setTimeout(res, wait))
        continue
      }
      const data = await r.json()
      if (data?.error?.code && RATE_LIMIT_ERROR_CODES.has(data.error.code) && attempt < retries) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 10000)
        console.warn(`[Helius] rpc ${data.error.code} ${data.error.message}, waiting ${wait}ms (attempt ${attempt + 1})`)
        await new Promise((res) => setTimeout(res, wait))
        continue
      }
      if (data.error && attempt < retries) continue
      return data
    } catch (e) {
      if (attempt === retries) throw e
      await new Promise(res => setTimeout(res, 1000 * (attempt + 1)))
    }
  }
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

export async function heliusEnhanced(signatures: string[]) {
  await limiter.acquire()
  const r = await fetch(`${REST_URL}/transactions?api-key=${HELIUS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: signatures }),
  })
  if (!r.ok) throw new Error(`Helius enhanced: ${r.status}`)
  return r.json()
}
