// GET /api/qb/accounts?entity=Opco
// Returns the entity's QB account catalog. Used by the Counterparty GL
// dropdown on the transactions page. Cached client-side via SWR.

import { NextRequest, NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/require-permission'
import { db } from '@/lib/db'
import { qbAccountCatalog } from '@/lib/db/schema'
import { toDbEntity } from '@/lib/entity'

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('qb:read', req)
  if (deny) return deny

  const entity = req.nextUrl.searchParams.get('entity')
  if (!entity) {
    return NextResponse.json({ error: 'entity required' }, { status: 400 })
  }
  const dbEntity = toDbEntity(entity)

  const rows = await db
    .select({
      qbAccountId: qbAccountCatalog.qbAccountId,
      qbAccountNumber: qbAccountCatalog.qbAccountNumber,
      qbAccountName: qbAccountCatalog.qbAccountName,
      accountType: qbAccountCatalog.accountType,
    })
    .from(qbAccountCatalog)
    .where(eq(qbAccountCatalog.entityId, dbEntity))
    .orderBy(asc(qbAccountCatalog.qbAccountNumber))

  // Drop entries with null account_number — the Counterparty GL dropdown
  // needs a number to display; catalog entries without one are not useful here.
  const accounts = rows
    .filter(r => r.qbAccountNumber != null)
    .map(r => ({
      qbAccountId: r.qbAccountId,
      qbAccountNumber: r.qbAccountNumber!,
      qbAccountName: r.qbAccountName,
      accountType: r.accountType,
    }))

  return NextResponse.json({ entity, accounts })
}
