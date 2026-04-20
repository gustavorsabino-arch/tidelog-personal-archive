/**
 * Helius RPC + Enhanced API client with rate limiting.
 * Server-side only (uses env vars).
 */
import { RateLimiter } from './rate-limiter'

const HELIUS_KEY = process.env.HELIUS_KEY || ''
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
const REST_URL = 'https://api.helius.xyz/v0'

const limiter = new RateLimiter(40, 40)
let rpcId = 1

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
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      const data = await r.json()
      if (data.error && attempt < retries) continue
      return data
    } catch (e) {
      if (attempt === retries) throw e
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
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
