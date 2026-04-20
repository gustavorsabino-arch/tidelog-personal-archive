import { NextRequest, NextResponse } from 'next/server'

import { BUDGET_QBO_ENTITIES } from '@/lib/qb/config'
import { getQboConnectionByEntity } from '@/lib/qb/store'
import { isQboExpiringSoon } from '@/lib/qb/tokens'
import { refreshQboConnection } from '@/lib/qb/client'

export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET || ''

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let refreshed = 0
  let failed = 0
  let connected = 0

  for (const entity of BUDGET_QBO_ENTITIES) {
    try {
      const connection = await getQboConnectionByEntity(entity)
      if (!connection) continue
      connected += 1

      if (isQboExpiringSoon(connection.expiresAt)) {
        await refreshQboConnection(entity)
        refreshed += 1
      }
    } catch {
      failed += 1
    }
  }

  return NextResponse.json({ ok: true, connected, refreshed, failed })
}
