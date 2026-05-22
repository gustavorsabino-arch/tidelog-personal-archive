import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { wallet } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { toDisplayEntity } from '@/lib/entity'

export async function GET(req: Request) {
  const { deny } = await requirePermission('treasury:read', req)
  if (deny) return deny

  const rows = await db.select().from(wallet).orderBy(wallet.label)

  // Shape matches previous consumers of /data/wallets.json
  const wallets = rows.map((w) => ({
    address: w.address,
    label: w.label,
    chain: w.chain,
    entity: toDisplayEntity(w.entityId),
    accountCode: w.accountCode,
    isExternal: w.isExternal,
    overviewOnly: w.overviewOnly,
    includeInOverview: w.includeInOverview,
    isBulkTreasury: w.isBulkTreasury,
  }))

  return NextResponse.json({ wallets })
}
