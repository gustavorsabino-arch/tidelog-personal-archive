import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { getAllowedPages, resolveAccessUser } from '@/lib/access-model'
import { loadAccessConfigByEmailWithClient } from '@/lib/access-store'

const ALWAYS_ALLOWED_PAGE_PATHS = new Set(['/login'])
const ALWAYS_ALLOWED_API_PREFIXES = ['/api/access/', '/api/budget/', '/api/qb/']

function isBudgetPagePath(pathname: string): boolean {
  return pathname === '/budget'
}

function isBudgetAllowedApiPath(pathname: string): boolean {
  return ALWAYS_ALLOWED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function denyBudgetOnlyRequest(request: NextRequest, reason: string) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: reason }, { status: 403 })
  }

  return NextResponse.redirect(new URL('/budget', request.url))
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Skip auth only in explicit dev mode
  if (process.env.SKIP_AUTH === 'true' && process.env.NODE_ENV === 'development') {
    return response
  }

  // Require Supabase config in production
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 503 })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options as any))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Allow login page and auth callback
  if (ALWAYS_ALLOWED_PAGE_PATHS.has(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith('/auth/')) {
    return response
  }

  // Allow cron API routes (secured by CRON_SECRET header)
  if (request.nextUrl.pathname.startsWith('/api/cron/')) {
    return response
  }

  // Not authenticated → login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Domain restriction: must be @orca.so
  if (!user.email?.endsWith('@orca.so')) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=domain', request.url))
  }

  try {
    const accessConfig = await loadAccessConfigByEmailWithClient(supabase as any, user.email)
    const access = resolveAccessUser(accessConfig, user.email)

    if (!access) {
      if (request.nextUrl.pathname === '/budget' || request.nextUrl.pathname.startsWith('/api/access/')) {
        return response
      }

      return denyBudgetOnlyRequest(
        request,
        'Access not configured. Please contact an administrator.',
      )
    }

    const allowedPages = getAllowedPages(access)
    if (allowedPages === null) {
      return response
    }

    if (request.nextUrl.pathname.startsWith('/api/')) {
      if (!isBudgetAllowedApiPath(request.nextUrl.pathname)) {
        return denyBudgetOnlyRequest(
          request,
          'Your account is limited to budget APIs.',
        )
      }

      return response
    }

    if (!isBudgetPagePath(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL('/budget', request.url))
    }
  } catch {
    if (request.nextUrl.pathname === '/budget' || request.nextUrl.pathname.startsWith('/api/access/')) {
      return response
    }

    return denyBudgetOnlyRequest(
      request,
      'Access lookup failed. Please try again in a moment.',
    )
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
