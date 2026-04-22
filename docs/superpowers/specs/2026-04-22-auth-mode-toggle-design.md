---
name: Auth Mode Toggle (CF Access ↔ Better Auth + Google)
date: 2026-04-22
status: Draft
supersedes: partial (extends 2026-04-20-auth-and-data-rebuild-design.md §2)
---

# Auth Mode Toggle — Design

## Context

The 2026-04-20 rebuild committed to **Cloudflare Access + Better Auth**: CF Access at the edge owns identity, Better Auth in-app owns sessions + roles. That design assumes a CF zone with a dev Access application for local testing.

We're deploying to Vercel now, and the `orca.so` CF zone + Access app aren't set up yet. We need to ship without CF Access and bolt it on later without rewriting auth code.

## Goal

Introduce an `AUTH_MODE` env var with two values:

- `cf-access` — current behavior (CF JWT verification). Remains the supported production mode once the CF zone is ready.
- `better-auth` — Better Auth session with Google OAuth as the identity source. Temporary production mode until CF Access is provisioned.

Both modes share the downstream user-resolution path so role/department/banned gates are identical.

## Non-goals

- Removing the CF Access code path. Both modes stay in the tree.
- Multi-IdP support (Google only for `better-auth` mode).
- Self-serve signup. Unknown emails are always rejected; admins pre-create users.
- Changing the DB schema. Better Auth's existing `user`/`account`/`session`/`verification` tables already support OAuth.

---

## Section 1 — Env vars and startup guard

### New env vars

```ini
# Auth mode selector. Defaults to 'cf-access' if unset for backwards-compat.
AUTH_MODE=better-auth            # 'cf-access' | 'better-auth'

# Google OAuth (required when AUTH_MODE=better-auth)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# App URL used by Better Auth for OAuth callbacks + trusted origins.
# Already declared in .env.example but currently optional; becomes required in better-auth mode.
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Existing vars unchanged: `SKIP_AUTH`, `DEV_USER_EMAIL`, `BETTER_AUTH_SECRET`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ALLOWED_EMAIL_DOMAINS`.

### Startup guard (extends `lib/auth/startup-check.ts`)

Add `parseAuthMode(raw) → 'cf-access' | 'better-auth'`. Empty or unset → `'cf-access'`. Any other value throws.

Extend `assertSafeStartup(env)` to additionally refuse to boot when:

- `AUTH_MODE=better-auth` and (`GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` or `NEXT_PUBLIC_APP_URL`) is missing.
- `AUTH_MODE=cf-access` and (`CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD`) is missing **and** `SKIP_AUTH=none`. (Lets dev bypass still work with neither set.)

Fail-closed ordering: existing `SKIP_AUTH`-outside-prod guard runs first, then the new `AUTH_MODE` checks.

### `.env.example` update

Add the three new vars with comments mirroring the existing section layout. Document that `AUTH_MODE=cf-access` is the long-term production target.

---

## Section 2 — Rename `middleware.ts` → `proxy.ts`

Next.js 16 deprecated the `middleware` file convention in favor of `proxy`. Function name changes from `middleware` to `proxy`; file moves to `proxy.ts` at project root.

**Migration:** run `npx @next/codemod@canary middleware-to-proxy .` — it renames the file and function. Commit the codemod output separately from the auth changes so the rename diff is reviewable on its own.

**Git history preservation:** the codemod uses `fs.rename` which git usually detects as a rename. If `git status` shows delete+add instead of rename after running, follow with `git mv` to make the rename explicit before staging further edits.

No behavior change from the rename — all existing CF JWT logic, matcher config, and header injection stay intact in `proxy.ts`.

Other references to update:
- Internal comments referencing "middleware" in `lib/auth/*.ts` files
- `docs/dev-with-cf-access.md` references to `middleware.ts`

---

## Section 3 — Proxy branching logic

New shape of `proxy.ts`:

```
1. /api/cron/*                    → NextResponse.next() (CRON_SECRET in handler)
2. /api/auth/*                    → NextResponse.next() (Better Auth owns)
3. PUBLIC_PATHS                   → NextResponse.next()
   = { '/no-access', '/pending-approval', '/login' }

4. SKIP_AUTH != 'none' (dev only) → synthetic user → shared downstream path

5. Branch on AUTH_MODE:
   5a. 'cf-access':
       - read 'cf-access-jwt-assertion' header
       - verifyCfJwt (jose) against CF_ACCESS_TEAM_DOMAIN JWKS, aud=CF_ACCESS_AUD
       - missing/invalid → 401 or /no-access
       - email = claims.email

   5b. 'better-auth':
       - call auth.api.getSession({ headers: request.headers })
       - no session → /login?next=<pathname> (pages) or 401 (api)
       - session.user.banned → /no-access (Better Auth banned is different source of truth; still cross-check below for parity)
       - email = session.user.email

6. Shared downstream (identical for both modes):
   - parseAllowedDomains / isEmailDomainAllowed → /no-access on fail
   - loadUserByEmail → null → /no-access
   - user.banned → /no-access
   - user.role === null → /pending-approval
   - inject x-user-{id,email,role,departments} headers
   - NextResponse.next({ request: { headers: requestHeaders } })
```

### Why call `auth.api.getSession` inside the proxy

Better Auth's session is a signed cookie. `auth.api.getSession({ headers })` verifies + decodes it without a DB roundtrip for valid sessions (it only hits the DB for additional fields or invalidated sessions). The Node.js runtime requirement — Next 16 proxy defaults to Node.js, so this works.

### Redirect-after-login

When redirecting unauthenticated users to `/login`, pass `?next=<original-pathname-and-search>`. The login page reads `next` and passes it as `callbackURL` to `authClient.signIn.social(...)`. Better Auth redirects back to that URL after OAuth completes. Reject external origins in `next` (simple check: starts with `/`, doesn't start with `//` or `/\`).

---

## Section 4 — Better Auth config changes

Edit `lib/auth/index.ts`:

```ts
export const auth = betterAuth({
  database: drizzleAdapter(db, { /* unchanged */ }),
  secret: process.env.BETTER_AUTH_SECRET!,

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      disableImplicitSignUp: true,  // reject unknown-email sign-ins
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async () => {
          // Belt-and-suspenders: block any user-row creation via Better Auth.
          // Admin UI inserts directly via drizzle and bypasses this hook.
          throw new Error('user.create blocked — use admin API')
        },
      },
    },
  },

  plugins: [admin({ defaultRole: null as unknown as undefined, adminRoles: ['admin'] })],
  user: { additionalFields: { role: { type: 'string', required: false } } },
  trustedOrigins: [
    'http://localhost:3000',
    ...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []),
  ],
})
```

**Fallback values (`?? ''`) for Google creds** are intentional — the startup guard already refuses to boot in `better-auth` mode without them, so this code path is only reachable in `cf-access` mode where the Google creds are irrelevant.

**Verify with Better Auth docs before implementation** that `disableImplicitSignUp: true` is the current flag name and that the `databaseHooks.user.create.before` signature matches. If it has changed, use the closest equivalent and note it in the plan.

---

## Section 5 — Login and logout UX

### `/login` page (new)

- Server component default → render client subcomponent for button interactions
- Single "Sign in with Google" button → `authClient.signIn.social({ provider: 'google', callbackURL })`
- `callbackURL` = sanitized `?next=` query param, else `/`
- Error banner when `?error=` is present. Map codes:
  - `unknown_email` — "Your email isn't authorized. Contact an admin."
  - `invalid_grant` / `access_denied` — "Sign-in cancelled or failed."
- Only rendered in `AUTH_MODE=better-auth`. If user hits `/login` in `cf-access` mode, redirect to `/`.

### Sign-out

- Add a "Sign out" item to the existing navbar user menu
- Rendered conditionally: only when `AUTH_MODE=better-auth` (CF mode has no logout we own)
- Handler calls `authClient.signOut({ fetchOptions: { onSuccess: () => router.push('/login') } })`

### Error propagation from proxy

When `disableImplicitSignUp` rejects an unknown email, Better Auth returns the user to the `/api/auth/callback/google` handler which redirects to `callbackURL` with an error query. Configure the callback error URL to `/login?error=unknown_email` via Better Auth's `onAPIError` or the provider's `errorURL` field (verify exact option name at implementation time).

---

## Section 6 — Admin flow (unchanged)

`POST /api/admin/users` continues to insert into `user` table directly via Drizzle, bypassing Better Auth's `databaseHooks.user.create.before`. Account linking (`POST /api/admin/users/[id]/link-email` or equivalent) unchanged.

The first user for a fresh deploy is seeded via:
1. `bun run scripts/seed.ts` (extend if needed), OR
2. Direct SQL `INSERT` against `user` with `role='admin'`, then use `/admin` to add more.

Seeded user must have `role='admin'` or `role='budget_viewer'` — `role=null` lands on `/pending-approval`.

---

## Section 7 — Testing

### Unit tests

- `lib/auth/startup-check.test.ts` — extend with `parseAuthMode` cases and new guard combinations
- `lib/auth/auth-mode.test.ts` (new, if a separate parser file is extracted) — parser boundary cases

### Proxy integration tests

Create `proxy.test.ts` (rename existing `middleware.test.ts` via codemod). Table-driven:

| Scenario | AUTH_MODE | Setup | Expected |
|---|---|---|---|
| Valid CF JWT, known user | cf-access | mock JWKS | 200, x-user-* headers |
| Missing CF JWT | cf-access | no header | 401 |
| Valid Better Auth session, known user | better-auth | mock session cookie | 200, x-user-* headers |
| No Better Auth session | better-auth | no cookie | 302 → /login?next=... |
| Unknown email | both | loadUserByEmail → null | 302 → /no-access |
| Banned user | both | user.banned = true | 302 → /no-access |
| role=null | both | user.role = null | 302 → /pending-approval |
| SKIP_AUTH=admin overrides both | both | env set, NODE_ENV=development | 200, dev-user headers |

### Manual smoke test plan

1. **`AUTH_MODE=cf-access` path** — unchanged, covered by existing `docs/dev-with-cf-access.md` when the CF zone is available.
2. **`AUTH_MODE=better-auth` path** — `.env.local` with Google creds → `bun run dev` → navigate to `/` → redirect to `/login` → click Google → sign in with a seeded `@orca.so` account → land on `/`. Sign out → back to `/login`.
3. **Unknown email rejection** — sign in with a Google account not seeded in the DB → redirect to `/login?error=unknown_email`.

---

## Section 8 — Migration path (enabling CF Access later)

When the `orca.so` CF zone + Access app are ready:

1. Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` in Vercel env
2. Flip `AUTH_MODE=cf-access` in prod
3. Redeploy
4. Existing sessions invalidate (Better Auth cookie no longer consulted); users re-auth via CF Access

No code change required. The `/login` page, sign-out button, and Google credentials become dormant but harmless.

---

## Risks and trade-offs

- **Two auth paths = double test surface.** Mitigated by sharing the downstream path (domain allowlist, `loadUserByEmail`, role/banned gates) — mode-specific code is narrow.
- **Better Auth's `disableImplicitSignUp` is a social-provider setting we haven't battle-tested.** The `databaseHooks.user.create.before` throw is the hard backstop.
- **Session-invalidation on mode flip.** Expected behavior; documented in Section 8.
- **Google OAuth app needs redirect URIs for every environment.** Add `http://localhost:3000/api/auth/callback/google` + Vercel preview + Vercel prod. Preview URLs with rotating hashes will require a wildcard strategy or env-per-preview — out of scope for v1; treat previews as authenticated manually if needed.
- **`NEXT_PUBLIC_APP_URL` exposure.** Already public by prefix convention; used only for OAuth callback origin, not a secret.

---

## File inventory

**New files:**
- `app/login/page.tsx` + `app/login/login-button.tsx` (client subcomponent)
- `lib/auth/auth-mode.ts` (if extracted; else inlined into startup-check.ts)

**Renamed:**
- `middleware.ts` → `proxy.ts` (Next 16 convention)
- `middleware.test.ts` → `proxy.test.ts` (if present — check at implementation time)

**Modified:**
- `lib/auth/index.ts` — add `socialProviders`, `databaseHooks`
- `lib/auth/startup-check.ts` — add `parseAuthMode` + extended guard
- `proxy.ts` (ex-middleware.ts) — add AUTH_MODE branching + /login redirect
- `.env.example` — document new vars
- `components/<navbar>` — add conditional Sign out button
- `docs/dev-with-cf-access.md` — note the new AUTH_MODE toggle, mark CF path as one of two supported modes

**Unchanged:**
- Database schema, migrations, seed scripts
- `/api/admin/users/*` routes
- All downstream gates (`loadUserByEmail`, banned/role checks, header injection)
