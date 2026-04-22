# Auth & Data Rebuild — Design Spec

**Date:** 2026-04-20
**Status:** Shipped 2026-04-21
**Scope:** Full architectural rebuild. Replace Supabase Auth with Better Auth + Cloudflare Access. Migrate GitHub-as-JSON data store to Postgres via Drizzle. Flatten repo to a single Next.js fullstack app. Adopt Bun runtime. Deploy to Dokploy with self-hosted Supabase.

---

## Goals

1. **Confidentiality first.** Financial and on-chain data is highly sensitive. A single auth fault breaks the project. Two layers of auth (Cloudflare Access edge + Better Auth in-app) keep unauthenticated traffic off the server entirely.
2. **Speed.** Co-locate Next.js, cron jobs, and Postgres on one Dokploy server. Replace external file-based storage (GitHub JSON) with indexed Postgres queries.
3. **Do not reinvent security-critical code.** Use Better Auth for sessions, roles, account linking. Use CF Access for identity. Drizzle for parameterized queries. `jose` for JWT verification.
4. **Maintainable single-repo layout.** One Next.js app, all routes and cron in the same codebase.

## Non-goals

- HA / multi-node deployment
- Read replicas
- Separate staging environment (assume one prod + local dev)
- Backup strategy details (handled by Supabase template + Dokploy volume snapshots)
- Realtime / WebSocket features (not used today)
- Supabase Storage, Edge Functions, or any Supabase features beyond Postgres + Studio

## Roles approved

- **`admin`** — full access to the entire app, including user management
- **`budget_viewer`** — read-only access to `/budget` for specified departments only
- **no role** — user authenticated but cannot access anything; must be assigned a role by an admin

One user can have multiple emails via Better Auth's native account linking.

---

## Section 1 — Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Access (edge)                                   │
│  - Verifies Google identity                                 │
│  - Enforces "email ends with @orca.so"                      │
│  - Injects Cf-Access-Jwt-Assertion header                   │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS (public)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Dokploy server (single VM)                                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Next.js app (Bun)                                  │   │
│  │  - Web UI + API routes + cron handlers              │   │
│  │  - Better Auth (sessions, roles, account linking)   │   │
│  │  - Drizzle ORM                                      │   │
│  └──────────┬──────────────────────┬───────────────────┘   │
│             │ localhost            │ localhost             │
│             ▼                      ▼                       │
│  ┌─────────────────┐     ┌──────────────────────┐         │
│  │  Supabase       │     │  Supabase Studio     │         │
│  │  Postgres       │     │  (UI on :3001)       │         │
│  │  (Dokploy tpl)  │     │  Access: internal    │         │
│  └─────────────────┘     └──────────────────────┘         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Dokploy cron scheduler                             │   │
│  │  → hits /api/cron/* endpoints inside Next.js        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Network posture
- **Public**: only Cloudflare → Dokploy ingress port (443). Everything else closed.
- **Internal**: Next.js ↔ Postgres ↔ Studio on localhost / Docker network. Postgres never exposed publicly.
- **Supabase Studio**: protected by Cloudflare Access with an admin-only policy.
- **External APIs (outbound)**: Next.js is the only service calling Helius, DefiLlama, QuickBooks.

### Why this shape
- **Localhost latency** between app and DB (~0.1ms).
- **Two auth layers**: CF Access stops unauthorized traffic at the edge; Better Auth enforces roles inside the app.
- **Self-contained cron**: jobs are Next.js API routes, triggered by Dokploy scheduler over the internal network.
- **Portable**: same Docker containers can move to any Docker host if Dokploy is outgrown.

### User-provided prerequisites
- Cloudflare Zero Trust team (free tier is sufficient)
- Public hostname proxied through Cloudflare pointing at Dokploy (or CF Tunnel)
- CF Access Application configured with Google Workspace as IdP, policy `email ends with @orca.so`
- Values needed for `.env`: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`
- Google OAuth credentials (inside CF Access config)
- QuickBooks OAuth app credentials (existing)
- Initial user/role seed list (which emails get `admin` vs `budget_viewer`)

---

## Section 2 — Auth flow

### Request lifecycle (production)

```
Browser
  │ 1. GET /budget
  ▼
Cloudflare Access
  │ 2. No CF_Authorization cookie? → redirect to Google → verify @orca.so
  │ 3. Set cookie + inject header: Cf-Access-Jwt-Assertion: <signed JWT>
  ▼
Next.js middleware.ts
  │ 4. Verify JWT signature against team certs endpoint
  │    - Check aud == CF_ACCESS_AUD
  │    - Check exp not expired
  │    - Extract email from claims
  │ 5. Load Better Auth session:
  │    - Look up `account` by email → get user_id
  │    - Load `user` row (includes user.role)
  │    - If no account exists → render 403 "Unknown email — contact admin"
  │    - If account exists but user.role IS NULL → 403 "No role assigned — contact admin"
  │ 6. Attach { user, role, permissions } to request context
  ▼
Route handler (page or /api/*)
  │ 7. Check permissions via Better Auth hasPermission()
  │    - Page route: middleware redirects / 403s before render
  │    - API route: returns 403 JSON
  ▼
Response
```

### Better Auth configuration
- **Admin plugin** with custom access control
  - Permission statements: `budget:read`, `budget:write`, `treasury:read`, `qb:read`, `qb:post`, `admin:manage_users`, `admin:*`
  - Role `admin` → all permissions
  - Role `budget_viewer` → `budget:read` only (department scoping applied at query time, see Section 3 and Section 7)
- **No OAuth providers configured inside Better Auth** — CF Access is the identity source; Better Auth only manages sessions + roles + account linking
- **Account linking**: admin UI calls Better Auth's account API to attach secondary emails to a user. When a request arrives with any of those emails in the CF JWT, it resolves to the same `user` row.

### Dev bypass (`SKIP_AUTH`)
When `NODE_ENV === 'development'`:
- `SKIP_AUTH=admin` → middleware skips CF JWT verification, injects synthetic user `{ email: DEV_USER_EMAIL, role: 'admin' }`
- `SKIP_AUTH=viewer` → injects `{ email: DEV_USER_EMAIL, role: 'budget_viewer', departments: DEV_DEPARTMENTS.split(',') }`
- `SKIP_AUTH=none` or unset → normal CF JWT verification

At app startup, if `SKIP_AUTH !== 'none'` and `NODE_ENV !== 'development'`, the app **throws and refuses to boot**. Fail-closed.

### Unknown-email and no-role handling
Two distinct cases, both surface a 403 page with an admin-contact message but log different `audit_log` actions:
- **Unknown email** — CF JWT is valid, but no `account` row matches the email. Logged as `access.denied.unknown_email`. The email and CF identity are written to `audit_log.metadata` so an admin can see who tried to get in.
- **No role** — `account` resolves to a `user` row but `user.role IS NULL`. Logged as `access.denied.no_role`. Admin UI shows this user in a "pending approval" list for role + department assignment.

### Security primitives never reimplemented
- Password hashing
- OAuth client flow
- Session token generation / rotation
- Permission check primitives

Better Auth handles all four. JWT verification is delegated to `jose`.

---

## Section 3 — Data schema

Single Drizzle schema at `lib/db/schema.ts`. All tables have `createdAt`/`updatedAt` unless noted. Migrations generated by `drizzle-kit`, never hand-written.

### Auth tables (managed by Better Auth)
- **`user`** — `id`, `name`, `email` (primary), `emailVerified`, `role` (`admin` | `budget_viewer` | `null`), `banned`
- **`account`** — `id`, `userId` (FK), `accountId`, `providerId`, `email` (← where multi-email lives)
- **`session`** — `id`, `userId` (FK), `token`, `expiresAt`, `ipAddress`, `userAgent`
- **`verification`** — `id`, `identifier`, `value`, `expiresAt` (Better Auth internal)

### App-level authz
- **`user_department`** — composite PK `(userId, department)`. `userId` FK to `user` with cascade delete. Empty set for a `budget_viewer` means no access. Admin has implicit access to all; this table is only consulted for `budget_viewer`.

### Reference / lookup
- **`entity`** — `id` (text PK: `opco`, `foundation`, `juku`, `zagreus`), `name`, `qbRealmId`, `isActive`
- **`wallet`** — `address` (PK), `label`, `chain`, `entityId` (FK), `accountCode`, `isExternal`, `overviewOnly`, `includeInOverview`
- **`token`** — `symbol` (PK), `name`, `decimals`, `coinId` (DefiLlama identifier)

### Financial data
- **`transaction`** — `id` (uuid), `txHash`, `walletAddress` (FK), `entityId` (FK), `blockTime` (timestamptz, indexed), `asset` (FK to token.symbol), `qty` (numeric), `direction` (`in` | `out`), `price` (numeric), `usd` (numeric), `priceSource`, `counterparty`, `category`. Unique constraint `(txHash, walletAddress, asset, direction)`. Indexes: `(entityId, blockTime)`, `(walletAddress, blockTime)`.
- **`balance_snapshot`** — composite PK `(date, walletAddress, token)`, `amount` (numeric), `fetchedAt`. Index `(date DESC)`.
- **`price`** — composite PK `(token, timestamp)`, `price` (numeric), `source` (`latest` | `historical`), `fetchedAt`. Index `(token, timestamp DESC)`.

### Budget
- **`budget_team_member`** — `id`, `name`, `email`, `entityId` (FK), `classification`, `department`, `role`, `location`, `ft` (boolean), `salary` (numeric), `bonus` (numeric), `status` (`active` | `inactive` | `pending`)
- **`budget_line`** — composite PK `(year, department, lineItem)`, `amount` (numeric), `notes`
- **`budget_qb_mapping`** — `qbAccountNumber`, `department`, `lineItem`. Maps QB accounts to budget categories for "actuals from QB".

### QuickBooks
- **`qb_connection`** — `realmId` (PK), `entityId` (FK), `accessToken`, `refreshToken`, `expiresAt`, `realmName`, `lastRefreshedAt`
- **`qb_report_cache`** — `id`, `entityId` (FK), `reportType` (`balance_sheet` | `profit_and_loss` | `general_ledger`), `periodStart`, `periodEnd`, `filterParams` (jsonb), `data` (jsonb), `fetchedAt`. Unique on `(entityId, reportType, periodStart, periodEnd, filterParams)`. Index `(entityId, reportType, fetchedAt DESC)`.
- **`qb_account_map`** — composite PK `(realmId, qbAccountId)`, `qbAccountNumber`, `qbAccountName`

### Audit (append-only)
- **`audit_log`** — `id`, `userId` (FK, nullable for system actions), `action` (e.g. `role.assigned`, `qb.posted`, `cron.fetch-transactions.succeeded`), `resourceType`, `resourceId`, `metadata` (jsonb), `createdAt`. Indexes `(userId, createdAt DESC)`, `(action, createdAt DESC)`. Enforced append-only via DB trigger blocking UPDATE/DELETE.

### Type choices
- Money / crypto amounts: `numeric(38, 18)`
- USD amounts: `numeric(20, 2)`
- Timestamps: `timestamp with time zone`, always UTC
- `jsonb` used for: QB raw responses, budget notes, audit metadata

### Department scoping enforcement
Queries for `budget_viewer` are filtered at the query layer. A single shared helper (working name `scopedBudgetQuery(user)`) wraps every budget-related query (`budget_line`, `budget_team_member`, `budget_qb_mapping`, and any future budget tables) with a `WHERE department IN (user's allowed departments)` clause. Admins bypass the helper and see all rows. The helper is the only way budget queries are executed — a review checklist and integration test in Section 7 enforce this.

### Migration workflow
```
bun drizzle-kit generate   # writes SQL to lib/db/migrations/
bun drizzle-kit migrate    # applies to Postgres
```
Zero hand-written SQL in the repo. Generated migration files are committed but never hand-edited.

---

## Section 4 — Cron jobs

Each job is a pure async function in `lib/cron/<name>.ts`. Matching route `app/api/cron/<name>/route.ts` verifies `CRON_SECRET` and invokes the function.

| Job | Schedule | Reads | Writes | Est. duration |
|---|---|---|---|---|
| **fetch-prices** | every 15 min | DefiLlama | `price` | <10s |
| **fetch-balances** | daily 00:05 UTC | Helius (per wallet) | `balance_snapshot` | 1–3 min |
| **fetch-transactions** | every 2 hours | Helius (signatures + full txs) | `transaction` | 5–15 min |
| **fetch-qb-reports** | hourly | QuickBooks (per entity × report × current period) | `qb_report_cache` | 30s–2 min |
| **refresh-qb-tokens** | every 30 min | `qb_connection` | `qb_connection` | <5s |
| **prune-cache** | weekly | — | deletes stale `qb_report_cache` + old `price` rows | <10s |

### Trigger mechanism
Dokploy's built-in scheduler POSTs `http://localhost:3000/api/cron/<name>` with header `Authorization: Bearer ${CRON_SECRET}` over the internal Docker network — never touches CF Access.

Route handler shape:
1. Constant-time compare of `Authorization` header against `CRON_SECRET` — else 401
2. Invoke job function with structured logging
3. Return `{ ok: true, stats }` or `{ ok: false, error }` with appropriate status

Middleware exempts `/api/cron/*` from CF JWT verification; the CRON_SECRET is the sole credential.

### Job semantics
- **fetch-prices**: current + last 24h historical for tracked tokens → upserts `price` on composite PK. Idempotent.
- **fetch-balances**: for each wallet, fetch token accounts + balances from Helius → upsert `balance_snapshot` rows keyed by today's UTC date. Idempotent.
- **fetch-transactions**: for each wallet, scans Helius signatures since last-seen blockTime for that wallet → parses into normalized transactions → inserts with unique-constraint dedup. Respects 40 req/40s Helius rate limit.
- **fetch-qb-reports**: per entity, fetches for the current period:
  - `BalanceSheet` at today's date
  - `ProfitAndLoss` current-month MTD and current-year YTD
  - `GeneralLedger` for each `budget_qb_mapping.qbAccountNumber`, current month
  Upserts into `qb_report_cache`. Hourly cron calls the job, but the job itself only refetches rows older than 48h — fresh rows are skipped to limit QB API burn.
- **refresh-qb-tokens**: selects `qb_connection` where `expiresAt < now() + 1 hour` → calls QB token endpoint → updates row. Logs to `audit_log`.
- **prune-cache**: deletes `qb_report_cache` > 90 days old (keeping latest per period), deletes historical `price` rows > 2 years old.

### Error handling inside jobs
- Each job wraps in try/catch, logs structured error, returns 500 on total failure
- Partial-success jobs return 200 with `{ ok: true, errors: [...] }` — one wallet's failure doesn't kill the batch
- Every run writes one `audit_log` row: `cron.<name>.{succeeded | failed}`
- **No automatic retries** — idempotent design means the next scheduled run picks up where this one left off

### On-demand triggering
Admin UI exposes `POST /api/admin/cron/<name>` (requires `admin:*`, writes audit entry) for backfills after config changes.

### Reused libraries (rewired, not rewritten)
- `lib/helius.ts` (writes to Postgres now)
- `lib/defillama.ts` (reads/writes `price` table)
- `lib/qb/` client (writes to `qb_report_cache`)
- `lib/rate-limiter.ts`

---

## Section 5 — Dev mode

### Local database
- **Default**: full Supabase self-hosted stack locally via Supabase CLI (`supabase start`). Gives you local Studio too.
- **Alternative (lighter)**: just Postgres via `docker compose`. Documented as fallback.

### Environment variables (`.env.local`)
```
# Database
DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres

# Auth — dev bypass
NODE_ENV=development
SKIP_AUTH=admin            # admin | viewer | none
DEV_USER_EMAIL=amina@orca.so
DEV_DEPARTMENTS=General,Ops   # only used when SKIP_AUTH=viewer

# Auth — prod values (blank in dev when SKIP_AUTH is set)
CF_ACCESS_TEAM_DOMAIN=
CF_ACCESS_AUD=
BETTER_AUTH_SECRET=<random 32 bytes>

# Cron
CRON_SECRET=<random string>

# External APIs
HELIUS_API_KEY=
QB_CLIENT_ID=
QB_CLIENT_SECRET=
QB_REDIRECT_URI=http://localhost:3000/api/qb/callback
```

`.env.example` ships the full list with blank values and inline comments. `.env.local` is gitignored.

### Run commands
```
bun install
supabase start               # local Supabase + Studio
bun run db:push              # apply Drizzle schema to local DB
bun run db:seed              # optional: seed entities, wallets, test user
bun run dev                  # Next.js on :3000
```

`package.json` scripts:
- `db:generate` → `drizzle-kit generate`
- `db:migrate` → `drizzle-kit migrate`
- `db:push` → `drizzle-kit push` (dev shortcut, skips migration files)
- `db:seed` → `bun run scripts/seed.ts`
- `db:studio` → `drizzle-kit studio` (alternative to Supabase Studio)

### Testing the full CF Access flow locally
When testing the actual CF auth path, run a Cloudflare Tunnel pointing at `localhost:3000` and create a dev CF Access application for the tunnel URL. Documented in `docs/dev-with-cf-access.md`. Not the default workflow.

### Excluded from dev mode
- No mocking of Helius / DefiLlama / QB — use real test credentials or skip those crons locally
- No auto-reset of local DB — explicit `db:push --force` when schema diverges

---

## Section 6 — Deletion list

Executed in a specific order during implementation (see execution order below).

### Top-level — deleted entirely
- `server/` — legacy Passport/SQLite/QB proxy (QB OAuth logic migrates into `app/api/qb/` + `lib/qb/`)
- `supabase/migrations/` — four SQL files replaced by Drizzle-generated migrations
- `index.html.bak` — stale backup
- `frontend/vercel.json` — going Dokploy

### Inside `frontend/` (post `git mv` to root) — deleted
- `lib/supabase/` (entire subtree)
- `lib/access.ts`, `access-live.ts`, `access-live.test.ts`, `access-model.ts`, `access-refresh.ts`, `access-refresh.test.ts`, `access-store.ts`, `access-store.test.ts`, `access-context.tsx`, `access.test.ts`
- `lib/admin-access.ts`, `admin-access-control.ts`, `admin-access-model.ts`, `admin-access-model.test.ts`
- `lib/auth/server.ts` (replaced by Better Auth + `lib/auth/cf-access.ts`)
- `lib/github.ts`, `github.test.ts`
- `app/auth/callback/route.ts`
- `app/login/page.tsx` (replaced by simple `/no-access` 403 page; CF Access owns the login screen)
- `hooks/use-access.ts`, `use-auth.ts` (replaced by Better Auth client hooks)
- `middleware.ts` (rewritten from scratch)

### Inside `frontend/` — kept and rewired
- Page components: `app/budget`, `transactions`, `gain-loss`, `unrealized`, `treasury-management`, `wallets`, `accounting`, `pnl`, `orca-ledger` — UI kept, API sources rewired
- `app/admin` — kept, rewritten against Better Auth + `user_department`
- `lib/qb/` — kept, rewired to `qb_connection` + `qb_report_cache`
- `lib/defillama.ts`, `lib/helius.ts` — kept, now write to Postgres
- `lib/fifo.ts`, `overview.ts`, `overview-trend.ts`, `treasury-management.ts`, `treasury-gain-loss.ts`, `treasury-transactions.ts`, `transaction-pricing.ts` — pure compute, kept as-is
- `lib/budget/` — kept, rewired
- `lib/format.ts`, `constants.ts`, `rate-limiter.ts` — kept
- `lib/types.ts` — trimmed to UI-only types (DB types come from `InferSelectModel`)
- `data/` — static wallet list seeded into `wallet` table, then folder deleted

### `package.json` deltas
**Removed:**
- `@supabase/ssr`
- `@supabase/supabase-js`

**Added:**
- `better-auth`
- `drizzle-orm`
- `drizzle-kit` (dev)
- `postgres` (postgres-js driver)
- `jose`
- `zod` (if not present)

### Execution order
1. `git mv frontend/* .` and `git mv frontend/.* .` to hoist to root
2. Delete items in "deleted entirely" list
3. Write new foundation (schema, auth, middleware)
4. Rewire kept files one-by-one, deleting each obsolete access/supabase dependency as its consumers move
5. Delete `server/` and `supabase/migrations/*.sql` once nothing references them

Each step is its own commit. Nothing destructive happens outside git.

---

## Section 7 — Error handling + testing

### Error categories

| Category | Source | Response | Logged to |
|---|---|---|---|
| Auth — no CF JWT | Missing header in prod | 401 / redirect to CF login | structured log |
| Auth — invalid CF JWT | Bad sig, expired, wrong `aud` | 401, force re-auth | log + `audit_log` |
| Auth — no role | Valid user, `role IS NULL` | 403 page "Contact admin" | `audit_log` (`access.denied.no_role`) |
| Auth — insufficient permission | Role lacks required permission | 403 | `audit_log` (`access.denied.forbidden`) |
| DB — constraint violation | Duplicate, FK missing | 409 safe message | log with context |
| DB — connection lost | Postgres down | 503 with Retry-After | log + Dokploy stderr |
| External API — rate limit | Helius 429, QB throttle | Cron: log + continue. User route: serve cache or 503 | log |
| External API — 5xx | Upstream down | Cron: skip this run. User route: serve stale cache with `X-Cache-Stale: true` | log |
| Validation | Bad body / params | 400 with Zod errors | log |
| Unhandled | Anything else | 500 generic | full stack to stderr |

### API error response shape
```
{
  error: string,          // human-readable, safe for UI
  code: string,           // machine-readable, e.g. "auth.no_role"
  details?: unknown       // Zod issues only, never raw DB errors
}
```
Never leaked: SQL errors, stack traces, internal column names, IDs outside the user's scope.

### Audit log policy
Every one of these writes an `audit_log` row:
- Role assignment / removal
- Department assignment / removal
- Account linking (email attached/detached)
- QB OAuth connect / disconnect
- Every POST to `/api/admin/*`
- Every `qb:post` action
- Cron success / failure
- Auth denials (no role, insufficient permission)

Append-only enforced by DB trigger.

### Testing strategy

**Unit tests** (`bun test`, every change):
- `lib/fifo.ts` and pure compute: golden-file tests for gain/loss
- `lib/auth/permissions.ts`: exhaustive role × permission matrix
- `lib/auth/cf-access.ts`: JWT — valid, expired, wrong aud, tampered, missing claims
- `lib/cron/*`: mock upstream APIs, assert DB writes
- Department scoping: budget_viewer with `['General']` vs `['Ops','General']` must not leak other depts

**Integration tests** (ephemeral Postgres via Supabase CLI or testcontainers):
- Drizzle queries against real schema
- Full request flow: middleware → route → DB → response
- Covers auth denials, pagination, cross-table joins

**No e2e/browser tests in v1** — YAGNI. Add Playwright if needed later.

**Security-specific tests (mandatory):**
- `budget_viewer` hitting `/api/treasury/*` → 403
- `budget_viewer` with empty `user_department` sees zero budget rows
- Admin role change writes `audit_log` entry
- `SKIP_AUTH=admin` with `NODE_ENV=production` refuses to boot
- CF JWT with wrong `aud` rejected
- Missing CF JWT in prod mode rejected
- Cron endpoint rejects missing / wrong `CRON_SECRET`
- A few manual SQL-injection attempts through user inputs (Drizzle parameterizes everything, but probe anyway)

### Not tested
- Visual / styling
- External API parsing beyond representative fixtures
- Performance benchmarks (add when a page feels slow)
- Multi-user concurrency

### Observability
- All logs: JSON lines to stdout, aggregated by Dokploy
- Min fields: `timestamp`, `level`, `userId` (when authed), `route`, `requestId`, `message`, `error.code`
- No third-party log shipper in v1

---

## Open questions

None remaining — all resolved during brainstorming:

- Scope: full slate (auth + data + delete legacy)
- QB cache strategy: mirror-and-cache (Approach A from brainstorm)
- Roles: `admin`, `budget_viewer` with department scoping, no-role users
- Multi-email: Better Auth account linking
- Dev bypass: `SKIP_AUTH=admin|viewer|none`, dev-only
- Runtime: Bun
- Folder shape: flat root-level Next.js, `frontend/` hoisted
- Local DB: Supabase CLI (full stack locally)

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| CF Access misconfiguration allows unauthenticated traffic | Confidentiality breach | Middleware verifies JWT signature + `aud` + `exp`. Integration test covers missing/invalid JWT. Fail-closed on missing env. |
| Dev bypass leaks to prod | Full auth bypass | Startup-time assertion refuses to boot if `SKIP_AUTH !== 'none'` and `NODE_ENV !== 'development'` |
| Better Auth version changes break account-linking contract | Multi-email users locked out | Pin Better Auth version; security-sensitive tests covering link/unlink flows |
| Drizzle migration generates destructive SQL | Data loss on deploy | Review every generated migration before merging. Never auto-apply in CI/CD without manual approval |
| Department scoping missed on a new query | budget_viewer sees other departments' data | Single `scopedBudgetQuery(user)` helper used everywhere. Lint rule or review checklist for new budget queries. Integration test for each new page. |
| Helius / DefiLlama / QB rate limits hit under backfill | Cron runs fail | Rate limiter in shared lib; backfill jobs run in smaller batches; idempotent design means next run continues |

## Deliverables at the end of implementation

1. Flattened Next.js repo at root with Bun
2. Drizzle schema + generated migrations applied to Supabase Postgres
3. Better Auth wired with CF Access JWT verification
4. All cron jobs running on Dokploy schedule, writing to Postgres
5. Admin UI for user/role/department management
6. QuickBooks reports cached in Postgres, pages reading from cache
7. Deletion of legacy `server/`, access-*, supabase client, GitHub-as-DB code
8. Unit + integration tests for security-critical paths
9. `docs/deployment.md` covering Dokploy setup, CF Access config, env vars
10. `.env.example` with every required variable

## Next phase

Once this spec is approved, the next step is invoking the `writing-plans` skill to produce a detailed, step-by-step implementation plan broken into reviewable commits.
