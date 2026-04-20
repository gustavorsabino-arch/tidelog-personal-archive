import { NextRequest, NextResponse } from 'next/server'

import { getAccessForEmail } from '@/lib/access'
import { getAuthenticatedUser } from '@/lib/auth/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  try {
    const requestedYear = Number.parseInt(req.nextUrl.searchParams.get('year') ?? '', 10)
    const access = await getAccessForEmail(user.email, {
      year: Number.isFinite(requestedYear) ? requestedYear : null,
    })
    if (!access) {
      return NextResponse.json(
        {
          error: 'Access not configured',
          message: 'Your account does not have access permissions. Please contact an administrator.',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    return NextResponse.json(access, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Access lookup failed'
    return NextResponse.json(
      { error: 'Access lookup failed', detail: message },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
