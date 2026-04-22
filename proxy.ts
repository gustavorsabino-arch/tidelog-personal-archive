import { NextResponse, type NextRequest } from 'next/server'
import { verifyCfJwt, fetchCfJwks } from '@/lib/auth/cf-access'
import { readSkipAuthMode, readAuthMode, assertSafeStartup } from '@/lib/auth/startup-check'
import { buildDevUser } from '@/lib/auth/dev-bypass'
import { loadUserByEmail, type RequestUser } from '@/lib/auth/request-user'
import { isEmailDomainAllowed, parseAllowedDomains } from '@/lib/auth/email-domain'
import { logAudit } from '@/lib/audit'
import { auth } from '@/lib/auth'

assertSafeStartup(process.env)

const PUBLIC_PATHS = new Set(['/no-access', '/pending-approval', '/login'])
const CF_JWT_HEADER = 'cf-access-jwt-assertion'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Defense-in-depth: strip any client-forged identity headers. The proxy is
  // the sole authority that may set x-user-*; route handlers trust them only
  // because this runs first. Stripping here makes a forged header harmless
  // even if the matcher is ever relaxed or a future code path forwards
  // without re-setting them.
  const strippedHeaders = new Headers(request.headers)
  strippedHeaders.delete('x-user-id')
  strippedHeaders.delete('x-user-email')
  strippedHeaders.delete('x-user-role')
  strippedHeaders.delete('x-user-departments')

  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next({ request: { headers: strippedHeaders } })
  }
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next({ request: { headers: strippedHeaders } })
  }
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next({ request: { headers: strippedHeaders } })
  }

  const skipMode = readSkipAuthMode()
  let user: RequestUser | null = null
  let identityEmail: string | null = null

  if (skipMode.kind !== 'none') {
    const dev = buildDevUser(skipMode)
    if (dev) {
      user = {
        id: 'dev-user',
        email: dev.email,
        role: dev.role,
        departments: dev.departments,
        banned: false,
      }
    }
  } else {
    const authMode = readAuthMode()

    if (authMode === 'cf-access') {
      const token = request.headers.get(CF_JWT_HEADER)
      if (!token) {
        return denyResponse(request, 401, 'auth.no_cf_jwt', 'Missing Cloudflare Access JWT.')
      }
      let claims
      try {
        claims = await verifyCfJwt(token, {
          aud: process.env.CF_ACCESS_AUD!,
          issuer: `https://${process.env.CF_ACCESS_TEAM_DOMAIN!}`,
          jwks: () => fetchCfJwks(process.env.CF_ACCESS_TEAM_DOMAIN!),
        })
      } catch (err) {
        await logAudit({
          action: 'access.denied.invalid_jwt',
          metadata: { reason: (err as Error).message, path: pathname },
        })
        return denyResponse(request, 401, 'auth.invalid_jwt', 'Invalid Cloudflare Access JWT.')
      }
      identityEmail = (claims.email ?? '').toLowerCase()
    } else {
      // better-auth mode
      let session
      try {
        session = await auth.api.getSession({ headers: request.headers })
      } catch (err) {
        await logAudit({
          action: 'access.denied.session_error',
          metadata: { reason: (err as Error).message, path: pathname },
        })
        return unauthenticatedResponse(request, pathname)
      }
      if (!session?.user?.email) {
        return unauthenticatedResponse(request, pathname)
      }
      const email = session.user.email.trim().toLowerCase()
      if (!email) {
        return unauthenticatedResponse(request, pathname)
      }
      identityEmail = email
    }

    if (!identityEmail) {
      return denyResponse(request, 401, 'auth.no_email', 'No email in identity.')
    }

    const allowedDomains = parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS)
    if (!isEmailDomainAllowed(identityEmail, allowedDomains)) {
      await logAudit({
        action: 'access.denied.disallowed_domain',
        metadata: { email: identityEmail, path: pathname },
      })
      return pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Email domain not allowed', code: 'auth.disallowed_domain' }, { status: 403 })
        : NextResponse.redirect(new URL('/no-access', request.url))
    }

    user = await loadUserByEmail(identityEmail)

    if (!user) {
      await logAudit({
        action: 'access.denied.unknown_email',
        metadata: { email: identityEmail, path: pathname },
      })
      return pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Unknown email', code: 'auth.unknown_email' }, { status: 403 })
        : NextResponse.redirect(new URL('/no-access', request.url))
    }
  }

  if (!user) {
    return denyResponse(request, 401, 'auth.no_user', 'No authenticated user.')
  }

  if (user.banned) {
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'access.denied.banned',
      metadata: { email: user.email, path: pathname },
    })
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Account banned', code: 'auth.banned' }, { status: 403 })
      : NextResponse.redirect(new URL('/no-access', request.url))
  }

  if (!user.role) {
    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'access.denied.no_role',
      metadata: { email: user.email, path: pathname },
    })
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'No role assigned', code: 'auth.no_role' }, { status: 403 })
      : NextResponse.redirect(new URL('/pending-approval', request.url))
  }

  // Start from stripped headers (no client-forged x-user-*) then set the
  // authoritative values from the verified identity.
  strippedHeaders.set('x-user-id', user.id)
  strippedHeaders.set('x-user-email', user.email)
  strippedHeaders.set('x-user-role', user.role)
  strippedHeaders.set('x-user-departments', user.departments.join(','))

  return NextResponse.next({ request: { headers: strippedHeaders } })
}

function denyResponse(request: NextRequest, status: number, code: string, message: string) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: message, code }, { status })
  }
  return NextResponse.redirect(new URL('/no-access', request.url))
}

function unauthenticatedResponse(request: NextRequest, pathname: string) {
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated', code: 'auth.no_session' }, { status: 401 })
  }
  const loginUrl = new URL('/login', request.url)
  const next = pathname + request.nextUrl.search
  // Only accept internal redirects — reject external hosts / protocol-relative URLs.
  if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) {
    loginUrl.searchParams.set('next', next)
  }
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    // Run on every request except Next's internal asset paths. The previous
    // matcher exempted image-extension URLs, which let requests ending in
    // .png/.svg/etc. reach route handlers without identity verification —
    // any route that accepted an arbitrary path segment could have received
    // client-forged x-user-* headers. Next serves files from /public
    // without middleware when they physically exist, so no exclusion needed.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
