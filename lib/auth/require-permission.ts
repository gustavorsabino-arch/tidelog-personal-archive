import { NextResponse } from 'next/server'
import { getServerUser, type ServerUser } from './get-user'
import { hasPermission, type Permission } from './permissions'
import { logAudit } from '@/lib/audit'

type PermitResult =
  | { user: ServerUser; deny: null }
  | { user: null; deny: NextResponse }

/**
 * Route-handler guard. Returns either the authenticated user (with permission granted)
 * or a 403/401 NextResponse to return immediately.
 *
 * Pass the incoming Request so permission checks work in tests without mocking
 * next/headers. The no-arg form uses next/headers() (server components).
 *
 * Usage:
 *   const { user, deny } = await requirePermission('treasury:read', req)
 *   if (deny) return deny
 *   // ...use user
 */
export async function requirePermission(
  permission: Permission,
  req?: Request,
): Promise<PermitResult> {
  const user = await getServerUser(req)
  if (!user) {
    return {
      user: null,
      deny: NextResponse.json(
        { error: 'Unauthorized', code: 'auth.unauthorized' },
        { status: 401 },
      ),
    }
  }

  if (!hasPermission(user.role, permission)) {
    // Fire-and-forget — audit writes must not block the 403 response. The
    // explicit `.catch` prevents any low-level DB error (e.g. socket timeout
    // after the response has been sent) from becoming an unhandled rejection.
    logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'access.denied.forbidden',
      metadata: { required: permission, role: user.role, email: user.email },
    }).catch(() => {})
    return {
      user: null,
      deny: NextResponse.json(
        {
          error: 'Forbidden',
          code: 'auth.forbidden',
          details: { required: permission },
        },
        { status: 403 },
      ),
    }
  }

  return { user, deny: null }
}
