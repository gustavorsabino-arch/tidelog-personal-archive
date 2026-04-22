import { NextRequest, NextResponse } from 'next/server'

import { requirePermission } from '@/lib/auth/require-permission'
import {
  exchangeQboAuthorizationCode,
  getQboCallbackSuccessHtml,
  parseAndValidateQboCallbackState,
} from '@/lib/qb/client'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Only admins (budget:write) may complete the QB OAuth flow. Pairs with the
  // equivalent gate on /api/qb/connect and provides defense-in-depth against
  // a non-admin replaying a leaked state+code before the state expires.
  const { user, deny } = await requirePermission('budget:write', req)
  if (deny) return deny

  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const callbackRealmId = searchParams.get('realmId')
  const error = searchParams.get('error')

  if (error) {
    return new NextResponse(`QB auth error: ${error}`, { status: 400 })
  }

  if (!code || !state) {
    return new NextResponse('Missing code or state', { status: 400 })
  }

  try {
    const payload = parseAndValidateQboCallbackState(state)
    // Extra check: the admin who initiated connect must be the one completing
    // the callback. Prevents one admin hijacking another admin's in-flight flow.
    if (!payload.email || payload.email.toLowerCase() !== user.email.toLowerCase()) {
      return new NextResponse('State email mismatch', { status: 403 })
    }
    const connection = await exchangeQboAuthorizationCode(code, payload, callbackRealmId)

    return new NextResponse(getQboCallbackSuccessHtml(connection.entity, connection.realmId), {
      headers: { 'Content-Type': 'text/html' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = /invalid|expired|did not match/i.test(message) ? 400 : 500
    console.error('[qb/callback] exchange failed', message)
    return new NextResponse(
      status === 400 ? `Connection failed: ${message}` : 'Connection failed',
      { status },
    )
  }
}
