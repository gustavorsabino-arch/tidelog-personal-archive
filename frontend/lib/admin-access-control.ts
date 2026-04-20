import { NextRequest, NextResponse } from 'next/server'

import { getAccessForEmail } from './access'
import { getAuthenticatedUser, type AuthenticatedUser } from './auth/server'
import type { AccessMeResponse } from './access-model'

type AdminAccessResult =
  | {
      ok: true
      access: AccessMeResponse
      user: AuthenticatedUser
    }
  | {
      ok: false
      response: NextResponse
    }

export async function requireAdminAccess(req: NextRequest): Promise<AdminAccessResult> {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  try {
    const access = await getAccessForEmail(user.email)
    if (!access) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Access not configured', message: 'Your account does not have access permissions.' },
          { status: 403 },
        ),
      }
    }

    if (access.role !== 'admin') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Admin access is required.' },
          { status: 403 },
        ),
      }
    }

    return { ok: true, access, user }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Access lookup failed'
    return {
      ok: false,
      response: NextResponse.json({ error: 'Access lookup failed', detail: message }, { status: 503 }),
    }
  }
}
