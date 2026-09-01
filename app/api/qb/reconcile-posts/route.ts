import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { isQboEntity } from '@/lib/qb/config'
import { reconcileEntity } from '@/lib/qb/post-batch'
import { errorMessage } from '@/lib/errors'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * POST /api/qb/reconcile-posts  { entity }
 *
 * Adopt journal entries QB created but never confirmed to us in time (QB is
 * slow right now: it 504s its own gateway while finishing the create in the
 * background). Flips reserved-but-unconfirmed qb_post rows to 'posted' once
 * the JE is visible in QB. The transactions page and the post modal call this
 * to surface just-posted entries without the user waiting on the slow create.
 */
export async function POST(req: NextRequest) {
  const { user, deny } = await requirePermission('qb:post', req)
  if (deny) return deny

  const b = await req.json().catch(() => null) as { entity?: string } | null
  const entity = b?.entity
  if (!entity || !isQboEntity(entity)) {
    return NextResponse.json({ error: 'entity must be a QuickBooks entity' }, { status: 400 })
  }

  try {
    const result = await reconcileEntity(entity, user!.id)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 })
  }
}
