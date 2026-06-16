import { NextResponse } from 'next/server'
import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, walletTokenAccountCode } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { toDisplayEntity } from '@/lib/entity'

export async function GET(req: Request) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const rows = await db.select().from(wallet).orderBy(wallet.label)

  // Load per-token GL mappings for all wallet addresses in one query.
  const addresses = rows.map((w) => w.address)
  const tokenGlRows = addresses.length > 0
    ? await db
        .select({
          walletAddress: walletTokenAccountCode.walletAddress,
          tokenSymbol: walletTokenAccountCode.tokenSymbol,
          accountCode: walletTokenAccountCode.accountCode,
        })
        .from(walletTokenAccountCode)
        .where(inArray(walletTokenAccountCode.walletAddress, addresses))
    : []

  // Group per-token rows by walletAddress.
  const tokenGlByWallet = new Map<string, { tokenSymbol: string; accountCode: string }[]>()
  for (const r of tokenGlRows) {
    const list = tokenGlByWallet.get(r.walletAddress) ?? []
    list.push({ tokenSymbol: r.tokenSymbol, accountCode: r.accountCode })
    tokenGlByWallet.set(r.walletAddress, list)
  }

  // Shape matches previous consumers of /data/wallets.json
  const wallets = rows.map((w) => ({
    address: w.address,
    label: w.label,
    chain: w.chain,
    entity: toDisplayEntity(w.entityId),
    accountCode: w.accountCode,
    qbVendorName: w.qbVendorName ?? null,
    qbClassName: w.qbClassName ?? null,
    type: w.type,
    hiddenFromFinance: w.hiddenFromFinance,
    needsBackfill: w.needsBackfill,
    lastFullBackfillAt: w.lastFullBackfillAt?.toISOString() ?? null,
    isBulkTreasury: w.isBulkTreasury,
    tokenGls: tokenGlByWallet.get(w.address) ?? [],
  }))

  return NextResponse.json({ wallets })
}
