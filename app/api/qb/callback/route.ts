import { NextRequest, NextResponse } from 'next/server'

import {
  exchangeQboAuthorizationCode,
  getQboCallbackSuccessHtml,
  parseAndValidateQboCallbackState,
} from '@/lib/qb/client'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
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
    const connection = await exchangeQboAuthorizationCode(code, payload, callbackRealmId)

    return new NextResponse(getQboCallbackSuccessHtml(connection.entity, connection.realmId), {
      headers: { 'Content-Type': 'text/html' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = /invalid|expired|did not match/i.test(message) ? 400 : 500
    return new NextResponse(`Connection failed: ${message}`, { status })
  }
}
