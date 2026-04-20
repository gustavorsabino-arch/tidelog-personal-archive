import { listDataFilesStrict, readDataFileStrict } from '@/lib/github'
import { hydrateTransactionPrices } from '@/lib/transaction-pricing'
import type { Transaction, TransactionsResponse } from '@/lib/types'

type GetTreasuryTransactionsParams = {
  entity: string
  from?: string | null
  to?: string | null
  asset?: string | null
  direction?: string | null
  wallet?: string | null
  limit?: number | null
  offset?: number
  hydratePrices?: boolean
}

function movementKey(tx: Transaction) {
  return `${tx.txHash}::${tx.walletAddr}::${tx.asset}::${tx.dir}`
}

function normalizeTransaction(raw: any, entity: string): Transaction | null {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.txHash !== 'string' || typeof raw.walletAddr !== 'string' || typeof raw.asset !== 'string') return null
  if (raw.dir !== 'In' && raw.dir !== 'Out') return null

  const blockTime = typeof raw.blockTime === 'number' ? raw.blockTime : parseInt(`${raw.blockTime || 0}`, 10)
  if (!Number.isFinite(blockTime) || blockTime <= 0) return null

  const qty = typeof raw.qty === 'number' ? raw.qty : parseFloat(`${raw.qty || 0}`)
  if (!Number.isFinite(qty) || qty <= 0) return null

  const price = raw.price == null ? null : Number(raw.price)
  const usd = raw.usd == null ? null : Number(raw.usd)

  return {
    txHash: raw.txHash,
    walletAddr: raw.walletAddr,
    wallet: typeof raw.wallet === 'string' ? raw.wallet : raw.walletAddr,
    entity: typeof raw.entity === 'string' ? raw.entity : entity,
    blockTime,
    date: typeof raw.date === 'string' && raw.date ? raw.date : new Date(blockTime * 1000).toISOString(),
    asset: raw.asset,
    qty: Math.abs(qty),
    dir: raw.dir,
    price: Number.isFinite(price) ? price : null,
    usd: Number.isFinite(usd) ? usd : null,
    priceSource: typeof raw.priceSource === 'string' ? raw.priceSource : null,
    counterparty: typeof raw.counterparty === 'string' ? raw.counterparty : null,
    category: typeof raw.category === 'string' ? raw.category : null,
  }
}

async function loadEntityTransactions(entity: string): Promise<Transaction[]> {
  const listResult = await listDataFilesStrict(`transactions/${entity}`)
  if (!listResult.ok) {
    throw new Error(listResult.error)
  }
  if (!listResult.found) {
    return []
  }

  const readResults = await Promise.all(
    listResult.files.map(file => readDataFileStrict<unknown>(`transactions/${entity}/${file}`))
  )

  const deduped = new Map<string, Transaction>()
  for (let idx = 0; idx < readResults.length; idx++) {
    const result = readResults[idx]
    const file = listResult.files[idx]

    if (!result.ok) {
      throw new Error(result.error)
    }
    if (!result.found) continue
    if (!Array.isArray(result.data)) {
      throw new Error(`transactions/${entity}/${file} is not a transaction array`)
    }

    for (const raw of result.data) {
      const tx = normalizeTransaction(raw, entity)
      if (!tx) continue
      deduped.set(movementKey(tx), tx)
    }
  }

  return [...deduped.values()]
}

export async function getTreasuryTransactions({
  entity,
  from,
  to,
  asset,
  direction,
  wallet,
  limit = 500,
  offset = 0,
  hydratePrices = true,
}: GetTreasuryTransactionsParams): Promise<TransactionsResponse> {
  let allTxs = await loadEntityTransactions(entity)

  // Apply filters
  const fromTs = from ? parseInt(from) : 0
  const toTs = to ? parseInt(to) : Infinity

  allTxs = allTxs.filter(t => {
    if (t.blockTime < fromTs || t.blockTime > toTs) return false
    if (asset && t.asset !== asset) return false
    if (direction && t.dir !== direction) return false
    if (wallet && t.walletAddr !== wallet) return false
    return true
  })

  if (hydratePrices && allTxs.length) {
    const priceCacheResult = await readDataFileStrict<Record<string, unknown>>('prices.json')
    if (!priceCacheResult.ok) {
      throw new Error(priceCacheResult.error)
    }

    const priceCache = priceCacheResult.found ? priceCacheResult.data : {}
    const hydrated = await hydrateTransactionPrices(allTxs, {
      priceCache,
      fetchMissingHistory: true,
    })
    allTxs = hydrated.transactions
  }

  // Sort by blockTime desc
  allTxs.sort((a, b) => b.blockTime - a.blockTime)

  const summary = {
    inflowsUSD: allTxs.filter(t => t.dir === 'In').reduce((s, t) => s + Math.abs(t.usd || 0), 0),
    outflowsUSD: allTxs.filter(t => t.dir === 'Out').reduce((s, t) => s + Math.abs(t.usd || 0), 0),
    netUSD: allTxs.reduce((s, t) => s + (t.dir === 'In' ? Math.abs(t.usd || 0) : -Math.abs(t.usd || 0)), 0),
  }

  const total = allTxs.length
  const effectiveLimit = limit == null ? total : limit
  const transactions = allTxs.slice(offset, offset + effectiveLimit)

  return {
    transactions,
    total,
    limit: effectiveLimit,
    offset,
    summary,
  }
}
