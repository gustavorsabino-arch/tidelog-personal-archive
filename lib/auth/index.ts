import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { db } from '@/lib/db'
import * as schema from '@/lib/db/schema'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      account: schema.account,
      session: schema.session,
      verification: schema.verification,
    },
  }),
  secret: process.env.BETTER_AUTH_SECRET!,

  // Cookie cache validates session locally from a signed cookie instead of
  // hitting the DB on every request. 5-min TTL is the better-auth default;
  // tradeoff is that revoked sessions / banned users remain valid until the
  // cookie expires. Banning is enforced separately by checking `user.banned`
  // in proxy.ts on each request via loadUserByEmail (which has its own short
  // TTL cache), so the staleness window for bans is bounded by that.
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  // Better Auth's default in-memory rate limiter is unreliable on Vercel's
  // serverless runtime: counters aren't shared across invocations, so warm
  // instances can falsely 429 legitimate sign-ins. Auth endpoints are already
  // gated by Vercel's edge protection and the proxy's role/email checks.
  rateLimit: {
    enabled: false,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      disableImplicitSignUp: true,
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async () => {
          // All user creation goes through the admin API (raw drizzle inserts).
          // Better Auth's internal user.create path is blocked as a backstop
          // so a misconfigured OAuth flow can never auto-create a user.
          return false
        },
      },
    },
  },

  plugins: [
    admin({
      // new users have no role until explicitly assigned via the admin API.
      // Better Auth's typing only permits `string | undefined`, but `null` is
      // what the plugin's runtime checks for to skip role assignment.
      defaultRole: null as unknown as undefined,
      adminRoles: ['admin'],
    }),
  ],
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
      },
    },
  },
  trustedOrigins: [
    'http://localhost:3000',
    ...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []),
  ],

  // Explicit cookie hardening — avoid relying on Better Auth defaults, which
  // have varied across versions. HttpOnly blocks JS access (XSS token theft);
  // SameSite=Lax mitigates CSRF on cross-site top-level POSTs; Secure forces
  // HTTPS in production. Applied via `defaultCookieAttributes` so it covers
  // every cookie Better Auth sets (session, csrf, oauth state, etc).
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  },
})

export type AuthSession = typeof auth.$Infer.Session
