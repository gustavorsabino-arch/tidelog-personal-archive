import { NextRequest, NextResponse } from 'next/server'

import { requireBudgetAccess } from '@/lib/budget/access-control'
import { createQboConnectUrl } from '@/lib/qb/client'
import { isQboEntity } from '@/lib/qb/config'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'import' })
  if (!accessResult.ok) return accessResult.response

  try {
    const entity = req.nextUrl.searchParams.get('entity')
    if (!entity || !isQboEntity(entity)) {
      return NextResponse.json({ error: 'Missing or invalid entity' }, { status: 400 })
    }

    return NextResponse.redirect(createQboConnectUrl(entity, accessResult.user.email))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'QuickBooks connect failed'
    return NextResponse.json({ error: 'QuickBooks connect failed', detail: message }, { status: 503 })
  }
}
