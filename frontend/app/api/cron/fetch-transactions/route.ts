import { NextRequest, NextResponse } from 'next/server'
import { readDataFileStrict, writeDataFile } from '@/lib/github'
import { heliusRpc } from '@/lib/helius'
import { FOCUS_SET, STABLE_TOKENS, getSym } from '@/lib/constants'
import { hydrateTransactionPrices } from '@/lib/transaction-pricing'
import type { Wallet } from '@/lib/types'
import walletRegistry from '@/data/wallets.json'

const CRON_SECRET = process.env.CRON_SECRET || ''
const DEFAULT_MAX_PAGES = 30
const DEFAULT_TIME_BUDGET_MS = 180000

type TxIndexProgress = {
  lastWalletIndex: number
  lastRun: string
  backfillDays?: number | null
  backfillFromTs?: number | null
  backfillToTs?: number | null
  walletCursor?: WalletScanCursor | null
}

type TruncatedAddress = {
  wallet: string
  walletAddr: string
  scanAddr: string
  pagesScanned: number
  oldestBlockTime: number | null
}

type WalletScanCursor = {
  walletIndex: number
  addressIndex: number
  addressesToScan: string[]
  beforeSignature: string | null
  pagesScannedForAddress: number
}

function movementKey(tx: { txHash: string; walletAddr: string; asset: string; dir: string }) {
  return `${tx.txHash}::${tx.walletAddr}::${tx.asset}::${tx.dir}`
}

function shouldStopForDeadline(deadlineAtMs: number | null) {
  return deadlineAtMs != null && Date.now() >= deadlineAtMs - 15000
}

function dedupeTransactions(txs: any[]): any[] {
  const deduped = new Map<string, any>()
  for (const tx of txs) deduped.set(movementKey(tx), tx)
  return [...deduped.values()].sort((a, b) => b.blockTime - a.blockTime)
}

async function loadMonthFile(
  filePath: string,
  fileCache: Record<string, any[]>,
  existingHashes: Set<string>
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (filePath in fileCache) return { ok: true }

  const result = await readDataFileStrict<unknown>(filePath, true)
  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  if (!result.found) {
    fileCache[filePath] = []
    return { ok: true }
  }

  if (!Array.isArray(result.data)) {
    return { ok: false, error: `${filePath} is not a transaction array` }
  }

  const txs = dedupeTransactions(result.data)
  fileCache[filePath] = txs
  txs.forEach((tx: any) => existingHashes.add(movementKey(tx)))
  return { ok: true }
}

// Parse a raw Helius transaction into movements — mirrors v1 parseTransaction
function parseTransaction(
  tx: any, walletAddress: string, walletLabel: string, entity: string
): any[] {
  if (!tx?.meta) return []
  const meta = tx.meta
  const keys = (tx.transaction?.message?.accountKeys || []).map(
    (k: any) => typeof k === 'string' ? k : k.pubkey
  )
  const walletIdx = keys.indexOf(walletAddress)
  const blockTime = tx.blockTime
  const sig = tx.transaction?.signatures?.[0] || ''
  const moves: any[] = []

  // SOL delta
  if (walletIdx >= 0) {
    const pre = (meta.preBalances?.[walletIdx] || 0) / 1e9
    const post = (meta.postBalances?.[walletIdx] || 0) / 1e9
    const fee = (meta.fee || 0) / 1e9
    const delta = post - pre + fee
    if (Math.abs(delta) > 0.001) {
      moves.push({
        txHash: sig, walletAddr: walletAddress, wallet: walletLabel, entity,
        blockTime, date: new Date(blockTime * 1000).toISOString(),
        asset: 'SOL', qty: Math.abs(delta), dir: delta > 0 ? 'In' : 'Out',
        price: null, usd: null, priceSource: null, counterparty: null, category: null,
      })
    }
  }

  // Token deltas
  const preMap: Record<string, number> = {}
  const postMap: Record<string, number> = {}
  for (const b of (meta.preTokenBalances || []))
    if (b.owner === walletAddress) preMap[b.mint] = (preMap[b.mint] || 0) + parseFloat(b.uiTokenAmount?.uiAmountString || '0')
  for (const b of (meta.postTokenBalances || []))
    if (b.owner === walletAddress) postMap[b.mint] = (postMap[b.mint] || 0) + parseFloat(b.uiTokenAmount?.uiAmountString || '0')

  for (const mint of new Set([...Object.keys(preMap), ...Object.keys(postMap)])) {
    const sym = getSym(mint)
    if (!sym || !FOCUS_SET.has(sym)) continue
    const delta = (postMap[mint] || 0) - (preMap[mint] || 0)
    if (Math.abs(delta) < 0.001) continue
    moves.push({
      txHash: sig, walletAddr: walletAddress, wallet: walletLabel, entity,
      blockTime, date: new Date(blockTime * 1000).toISOString(),
      asset: sym, qty: Math.abs(delta), dir: delta > 0 ? 'In' : 'Out',
      price: STABLE_TOKENS.has(sym) ? 1 : null,
      usd: STABLE_TOKENS.has(sym) ? Math.abs(delta) : null,
      priceSource: STABLE_TOKENS.has(sym) ? 'stable' : null,
      counterparty: null, category: null,
    })
  }
  return moves
}

// Index transactions for a single wallet within a time range
async function indexWallet(
  wallet: Wallet,
  walletIndex: number,
  fromTs: number,
  toTs: number,
  existingHashes: Set<string>,
  maxPages: number,
  resumeCursor?: WalletScanCursor | null,
  deadlineAtMs?: number | null
): Promise<{
  newMoves: any[]
  truncatedAddresses: TruncatedAddress[]
  pagesScanned: number
  completed: boolean
  walletCursor: WalletScanCursor | null
  stoppedDueToTimeBudget: boolean
}> {
  const { address, label, entity } = wallet
  const seenSigs = new Set<string>()
  const newMoves: any[] = []
  const truncatedAddresses: TruncatedAddress[] = []
  let pagesScanned = 0

  // Discover ATAs (token accounts) for this wallet
  const ataAddresses: string[] = []
  try {
    const r = await heliusRpc('getTokenAccountsByOwner', [
      address,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ])
    for (const a of (r?.result?.value || [])) {
      const mint = a.account?.data?.parsed?.info?.mint
      if (mint && FOCUS_SET.has(getSym(mint) || '')) {
        ataAddresses.push(a.pubkey)
      }
    }
  } catch { /* ATA discovery failed, continue with main address */ }

  // Scan main wallet address + all ATAs for signatures
  const addressesToScan = resumeCursor?.addressesToScan?.length
    ? resumeCursor.addressesToScan
    : [address, ...ataAddresses]
  const startAddressIndex = resumeCursor?.walletIndex === walletIndex ? resumeCursor.addressIndex : 0

  for (let addressIndex = startAddressIndex; addressIndex < addressesToScan.length; addressIndex++) {
    const scanAddr = addressesToScan[addressIndex]
    let before: string | undefined =
      addressIndex === startAddressIndex && resumeCursor?.walletIndex === walletIndex
        ? (resumeCursor.beforeSignature || undefined)
        : undefined
    let lastOldest: number | null = null
    let addressPagesScanned =
      addressIndex === startAddressIndex && resumeCursor?.walletIndex === walletIndex
        ? resumeCursor.pagesScannedForAddress
        : 0
    let hitPageLimit = false

    while (addressPagesScanned < maxPages) {
      const cursorBefore = before ?? null
      const cursorPagesScanned = addressPagesScanned
      if (shouldStopForDeadline(deadlineAtMs || null)) {
        return {
          newMoves,
          truncatedAddresses,
          pagesScanned,
          completed: false,
          walletCursor: {
            walletIndex,
            addressIndex,
            addressesToScan,
            beforeSignature: cursorBefore,
            pagesScannedForAddress: cursorPagesScanned,
          },
          stoppedDueToTimeBudget: true,
        }
      }

      let sigs: any[]
      try {
        const r = await heliusRpc('getSignaturesForAddress', [scanAddr, { limit: 100, ...(before ? { before } : {}) }])
        sigs = r?.result || []
      } catch { break }

      if (!sigs.length) break

      const inWindow = sigs.filter((s: any) =>
        !s.err && s.blockTime != null && s.blockTime >= fromTs && s.blockTime <= toTs && !seenSigs.has(s.signature)
      )
      inWindow.forEach((s: any) => seenSigs.add(s.signature))

      // Fetch full tx in batches of 10
      for (let i = 0; i < inWindow.length; i += 10) {
        if (i > 0 && shouldStopForDeadline(deadlineAtMs || null)) {
          return {
            newMoves,
            truncatedAddresses,
            pagesScanned,
            completed: false,
            walletCursor: {
              walletIndex,
              addressIndex,
              addressesToScan,
              beforeSignature: cursorBefore,
              pagesScannedForAddress: cursorPagesScanned,
            },
            stoppedDueToTimeBudget: true,
          }
        }

        const batch = inWindow.slice(i, i + 10)
        const results = await Promise.all(batch.map((s: any) =>
          heliusRpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }])
            .then((r: any) => r?.result).catch(() => null)
        ))
        for (const tx of results) {
          if (!tx) continue
          const moves = parseTransaction(tx, address, label, entity)
          for (const m of moves) {
            const key = `${m.txHash}::${m.walletAddr}::${m.asset}::${m.dir}`
            if (!existingHashes.has(key)) {
              newMoves.push(m)
              existingHashes.add(key)
            }
          }
        }
      }

      pagesScanned++
      addressPagesScanned++
      lastOldest = sigs[sigs.length - 1]?.blockTime ?? null
      if (sigs.length < 100 || lastOldest == null || lastOldest < fromTs) break
      before = sigs[sigs.length - 1].signature
      if (addressPagesScanned === maxPages) hitPageLimit = true
    }

    if (hitPageLimit && lastOldest != null && lastOldest >= fromTs) {
      truncatedAddresses.push({
        wallet: label,
        walletAddr: address,
        scanAddr,
        pagesScanned: addressPagesScanned,
        oldestBlockTime: lastOldest,
      })
    }
  }

  return {
    newMoves,
    truncatedAddresses,
    pagesScanned,
    completed: true,
    walletCursor: null,
    stoppedDueToTimeBudget: false,
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Default: last 7 days. Pass ?days=90 or ?days=365 for deeper backfill.
    const now = Math.floor(Date.now() / 1000)
    const daysParam = parseInt(req.nextUrl.searchParams.get('days') || '7')
    const batchSizeParam = parseInt(req.nextUrl.searchParams.get('batchSize') || '')
    const maxPagesParam = parseInt(req.nextUrl.searchParams.get('maxPages') || `${DEFAULT_MAX_PAGES}`)
    const timeBudgetParam = parseInt(req.nextUrl.searchParams.get('timeBudgetMs') || '')
    const resetProgress = req.nextUrl.searchParams.get('resetProgress') === 'true'
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7
    const maxPages = Number.isFinite(maxPagesParam) && maxPagesParam > 0 ? maxPagesParam : DEFAULT_MAX_PAGES
    const timeBudgetMs = days <= 7
      ? null
      : (Number.isFinite(timeBudgetParam) && timeBudgetParam > 0 ? timeBudgetParam : DEFAULT_TIME_BUDGET_MS)
    const startedAtMs = Date.now()

    const allWallets = (walletRegistry as Wallet[]).filter(w => !w.isExternal && !w.overviewOnly)
    if (!allWallets.length) {
      return NextResponse.json({ error: 'No active wallets configured' }, { status: 500 })
    }

    // For short lookbacks (<=7 days), process all wallets (incremental is fast).
    // For deeper backfills (>7 days), batch to stay within Vercel timeout.
    const batchSize = Number.isFinite(batchSizeParam) && batchSizeParam > 0
      ? Math.min(batchSizeParam, allWallets.length)
      : (days <= 7 ? allWallets.length : 5)
    const progressDefault: TxIndexProgress = {
      lastWalletIndex: 0,
      lastRun: '',
      backfillDays: null,
      backfillFromTs: null,
      backfillToTs: null,
      walletCursor: null,
    }
    const progressFile = days <= 7 ? null : `_index-progress.transactions.${days}d.json`
    let progress = progressDefault
    if (progressFile && !resetProgress) {
      const progressResult = await readDataFileStrict<TxIndexProgress>(progressFile, true)
      if (!progressResult.ok) {
        return NextResponse.json({ error: progressResult.error }, { status: 500 })
      }
      progress = progressResult.found ? { ...progressDefault, ...progressResult.data } : progressDefault
    }

    let fromTs: number
    let toTs: number
    if (days <= 7) {
      fromTs = now - days * 86400
      toTs = now
    } else if (
      progress.lastWalletIndex > 0 &&
      progress.backfillDays === days &&
      typeof progress.backfillFromTs === 'number' &&
      typeof progress.backfillToTs === 'number'
    ) {
      fromTs = progress.backfillFromTs
      toTs = progress.backfillToTs
    } else {
      fromTs = now - days * 86400
      toTs = now
    }

    const activeWalletCursor = days <= 7 ? null : (
      progress.walletCursor &&
      progress.walletCursor.walletIndex >= 0 &&
      progress.walletCursor.walletIndex < allWallets.length
        ? progress.walletCursor
        : null
    )
    const startIdx = days <= 7
      ? 0
      : activeWalletCursor
        ? activeWalletCursor.walletIndex
        : (progress.lastWalletIndex >= allWallets.length ? 0 : progress.lastWalletIndex)
    const endIdx = days <= 7
      ? allWallets.length
      : activeWalletCursor
        ? Math.min(startIdx + 1, allWallets.length)
        : Math.min(startIdx + batchSize, allWallets.length)
    const batch = allWallets.slice(startIdx, endIdx)

    let totalNewMoves = 0
    let totalPagesScanned = 0
    let walletsProcessed = 0
    let priceCacheDirty = false
    const modifiedFiles = new Set<string>()
    const truncatedAddresses: TruncatedAddress[] = []
    let stoppedEarlyDueToTimeBudget = false
    let nextWalletCursor: WalletScanCursor | null = activeWalletCursor
    const deadlineAtMs = timeBudgetMs == null ? null : startedAtMs + timeBudgetMs

    // Load price cache for enrichment
    const priceCacheResult = await readDataFileStrict<Record<string, unknown>>('prices.json', true)
    if (!priceCacheResult.ok) {
      return NextResponse.json({ error: priceCacheResult.error }, { status: 500 })
    }
    const priceCache = priceCacheResult.found ? priceCacheResult.data : {}

    // Collect all existing hashes across all relevant month files for dedup
    const fileCache: Record<string, any[]> = {}
    const allExistingHashes = new Set<string>()

    // Pre-load month files that could contain transactions in the date range
    const fromDate = new Date(fromTs * 1000)
    const toDate = new Date(toTs * 1000)
    const entities = [...new Set(batch.map(w => w.entity))]
    for (const entity of entities) {
      for (let d = new Date(fromDate.getFullYear(), fromDate.getMonth()); d <= toDate; d.setMonth(d.getMonth() + 1)) {
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        const fp = `transactions/${entity}/${mk}.json`
        const loaded = await loadMonthFile(fp, fileCache, allExistingHashes)
        if (!loaded.ok) {
          return NextResponse.json({ error: loaded.error, file: fp }, { status: 500 })
        }
      }
    }

    for (const wallet of batch) {
      if (timeBudgetMs != null && walletsProcessed > 0 && shouldStopForDeadline(deadlineAtMs)) {
        stoppedEarlyDueToTimeBudget = true
        break
      }

      const walletIndex = startIdx + walletsProcessed
      const indexed = await indexWallet(
        wallet,
        walletIndex,
        fromTs,
        toTs,
        allExistingHashes,
        maxPages,
        nextWalletCursor?.walletIndex === walletIndex ? nextWalletCursor : null,
        deadlineAtMs
      )
      let newMoves = indexed.newMoves
      totalPagesScanned += indexed.pagesScanned
      truncatedAddresses.push(...indexed.truncatedAddresses)

      if (newMoves.length) {
        const hydrated = await hydrateTransactionPrices(newMoves, {
          priceCache,
          fetchMissingHistory: true,
        })
        newMoves = hydrated.transactions
        priceCacheDirty = priceCacheDirty || hydrated.cacheDirty
      }

      // Route each transaction to its actual month file
      for (const m of newMoves) {
        const txDate = new Date(m.blockTime * 1000)
        const mk = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`
        const fp = `transactions/${wallet.entity}/${mk}.json`
        const loaded = await loadMonthFile(fp, fileCache, allExistingHashes)
        if (!loaded.ok) {
          return NextResponse.json({ error: loaded.error, file: fp }, { status: 500 })
        }
        fileCache[fp].push(m)
        allExistingHashes.add(movementKey(m))
        totalNewMoves++
        modifiedFiles.add(fp)
      }

      if (!indexed.completed) {
        nextWalletCursor = indexed.walletCursor
        stoppedEarlyDueToTimeBudget = true
        break
      }

      nextWalletCursor = null
      walletsProcessed++

      if (timeBudgetMs != null && shouldStopForDeadline(deadlineAtMs)) {
        stoppedEarlyDueToTimeBudget = true
        break
      }
    }

    // Write all modified files
    const writeFailures: string[] = []
    for (const filePath of modifiedFiles) {
      const txs = dedupeTransactions(fileCache[filePath] || [])
      fileCache[filePath] = txs
      const wrote = await writeDataFile(filePath, txs, `tx: batch update`)
      if (!wrote) writeFailures.push(filePath)
    }

    if (writeFailures.length) {
      return NextResponse.json({
        error: 'Failed to write one or more transaction files',
        files: writeFailures,
      }, { status: 500 })
    }

    if (priceCacheDirty) {
      const pricesSaved = await writeDataFile(
        'prices.json',
        priceCache,
        `prices: transaction hydration warm ${new Date().toISOString()}`
      )
      if (!pricesSaved) {
        return NextResponse.json({ error: 'Failed to write warmed price cache' }, { status: 500 })
      }
    }

    // Update progress
    const effectiveEndIdx = startIdx + walletsProcessed
    const nextIdx = days <= 7
      ? 0
      : nextWalletCursor
        ? nextWalletCursor.walletIndex
        : (effectiveEndIdx >= allWallets.length ? 0 : effectiveEndIdx)
    const sweepComplete = !nextWalletCursor && nextIdx === 0
    if (progressFile) {
      const nextProgress: TxIndexProgress = {
        lastWalletIndex: nextIdx,
        lastRun: new Date().toISOString(),
        backfillDays: sweepComplete ? null : days,
        backfillFromTs: sweepComplete ? null : fromTs,
        backfillToTs: sweepComplete ? null : toTs,
        walletCursor: nextWalletCursor,
      }
      const progressSaved = await writeDataFile(
        progressFile,
        nextProgress,
        `index progress: wallet ${nextIdx}/${allWallets.length}`
      )
      if (!progressSaved) {
        return NextResponse.json({ error: 'Failed to write index progress' }, { status: 500 })
      }
    }

    if (truncatedAddresses.length) {
      console.warn(`[Cron:transactions] ${truncatedAddresses.length} addresses hit maxPages=${maxPages}`)
    }

    return NextResponse.json({
      ok: true,
      walletsProcessed,
      batchStart: startIdx,
      batchEnd: walletsProcessed ? effectiveEndIdx - 1 : startIdx,
      plannedBatchEnd: batch.length ? endIdx - 1 : startIdx,
      batchSize,
      newMoves: totalNewMoves,
      modifiedFiles: [...modifiedFiles],
      filesWritten: modifiedFiles.size,
      nextBatchStart: nextIdx,
      totalWallets: allWallets.length,
      sweepComplete,
      progressFile,
      resetProgress,
      windowFromTs: fromTs,
      windowToTs: toTs,
      windowFrom: new Date(fromTs * 1000).toISOString(),
      windowTo: new Date(toTs * 1000).toISOString(),
      maxPagesPerAddress: maxPages,
      timeBudgetMs,
      elapsedMs: Date.now() - startedAtMs,
      stoppedEarlyDueToTimeBudget,
      priceCacheWarmed: priceCacheDirty,
      activeWalletCursor: nextWalletCursor,
      pagesScanned: totalPagesScanned,
      partial: truncatedAddresses.length > 0,
      truncatedAddresses,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[Cron:transactions]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
