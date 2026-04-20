import walletRegistry from '@/data/wallets.json'
import { ENTITIES } from '@/lib/constants'
import { listDataFilesStrict, readDataFileStrict } from '@/lib/github'
import type {
  TreasuryManagementEntitySummary,
  TreasuryManagementPosition,
  TreasuryManagementProtocolError,
  TreasuryManagementResponse,
  TreasuryManagementSnapshot,
  TreasuryManagementWalletRegistry,
  TreasuryManagementWalletRegistryEntry,
  TreasuryManagementWalletSummary,
  Wallet,
} from '@/lib/types'

const SNAPSHOT_DIR = 'treasury-management'
const LATEST_SNAPSHOT_PATH = `${SNAPSHOT_DIR}/latest.json`
const WALLET_REGISTRY_PATH = 'config/treasury-wallets.json'
const UNMAPPED_ENTITY = 'Unmapped'

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

type GetTreasuryManagementParams = {
  entity?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function effectivePrincipalUsd(position: Pick<TreasuryManagementPosition, 'deployedPrincipalUsd' | 'principalUsd'>): number {
  return position.deployedPrincipalUsd ?? position.principalUsd
}

function walletLookupKey(address: string): string {
  return address.startsWith('0x') ? address.toLowerCase() : address
}

function addWalletToLookup(lookup: Map<string, Wallet>, wallet: Wallet) {
  if (!wallet.address) return
  lookup.set(wallet.address, wallet)
  lookup.set(walletLookupKey(wallet.address), wallet)
}

function normalizeWalletRegistryEntry(raw: unknown): TreasuryManagementWalletRegistryEntry | null {
  if (!isRecord(raw)) return null
  if (typeof raw.address !== 'string' || !raw.address) return null
  if (typeof raw.label !== 'string' || !raw.label) return null
  if (typeof raw.entity !== 'string' || !raw.entity) return null

  return {
    address: raw.address,
    label: raw.label,
    entity: raw.entity,
    accountCode: typeof raw.accountCode === 'string' ? raw.accountCode : null,
    chain: typeof raw.chain === 'string' ? raw.chain : 'unknown',
  }
}

async function buildWalletLookup() {
  const lookup = new Map<string, Wallet>()

  for (const wallet of walletRegistry as Wallet[]) {
    addWalletToLookup(lookup, wallet)
  }

  const registryResult = await readDataFileStrict<TreasuryManagementWalletRegistry>(WALLET_REGISTRY_PATH)
  if (!registryResult.ok) {
    console.error(`[TreasuryManagement] ${registryResult.error}. Falling back to bundled wallet registry.`)
    return lookup
  }

  if (!registryResult.found || !Array.isArray(registryResult.data.wallets)) {
    return lookup
  }

  for (const rawWallet of registryResult.data.wallets) {
    const wallet = normalizeWalletRegistryEntry(rawWallet)
    if (!wallet) continue

    addWalletToLookup(lookup, {
      address: wallet.address,
      label: wallet.label,
      chain: wallet.chain,
      entity: wallet.entity,
      accountCode: wallet.accountCode,
      isExternal: false,
      overviewOnly: false,
    })
  }

  return lookup
}

function normalizeErrors(rawErrors: unknown): TreasuryManagementProtocolError[] {
  if (!Array.isArray(rawErrors)) return []

  return rawErrors.flatMap((rawError) => {
    if (!isRecord(rawError)) return []

    const protocol = typeof rawError.protocol === 'string' ? rawError.protocol : ''
    const message = typeof rawError.message === 'string' ? rawError.message : ''
    if (!protocol || !message) return []

    return [{ protocol, message }]
  })
}

function normalizePositions(rawPositions: unknown, wallet: TreasuryManagementWalletSummary): TreasuryManagementPosition[] {
  if (!Array.isArray(rawPositions)) return []

  return rawPositions.flatMap((rawPosition) => {
    if (!isRecord(rawPosition)) return []

    const protocol = typeof rawPosition.protocol === 'string' ? rawPosition.protocol : ''
    const asset = typeof rawPosition.asset === 'string' ? rawPosition.asset : ''
    if (!protocol || !asset) return []

    return [{
      protocol,
      chain: typeof rawPosition.chain === 'string' ? rawPosition.chain : wallet.chain,
      entity: wallet.entity,
      walletAddr: wallet.walletAddr,
      walletLabel: wallet.walletLabel,
      accountCode: wallet.accountCode,
      asset,
      assetAddress: typeof rawPosition.assetAddress === 'string' ? rawPosition.assetAddress : '',
      totalBalance: parseNumber(rawPosition.totalBalance),
      principal: parseNumber(rawPosition.principal),
      yield: parseNumber(rawPosition.yield),
      balanceUsd: parseNumber(rawPosition.balanceUsd),
      principalUsd: parseNumber(rawPosition.principalUsd),
      yieldUsd: parseNumber(rawPosition.yieldUsd),
      positionKey: typeof rawPosition.positionKey === 'string' ? rawPosition.positionKey : null,
      trackedPositionId: typeof rawPosition.trackedPositionId === 'string' ? rawPosition.trackedPositionId : null,
      principalSource:
        rawPosition.principalSource === 'deployed' ||
        rawPosition.principalSource === 'received' ||
        rawPosition.principalSource === 'mixed' ||
        rawPosition.principalSource === 'unknown'
          ? rawPosition.principalSource
          : null,
      platform: typeof rawPosition.platform === 'string' && rawPosition.platform
        ? rawPosition.platform
        : protocol,
      vaultLabel: typeof rawPosition.vaultLabel === 'string' && rawPosition.vaultLabel
        ? rawPosition.vaultLabel
        : null,
      fundedUsd: rawPosition.fundedUsd == null ? null : parseNumber(rawPosition.fundedUsd),
      fundedAt: typeof rawPosition.fundedAt === 'string' ? rawPosition.fundedAt : null,
      deployedPrincipalUsd: rawPosition.deployedPrincipalUsd == null ? null : parseNumber(rawPosition.deployedPrincipalUsd),
      deployedAt: typeof rawPosition.deployedAt === 'string' ? rawPosition.deployedAt : null,
      marketTvlUsd: rawPosition.marketTvlUsd == null ? null : parseNumber(rawPosition.marketTvlUsd),
      yieldPct: rawPosition.yieldPct == null ? null : parseNumber(rawPosition.yieldPct),
    }]
  })
}

async function readSnapshotFile(path: string) {
  const result = await readDataFileStrict<TreasuryManagementSnapshot>(path)
  if (!result.ok) {
    throw new Error(result.error)
  }
  if (!result.found) {
    return null
  }
  return result.data
}

async function getLatestSnapshot(): Promise<{ snapshot: TreasuryManagementSnapshot | null; sourceFile: string | null }> {
  const latest = await readSnapshotFile(LATEST_SNAPSHOT_PATH)
  if (latest) {
    return { snapshot: latest, sourceFile: 'latest.json' }
  }

  const listResult = await listDataFilesStrict(SNAPSHOT_DIR)
  if (!listResult.ok) {
    throw new Error(listResult.error)
  }
  if (!listResult.found || !listResult.files.length) {
    return { snapshot: null, sourceFile: null }
  }

  const fallbackFile = [...listResult.files]
    .filter(file => file !== 'latest.json')
    .sort()
    .reverse()[0] || [...listResult.files].sort().reverse()[0]

  const snapshot = await readSnapshotFile(`${SNAPSHOT_DIR}/${fallbackFile}`)
  return {
    snapshot,
    sourceFile: fallbackFile || null,
  }
}

function sortEntities(entities: TreasuryManagementEntitySummary[]) {
  const order = new Map<string, number>(ENTITIES.map((entity, idx) => [entity, idx]))
  return [...entities].sort((a, b) => {
    const aRank = order.has(a.entity) ? order.get(a.entity)! : ENTITIES.length
    const bRank = order.has(b.entity) ? order.get(b.entity)! : ENTITIES.length
    if (aRank !== bRank) return aRank - bRank
    return b.totalUsd - a.totalUsd
  })
}

export async function getTreasuryManagementData({
  entity,
}: GetTreasuryManagementParams = {}): Promise<TreasuryManagementResponse> {
  const { snapshot, sourceFile } = await getLatestSnapshot()
  if (!snapshot) {
    return EMPTY_RESPONSE
  }
  if (!Array.isArray(snapshot.wallets)) {
    throw new Error('treasury-management snapshot is invalid')
  }

  const registryLookup = await buildWalletLookup()
  const allWallets: TreasuryManagementWalletSummary[] = []
  const allPositions: TreasuryManagementPosition[] = []

  for (const rawWallet of snapshot.wallets) {
    if (!isRecord(rawWallet)) continue

    const walletAddr = typeof rawWallet.walletAddress === 'string' ? rawWallet.walletAddress : ''
    if (!walletAddr) continue

    const registryWallet = registryLookup.get(walletAddr) || registryLookup.get(walletLookupKey(walletAddr))
    const sourceLabel = typeof rawWallet.label === 'string' && rawWallet.label ? rawWallet.label : walletAddr
    const wallet: TreasuryManagementWalletSummary = {
      walletAddr,
      walletLabel: registryWallet?.label || sourceLabel,
      sourceLabel,
      entity: registryWallet?.entity || UNMAPPED_ENTITY,
      chain: typeof rawWallet.chain === 'string' ? rawWallet.chain : 'unknown',
      accountCode: registryWallet?.accountCode ?? null,
      totalUsd: 0,
      positionCount: 0,
      protocols: [],
      errors: normalizeErrors(rawWallet.errors),
      fetchedAt: typeof rawWallet.fetchedAt === 'string' ? rawWallet.fetchedAt : null,
    }

    const positions = normalizePositions(rawWallet.positions, wallet)
    wallet.positionCount = positions.length
    wallet.totalUsd = positions.reduce((sum, position) => sum + position.balanceUsd, 0)
    wallet.protocols = [...new Set([
      ...positions.map(position => position.protocol),
      ...wallet.errors.map(error => error.protocol),
    ])].sort()

    allWallets.push(wallet)
    allPositions.push(...positions)
  }

  const entityMap = new Map<string, TreasuryManagementEntitySummary>()
  for (const wallet of allWallets) {
    if (!entityMap.has(wallet.entity)) {
      entityMap.set(wallet.entity, {
        entity: wallet.entity,
        walletCount: 0,
        positionCount: 0,
        totalUsd: 0,
        yieldUsd: 0,
      })
    }

    const entry = entityMap.get(wallet.entity)!
    entry.walletCount += 1
    entry.totalUsd += wallet.totalUsd
  }

  for (const position of allPositions) {
    if (!entityMap.has(position.entity)) continue
    const entry = entityMap.get(position.entity)!
    entry.positionCount += 1
    entry.yieldUsd += position.yieldUsd
  }

  const normalizedEntity = entity && entity !== 'All' ? entity : null
  const filteredWallets = normalizedEntity
    ? allWallets.filter(wallet => wallet.entity === normalizedEntity)
    : allWallets
  const filteredPositions = normalizedEntity
    ? allPositions.filter(position => position.entity === normalizedEntity)
    : allPositions

  const summaryProtocols = new Set(filteredPositions.map(position => position.protocol))
  const summary: TreasuryManagementResponse['summary'] = {
    totalUsd: filteredWallets.reduce((sum, wallet) => sum + wallet.totalUsd, 0),
    principalUsd: filteredPositions.reduce((sum, position) => sum + effectivePrincipalUsd(position), 0),
    yieldUsd: filteredPositions.reduce((sum, position) => sum + position.yieldUsd, 0),
    walletCount: filteredWallets.length,
    positionCount: filteredPositions.length,
    protocolCount: summaryProtocols.size,
    walletsWithErrors: filteredWallets.filter(wallet => wallet.errors.length > 0).length,
  }

  return {
    hasSnapshot: true,
    snapshotAt: typeof snapshot.snapshotAt === 'string' ? snapshot.snapshotAt : null,
    sourceFile,
    entities: sortEntities([...entityMap.values()]),
    summary,
    wallets: [...filteredWallets].sort((a, b) => b.totalUsd - a.totalUsd),
    positions: [...filteredPositions].sort((a, b) => b.balanceUsd - a.balanceUsd),
  }
}
