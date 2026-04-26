import { NextResponse } from 'next/server'
import { getInitialAccess } from '@/lib/auth/server-access'

/**
 * Returns the authenticated user's access profile in the shape the UI expects.
 * The proxy has already verified the JWT (or applied the dev bypass) and
 * injected x-user-* headers, so reading from them is sufficient.
 *
 * 401 when no user is on the request. Most callers shouldn't hit this — the
 * root layout inlines the same access payload into the HTML so the client has
 * it at first paint without a round-trip.
 */
export async function GET(req: Request) {
  const access = await getInitialAccess(req)
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(access)
}
