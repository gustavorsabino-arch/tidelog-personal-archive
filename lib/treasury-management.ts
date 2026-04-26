import 'server-only'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { balanceSnapshot } from '@/lib/db/schema/financial'
import { wallet } from '@/lib/db/schema/reference'
import { getCurrentPrices } from '@/lib/defillama'
import { PRICE_MINTS, STABLE_TOKENS } from '@/lib/constants'
import type {
  TreasuryManagementEntitySummary,
  TreasuryManagementPosition,
  TreasuryManagementResponse,
  TreasuryManagementSummary,
  TreasuryManagementWalletSummary,
} from '@/lib/types'

/**
 * Simplified Treasury Management view.
 *
 * Shows wallets labeled `Treasury Management - <Protocol>` with their current
 * on-chain token balances. Protocol is derived from the label suffix; yield is
 * not tracked yet (principal == totalBalance, yield == 0). Rich per-position
 * principal/yield split requires per-protocol SDK adapters (Kamino, Aave,
 * Morpho, SAVE, Project Treasure Hunt) which are out of scope for this pass.
 */

const EMPTY_RESPONSE: TreasuryManagementResponse = {
  hasSnapshot: false,
  snapshotAt: null,
  sourceFile: null,
  entities: [],
  summary: {
    totalUsd: 0,
    principalUsd: 0,
    yieldUsd: 0,
    walletCount: 0,
    positionCount: 0,
    protocolCount: 0,
    walletsWithErrors: 0,
  },
  wallets: [],
  positions: [],
}

type Params = { entity?: string | null }

function entityIdToDisplay(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function deriveProtocol(label: string): string {
  const match = label.match(/Treasury Management\s*[-–]\s*(.+)$/i)
  return match ? match[1].trim() : 'Unknown'
}

const MINT_BY_SYMBOL = Object.fromEntries(
  Object.entries(PRICE_MINTS).map(([symbol, mint]) => [symbol, mint]),
) as Record<string, string>

export async function getTreasuryManagementData(
  params: Params = {},
): Promise<TreasuryManagementResponse> {
  const entityFilter = params.entity && params.entity !== 'All'
    ? params.entity.toLowerCase()
    : null

  const walletRows = await db
    .select({
      address: wallet.address,
      label: wallet.label,
      chain: wallet.chain,
      entityId: wallet.entityId,
      accountCode: wallet.accountCode,
    })
    .from(wallet)
    .where(
      and(
        eq(wallet.isExternal, false),
        like(wallet.label, 'Treasury Management%'),
        entityFilter ? eq(wallet.entityId, entityFilter) : undefined,
      ),
    )

  if (walletRows.length === 0) return EMPTY_RESPONSE

  const addresses = walletRows.map((w) => w.address)

  // Latest balance per (wallet, token)
  const snapshots = await db
    .select({
      walletAddress: balanceSnapshot.walletAddress,
      token: balanceSnapshot.token,
      amount: balanceSnapshot.amount,
      date: balanceSnapshot.date,
      fetchedAt: balanceSnapshot.fetchedAt,
      rn: sql<number>`row_number() over (partition by ${balanceSnapshot.walletAddress}, ${balanceSnapshot.token} order by ${balanceSnapshot.date} desc)`.as('rn'),
    })
    .from(balanceSnapshot)
    .where(inArray(balanceSnapshot.walletAddress, addresses))

  const latestSnapshots = snapshots.filter((s) => s.rn === 1 && Number(s.amount) > 0)
  if (latestSnapshots.length === 0) return EMPTY_RESPONSE

  const tokenSymbols = Array.from(new Set(latestSnapshots.map((s) => s.token)))
  const currentPrices = tokenSymbols.length > 0 ? await getCurrentPrices() : {}
  const priceByToken = new Map<string, number>(Object.entries(currentPrices))

  const positions: TreasuryManagementPosition[] = []
  const walletsByAddr = new Map<string, TreasuryManagementWalletSummary>()
  const entityAgg = new Map<string, { walletAddrs: Set<string>; positionCount: number; totalUsd: number }>()
  let latestFetchedAt: string | null = null

  for (const walletRow of walletRows) {
    const protocol = deriveProtocol(walletRow.label)
    const entityDisplay = entityIdToDisplay(walletRow.entityId)
    const walletSnapshots = latestSnapshots.filter((s) => s.walletAddress === walletRow.address)

    let walletTotalUsd = 0
    const walletPositions: TreasuryManagementPosition[] = []
    let fetchedAt: string | null = null

    for (const snapshot of walletSnapshots) {
      const priceUsd = priceByToken.get(snapshot.token) ?? (STABLE_TOKENS.has(snapshot.token) ? 1 : 0)
      const amount = Number(snapshot.amount)
      const usd = amount * priceUsd
      walletTotalUsd += usd
      const iso = snapshot.fetchedAt instanceof Date ? snapshot.fetchedAt.toISOString() : String(snapshot.fetchedAt)
      if (!fetchedAt || iso > fetchedAt) fetchedAt = iso
      if (!latestFetchedAt || iso > latestFetchedAt) latestFetchedAt = iso

      walletPositions.push({
        protocol,
        chain: walletRow.chain,
        entity: entityDisplay,
        walletAddr: walletRow.address,
        walletLabel: walletRow.label,
        accountCode: walletRow.accountCode,
        asset: snapshot.token,
        assetAddress: MINT_BY_SYMBOL[snapshot.token] ?? '',
        totalBalance: amount,
        principal: amount,
        yield: 0,
        balanceUsd: usd,
        principalUsd: usd,
        yieldUsd: 0,
        positionKey: `${walletRow.address}:${snapshot.token}`,
        trackedPositionId: null,
        principalSource: 'unknown',
        platform: protocol,
        vaultLabel: null,
        fundedUsd: null,
        fundedAt: null,
        deployedPrincipalUsd: null,
        deployedAt: null,
        marketTvlUsd: null,
        yieldPct: null,
      })
    }

    if (walletPositions.length === 0) continue

    positions.push(...walletPositions)

    walletsByAddr.set(walletRow.address, {
      walletAddr: walletRow.address,
      walletLabel: walletRow.label,
      sourceLabel: protocol,
      entity: entityDisplay,
      chain: walletRow.chain,
      accountCode: walletRow.accountCode,
      totalUsd: walletTotalUsd,
      positionCount: walletPositions.length,
      protocols: [protocol],
      errors: [],
      fetchedAt,
    })

    const agg = entityAgg.get(entityDisplay) ?? { walletAddrs: new Set<string>(), positionCount: 0, totalUsd: 0 }
    agg.walletAddrs.add(walletRow.address)
    agg.positionCount += walletPositions.length
    agg.totalUsd += walletTotalUsd
    entityAgg.set(entityDisplay, agg)
  }

  const wallets = Array.from(walletsByAddr.values()).sort((a, b) => b.totalUsd - a.totalUsd)
  const entities: TreasuryManagementEntitySummary[] = Array.from(entityAgg.entries()).map(([entity, agg]) => ({
    entity,
    walletCount: agg.walletAddrs.size,
    positionCount: agg.positionCount,
    totalUsd: agg.totalUsd,
    yieldUsd: 0,
  }))

  const protocolSet = new Set(positions.map((p) => p.protocol))
  const summary: TreasuryManagementSummary = {
    totalUsd: wallets.reduce((sum, w) => sum + w.totalUsd, 0),
    principalUsd: wallets.reduce((sum, w) => sum + w.totalUsd, 0),
    yieldUsd: 0,
    walletCount: wallets.length,
    positionCount: positions.length,
    protocolCount: protocolSet.size,
    walletsWithErrors: 0,
  }

  return {
    hasSnapshot: true,
    snapshotAt: latestFetchedAt,
    sourceFile: 'balance_snapshot',
    entities,
    summary,
    wallets,
    positions,
  }
}
