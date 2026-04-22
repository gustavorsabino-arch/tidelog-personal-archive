# Tidelog

Internal finance dashboard for Orca: on-chain treasury, P&L, budget, and QuickBooks reconciliation.

## Stack

- Next.js 16 (App Router, `proxy.ts` convention)
- Bun runtime
- Postgres + Drizzle ORM (local Postgres or AWS RDS via `DB_MODE`)
- Better Auth (sessions, account linking, admin plugin)
- Deployed on Vercel; Cloudflare Access gates prod once the zone is provisioned

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- Local Postgres on port 54322 (Supabase CLI default), or an AWS RDS instance
- A Google OAuth 2.0 Client ID if running in `AUTH_MODE=better-auth` (current default until Cloudflare Access is live)

## First-time setup

```bash
bun install
cp .env.example .env.local      # fill in secrets
bun run db:migrate              # applies migrations 0000→latest
bun run db:triggers             # installs audit_log append-only guard
bun scripts/set-role.ts admin you@orca.so   # seed yourself as admin
bun run dev
```

Open http://localhost:3000 — you'll be redirected to `/login` for Google sign-in.

## Auth modes

Controlled by `AUTH_MODE` (env var):

- `better-auth` — Better Auth session backed by Google OAuth. Used until Cloudflare Access is provisioned. Also set `NEXT_PUBLIC_AUTH_MODE=better-auth` so the client shows the sign-out button.
- `cf-access` — verify `Cf-Access-Jwt-Assertion` header from Cloudflare Access. Long-term production mode.

`SKIP_AUTH=admin` in development bypasses auth entirely with a synthetic admin user. Refuses to boot outside `NODE_ENV=development`.

See [docs/superpowers/specs/2026-04-22-auth-mode-toggle-design.md](docs/superpowers/specs/2026-04-22-auth-mode-toggle-design.md) for the design and [docs/dev-with-cf-access.md](docs/dev-with-cf-access.md) for the Cloudflare-Access-via-tunnel workflow.

## Useful scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Start the Next.js dev server |
| `bun run db:migrate` | Apply Drizzle migrations |
| `bun run db:push` | Sync schema directly (dev only — not for data-bearing DBs) |
| `bun run db:studio` | Drizzle Studio UI |
| `bun run db:triggers` | Install audit_log append-only triggers |
| `bun run db:seed` | Seed reference data (entities, wallets, tokens) |
| `bun run db:seed:qb-mapping` | Seed the canonical budget ↔ QuickBooks account mapping |
| `bun scripts/set-role.ts admin <email>` | Seed/promote a user to admin |
| `bun scripts/set-role.ts Dept1,Dept2 <email>` | Seed a budget_viewer scoped to those departments |
| `bun run cron:fetch-prices` | Run a single cron handler locally (substitute the handler name) |
| `bun test` | Run the Bun test suite |

## Database modes

`DB_MODE` selects the connection strategy:

- `local` — classic `DATABASE_URL` (Postgres connection string)
- `aws` — IAM-authenticated connection via `@aws-sdk/rds-signer`. Requires `DB_HOST`, `DB_NAME`, `DB_USER`, `AWS_REGION`

`MIGRATE_DATABASE_URL` can override the connection used by `drizzle-kit` (useful when Drizzle needs a superuser but the app uses a restricted role).

All app tables live in the `app` schema. Drizzle auto-qualifies queries.

## Access control

- Every request (except `/api/cron/*`, `/api/auth/*`, `/login`, `/no-access`, `/pending-approval`) must resolve to a `user` row with a non-null `role`.
- Roles: `admin` (everything) or `budget_viewer` (read-only `/budget` scoped to assigned departments).
- Unknown emails are rejected — there's no self-serve signup. Admins pre-seed users via `/admin` or the `set-role.ts` script.
- Email-domain allowlist in `ALLOWED_EMAIL_DOMAINS` is defense-in-depth; the UI and API both enforce it.

## Layout

```
app/           Next.js App Router (pages, API routes)
components/    Shared React components
lib/
  auth/        Proxy auth, Better Auth config, permissions
  budget/      Budget logic + QuickBooks reconciliation
  db/          Drizzle schema, client, migrations
  qb/          QuickBooks API client
  ...
proxy.ts       Next 16 proxy — auth gate, header injection
scripts/       One-off scripts (seed, set-role, cron runner, etc.)
docs/          Design docs and operational runbooks
```
