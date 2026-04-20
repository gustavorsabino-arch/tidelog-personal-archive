# Tidelog v2 — Comprehensive Restructure

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Tidelog from a monolithic 8.1MB single-file frontend + Express/Railway backend into a Next.js 16.2 app on Vercel with Supabase auth. Reduce load time from ~25min to <30s. Every piece of information currently in the dashboard must be preserved.

**Architecture:**
- **Next.js 16.2** (App Router, TypeScript) on **Vercel** — handles everything: UI, API routes (proxy to Helius/Birdeye/QB), background jobs
- **Supabase** — auth only (Google OAuth, @orca.so domain restriction). Free tier.
- **GitHub `data` branch** — stores all cache JSON files (prices, balances, transactions, ATAs). Background jobs commit updated JSON via GitHub API. Frontend reads via GitHub raw URLs.
- **Static files in `main` branch** — wallet registry, budget config, QB mappings (editable via PR)
- **Vercel Cron Jobs** — trigger API routes on schedule to fetch and cache blockchain data
- **No Express. No Railway.**

**Tech Stack:** Next.js 16.2, TypeScript, Supabase Auth, GitHub API, Helius RPC, Birdeye, DeFiLlama, QuickBooks API, Chart.js

**Why this architecture:**
- Zero infrastructure cost (Vercel free, Supabase free for auth, GitHub free)
- No separate server to maintain
- JSON cache on GitHub = free, unlimited reads, built-in history
- Wallet registry in repo = changes via PR, no deployment needed for config
- Supabase auth stays well within free tier (~10 users)

**Constraints:**
- `QB_CLIENT_ID`, `QB_REDIRECT` values must not change
- All QB OAuth flows must work (token exchange, refresh, proxy)
- Every tab, data point, and feature from v1 must exist in v2
- API keys (Helius, Birdeye, QB) stored in Vercel env vars

---

## How the GitHub Data Branch Works

```
main branch:                    data branch:
├── frontend/                   ├── prices.json
│   ├── app/                    ├── atas.json
│   ├── data/                   ├── balances/
│   │   ├── wallets.json        │   └── 2026-03-18.json
│   │   ├── budget-team.json    └── transactions/
│   │   └── budget-lines.json       ├── Opco/
│   └── ...                          │   └── 2026-03.json
└── docs/                            ├── Foundation/
                                     ├── Juku/
                                     └── Zagreus/
```

**Writes (background jobs):** Vercel Cron → Next.js API route → fetch blockchain data → commit JSON to `data` branch via GitHub Contents API.

**Reads (frontend):** Next.js API route → fetch from `https://raw.githubusercontent.com/{owner}/{repo}/data/{path}` (fast, CDN-cached, no rate limit concerns with auth token).

**Rate limits:** GitHub API with a fine-grained PAT = 5,000 req/hour. Our cron jobs make ~10-20 writes/hour. Reads via raw.githubusercontent.com don't count against API limits.

---

## Migration Testing Strategy

1. **Snapshot v1 output**: For each tab, capture the data the old dashboard renders (wallet list, balances, transaction counts, entity totals, budget figures).
2. **Compare v2 output**: New pages must render identical data. Same wallet addresses/labels, same balances (within rounding), same transaction counts, same budget figures.
3. **Keep old `index.html`** in repo as reference until migration is fully validated.

---

## File Structure

```
tidelog-v2/
├── frontend/
│   ├── index.html                   # OLD monolith — keep as reference
│   ├── app/
│   │   ├── layout.tsx               # Root layout: sidebar, Supabase auth
│   │   ├── page.tsx                 # Overview dashboard
│   │   ├── globals.css              # CSS variables (extracted from index.html)
│   │   ├── login/
│   │   │   └── page.tsx             # Supabase Google OAuth login
│   │   ├── auth/
│   │   │   └── callback/
│   │   │       └── route.ts         # Supabase auth callback
│   │   ├── api/
│   │   │   ├── proxy/
│   │   │   │   ├── helius/
│   │   │   │   │   ├── rpc/route.ts          # POST: proxy Helius RPC
│   │   │   │   │   └── transactions/route.ts # POST: proxy Helius Enhanced
│   │   │   │   ├── birdeye/route.ts          # GET: proxy Birdeye
│   │   │   │   └── qb/route.ts               # GET: proxy QuickBooks API
│   │   │   ├── qb/
│   │   │   │   ├── connect/route.ts          # GET: start QB OAuth
│   │   │   │   ├── callback/route.ts         # GET: QB OAuth callback
│   │   │   │   ├── token/route.ts            # POST: exchange/refresh QB tokens
│   │   │   │   └── tokens/route.ts           # GET/POST: load/save QB tokens
│   │   │   ├── treasury/
│   │   │   │   ├── overview/route.ts         # GET: cached balances + prices
│   │   │   │   └── transactions/route.ts     # GET: cached transactions
│   │   │   ├── prices/
│   │   │   │   └── route.ts                  # GET: cached prices
│   │   │   ├── wallets/
│   │   │   │   └── route.ts                  # GET/POST: wallet registry
│   │   │   ├── budget/
│   │   │   │   ├── team/route.ts             # GET/POST: team tracker
│   │   │   │   ├── lines/route.ts            # GET/POST: budget lines
│   │   │   │   └── mapping/route.ts          # GET/POST: QB mapping
│   │   │   ├── access/
│   │   │   │   └── route.ts                  # GET/POST: user permissions
│   │   │   └── cron/
│   │   │       ├── fetch-balances/route.ts   # Cron: update wallet balances
│   │   │       ├── fetch-transactions/route.ts # Cron: index new transactions
│   │   │       ├── fetch-prices/route.ts     # Cron: update price cache
│   │   │       └── refresh-qb/route.ts       # Cron: refresh QB tokens
│   │   ├── transactions/
│   │   │   └── page.tsx
│   │   ├── gain-loss/
│   │   │   └── page.tsx
│   │   ├── unrealized/
│   │   │   └── page.tsx
│   │   ├── orca-ledger/
│   │   │   └── page.tsx
│   │   ├── accounting/
│   │   │   └── page.tsx
│   │   ├── pnl/
│   │   │   └── page.tsx
│   │   ├── budget/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── departments/page.tsx
│   │   │   ├── monthly/page.tsx
│   │   │   ├── headcount/page.tsx
│   │   │   ├── team/page.tsx
│   │   │   ├── mapping/page.tsx
│   │   │   ├── coverage/page.tsx
│   │   │   └── edit/page.tsx
│   │   ├── wallets/
│   │   │   └── page.tsx
│   │   └── admin/
│   │       └── page.tsx
│   ├── components/
│   │   ├── sidebar.tsx
│   │   ├── status-bar.tsx
│   │   ├── entity-selector.tsx
│   │   ├── date-range-picker.tsx
│   │   ├── card.tsx
│   │   ├── data-table.tsx
│   │   ├── modal.tsx
│   │   ├── token-badge.tsx
│   │   └── qb/
│   │       ├── qb-connect-button.tsx
│   │       ├── qb-status.tsx
│   │       └── qb-post-modal.tsx
│   ├── lib/
│   │   ├── api.ts                   # Client-side API helper
│   │   ├── github.ts               # GitHub API: read/write data branch
│   │   ├── helius.ts               # Helius RPC client with rate limiter
│   │   ├── defillama.ts            # DeFiLlama price client
│   │   ├── rate-limiter.ts         # Token-bucket rate limiter
│   │   ├── supabase/
│   │   │   ├── client.ts           # Browser Supabase client
│   │   │   ├── server.ts           # Server-side Supabase client
│   │   │   └── middleware.ts        # Auth middleware helper
│   │   ├── types.ts
│   │   ├── constants.ts
│   │   ├── format.ts
│   │   └── qb.ts
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   ├── use-treasury.ts
│   │   └── use-qb.ts
│   ├── data/                        # Static config (in main branch)
│   │   ├── wallets.json             # Wallet registry
│   │   ├── budget-team.json         # Team tracker
│   │   ├── budget-lines.json        # Budget line items
│   │   └── budget-mapping.json      # QB account mapping
│   ├── middleware.ts                # Next.js: auth + domain check
│   ├── next.config.ts
│   ├── vercel.json                  # Cron job definitions
│   ├── package.json
│   └── tsconfig.json
├── server/                          # OLD — keep as reference, eventually remove
│   └── server.js
└── docs/
    └── superpowers/plans/
```

---

## Chunk 1: Project Scaffolding + GitHub Data Branch + Supabase Auth

### Task 1.1: Initialize Next.js project

**Files:**
- Create: `frontend/package.json`, `frontend/next.config.ts`, `frontend/tsconfig.json`
- Create: `frontend/app/layout.tsx`, `frontend/app/page.tsx`, `frontend/app/globals.css`

- [ ] **Step 1: Create Next.js 16.2 project**

```bash
cd /Users/orca/Kelpfarm/tidelog-v2/frontend
# Move old index.html aside temporarily
mv index.html ../index.html.bak
npx create-next-app@16.2 . --typescript --app --no-tailwind --no-eslint --no-src-dir --no-import-alias
# Move it back
mv ../index.html.bak ./index.html
```

Accept defaults for any interactive prompts (No to React Compiler, No to AGENTS.md).

- [ ] **Step 2: Install Supabase deps**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 3: Verify dev server starts**

```bash
npm run dev
```
Expected: http://localhost:3000 shows default Next.js page.

- [ ] **Step 4: Configure `next.config.ts`**

```typescript
// frontend/next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // No rewrites needed — all API routes are in-app
}

export default nextConfig
```

- [ ] **Step 5: Create `vercel.json` with cron definitions**

```json
{
  "crons": [
    { "path": "/api/cron/fetch-prices", "schedule": "*/10 * * * *" },
    { "path": "/api/cron/fetch-balances", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/fetch-transactions", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/refresh-qb", "schedule": "0 * * * *" }
  ]
}
```

Note: Vercel free tier supports cron jobs but runs them once/day only. Paid Vercel (Pro) runs at the specified intervals. For free tier, these can also be triggered manually via the API route.

- [ ] **Step 6: Extract CSS variables into `globals.css`**

Extract from `index.html` lines ~1-700. Must include ALL CSS custom properties:
- Colors: `--bg`, `--surface`, `--surface2`, `--border`, `--border2`, `--text`, `--muted`, `--muted2`
- Accents: `--accent`, `--accent-bg`, `--green`, `--green-bg`, `--red`, `--red-bg`, `--orange`, `--orange-bg`
- Token colors: `--sol`, `--sol-bg`, `--orca`, `--orca-bg`, `--usdc`, `--usdc-bg`, `--usdt`, `--usdt-bg`
- Typography: `--mono`, `--sans` mapped to Next.js font variables
- Layout: `--radius`, `--shadow`, `--shadow-lg`
- Base styles: body, scrollbar, `.card`, table, button

- [ ] **Step 7: Create placeholder root layout + overview page**

Minimal layout with sidebar placeholder. Overview shows "Tidelog v2 — Loading..."
Verify renders at http://localhost:3000 with correct fonts and CSS vars.

---

### Task 1.2: GitHub data branch setup + read/write helpers

**Files:**
- Create: `frontend/lib/github.ts`
- Create: GitHub `data` branch with initial structure

- [ ] **Step 1: Create the `data` branch**

```bash
cd /Users/orca/Kelpfarm/tidelog-v2
# Create orphan branch (no history from main)
git checkout --orphan data
git rm -rf .
# Create initial structure
mkdir -p balances transactions/Opco transactions/Foundation transactions/Juku transactions/Zagreus
echo '{}' > prices.json
echo '{}' > atas.json
echo '[]' > balances/.gitkeep
touch transactions/Opco/.gitkeep transactions/Foundation/.gitkeep transactions/Juku/.gitkeep transactions/Zagreus/.gitkeep
echo '# Tidelog Cache Data' > README.md
echo 'This branch stores cached blockchain data (balances, transactions, prices).' >> README.md
echo 'Updated automatically by Vercel cron jobs. Do not edit manually.' >> README.md
git add -A
git commit -m "Initialize data branch structure"
# Switch back to main
git checkout main
```

- [ ] **Step 2: Create GitHub API helper**

```typescript
// frontend/lib/github.ts

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!          // Fine-grained PAT
const GITHUB_OWNER = process.env.GITHUB_OWNER!          // 'minasrc'
const GITHUB_REPO = process.env.GITHUB_REPO!            // 'tidelog-v2'
const DATA_BRANCH = 'data'

// ── Read a JSON file from the data branch ──────────────────────────
export async function readDataFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${DATA_BRANCH}/${path}`
    const res = await fetch(url, {
      headers: GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {},
      next: { revalidate: 60 }, // Cache for 60s in Next.js
    })
    if (!res.ok) return fallback
    return await res.json()
  } catch {
    return fallback
  }
}

// ── Write a JSON file to the data branch ────────────────────────────
// Uses GitHub Contents API (create or update file)
export async function writeDataFile(path: string, data: unknown, message?: string): Promise<boolean> {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`

  // Get current file SHA (needed for updates)
  let sha: string | undefined
  try {
    const existing = await fetch(apiUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
      cache: 'no-store',
    })
    if (existing.ok) {
      const meta = await existing.json()
      sha = meta.sha
    }
  } catch { /* file doesn't exist yet — that's fine */ }

  // Write file
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64')
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message || `update ${path}`,
      content,
      branch: DATA_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[GitHub] Failed to write ${path}:`, err)
    return false
  }
  return true
}

// ── List files in a directory on the data branch ────────────────────
export async function listDataFiles(dirPath: string): Promise<string[]> {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${dirPath}?ref=${DATA_BRANCH}`
  try {
    const res = await fetch(apiUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const items = await res.json()
    return Array.isArray(items) ? items.map((i: any) => i.name).filter((n: string) => n.endsWith('.json')) : []
  } catch {
    return []
  }
}

// ── Read a static data file from main branch (wallets, budget) ──────
// These are in frontend/data/ and bundled at build time
export function readStaticData<T>(path: string): T {
  // In Next.js, this is a server-side import from the filesystem
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(`@/data/${path}`)
}
```

- [ ] **Step 3: Add env vars to `.env.local`**

```
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=minasrc
GITHUB_REPO=tidelog-v2

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# API keys (same as current Railway env vars)
HELIUS_KEY=
BIRDEYE_KEY=
QB_CLIENT_ID=
QB_CLIENT_SECRET=
QB_REDIRECT_URI=https://tidelog-v2.vercel.app/api/qb/callback
```

- [ ] **Step 4: Add `.env.local` to `.gitignore`**

Ensure `frontend/.env.local` is in `.gitignore` (Next.js adds this by default).

---

### Task 1.3: Wallet registry (static JSON in main branch)

**Files:**
- Create: `frontend/data/wallets.json` (extracted from index.html)
- Create: `frontend/app/api/wallets/route.ts`

- [ ] **Step 1: Extract wallets from index.html to JSON file**

Write a script or manually extract the `ALL_WALLETS` array from `index.html` (lines 2280-2349) into `frontend/data/wallets.json`. Format:

```json
[
  {
    "address": "FKdazx1CmLo7xj8AtPCWyGkqPJ49RJzyqywAq4HhyBG4",
    "label": "New - Juku - ORCA Vault",
    "chain": "SOL",
    "entity": "Juku",
    "accountCode": null,
    "isExternal": false,
    "overviewOnly": false
  },
  ...
]
```

Must include every wallet from the original. Verify count matches.

- [ ] **Step 2: Create wallets API route**

```typescript
// frontend/app/api/wallets/route.ts
import { NextRequest, NextResponse } from 'next/server'
import wallets from '@/data/wallets.json'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const entity = searchParams.get('entity')
  const active = searchParams.get('active')

  let filtered = wallets as any[]
  if (entity) filtered = filtered.filter(w => w.entity === entity)
  if (active !== null) filtered = filtered.filter(w => active === 'true' ? !w.isExternal : w.isExternal)

  return NextResponse.json({ wallets: filtered })
}
```

Note: For v2, wallet changes are PRs to `data/wallets.json` on main. No POST endpoint needed initially — can add later if CRUD via UI is desired.

- [ ] **Step 3: Verify wallet count matches v1**

Count wallets in the new JSON file and compare with the `ALL_WALLETS` array length in `index.html`.

---

### Task 1.4: Supabase auth

**Files:**
- Create: `frontend/lib/supabase/client.ts`, `frontend/lib/supabase/server.ts`
- Create: `frontend/middleware.ts`
- Create: `frontend/app/login/page.tsx`, `frontend/app/auth/callback/route.ts`
- Create: `frontend/hooks/use-auth.ts`

**Prerequisites:** Create Supabase project, enable Google OAuth provider, add redirect URLs.

- [ ] **Step 1: Create Supabase browser client**

```typescript
// frontend/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2: Create Supabase server client**

```typescript
// frontend/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try { cookieStore.set(name, value, options) } catch {}
          })
        },
      },
    }
  )
}
```

- [ ] **Step 3: Create Next.js middleware — auth + @orca.so domain check**

```typescript
// frontend/middleware.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Allow login page and auth callback
  if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname.startsWith('/auth/')) {
    return response
  }

  // Allow cron API routes (secured by CRON_SECRET header instead)
  if (request.nextUrl.pathname.startsWith('/api/cron/')) {
    return response
  }

  // Not authenticated → login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Domain restriction
  if (!user.email?.endsWith('@orca.so')) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=domain', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 4: Create auth callback route**

```typescript
// frontend/app/auth/callback/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}/`)
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
```

- [ ] **Step 5: Create login page**

```tsx
// frontend/app/login/page.tsx
'use client'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  async function signIn() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { hd: 'orca.so' },
      },
    })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)', marginBottom: 24 }}>tidelog</h1>
        {error === 'domain' && <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--red)', marginBottom: 16 }}>Access restricted to @orca.so accounts</p>}
        {error === 'auth' && <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--red)', marginBottom: 16 }}>Authentication failed</p>}
        <button onClick={signIn} style={{
          fontFamily: 'var(--font-mono)', padding: '12px 32px', borderRadius: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
          color: 'var(--text)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
        }}>
          Sign in with Google
        </button>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: 16 }}>Requires @orca.so account</p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>
}
```

- [ ] **Step 6: Create auth hook**

```typescript
// frontend/hooks/use-auth.ts
'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => { setUser(user); setLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null); setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  return { user, loading, authenticated: !!user, email: user?.email || null }
}
```

---

## Chunk 2: API Route Layer (replace Express proxy endpoints)

### Task 2.1: Helius + Birdeye + QB proxy routes

These API routes replace the Express proxy endpoints. API keys are in Vercel env vars.

**Files:**
- Create: `frontend/lib/helius.ts`, `frontend/lib/rate-limiter.ts`, `frontend/lib/defillama.ts`
- Create: `frontend/app/api/proxy/helius/rpc/route.ts`
- Create: `frontend/app/api/proxy/helius/transactions/route.ts`
- Create: `frontend/app/api/proxy/birdeye/route.ts`
- Create: `frontend/app/api/proxy/qb/route.ts`

- [ ] **Step 1: Create rate limiter**

```typescript
// frontend/lib/rate-limiter.ts
export class RateLimiter {
  private tokens: number
  private lastRefill: number

  constructor(
    private maxTokens: number,
    private refillRate: number,
    private refillInterval = 1000
  ) {
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  private refill() {
    const elapsed = Date.now() - this.lastRefill
    const add = Math.floor(elapsed / this.refillInterval) * this.refillRate
    if (add > 0) { this.tokens = Math.min(this.maxTokens, this.tokens + add); this.lastRefill = Date.now() }
  }

  async acquire(count = 1) {
    while (true) {
      this.refill()
      if (this.tokens >= count) { this.tokens -= count; return }
      await new Promise(r => setTimeout(r, 200))
    }
  }
}
```

- [ ] **Step 2: Create Helius client**

```typescript
// frontend/lib/helius.ts
import { RateLimiter } from './rate-limiter'

const HELIUS_KEY = process.env.HELIUS_KEY!
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`

const limiter = new RateLimiter(40, 40)
let rpcId = 1

export async function heliusRpc(method: string, params: unknown[], retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.acquire()
    try {
      const r = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
      })
      if (r.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
        continue
      }
      return await r.json()
    } catch (e) {
      if (attempt === retries) throw e
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
}

export async function heliusEnhanced(signatures: string[]) {
  await limiter.acquire()
  const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: signatures }),
  })
  if (!r.ok) throw new Error(`Helius enhanced: ${r.status}`)
  return r.json()
}
```

- [ ] **Step 3: Create Helius RPC proxy route**

```typescript
// frontend/app/api/proxy/helius/rpc/route.ts
import { NextRequest, NextResponse } from 'next/server'

const HELIUS_KEY = process.env.HELIUS_KEY!

export async function POST(req: NextRequest) {
  const body = await req.json()
  const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return NextResponse.json(await r.json(), { status: r.status })
}
```

- [ ] **Step 4: Create Helius Enhanced proxy route**

```typescript
// frontend/app/api/proxy/helius/transactions/route.ts
import { NextRequest, NextResponse } from 'next/server'

const HELIUS_KEY = process.env.HELIUS_KEY!

export async function POST(req: NextRequest) {
  const body = await req.json()
  const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${HELIUS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return NextResponse.json(await r.json(), { status: r.status })
}
```

- [ ] **Step 5: Create Birdeye proxy route**

```typescript
// frontend/app/api/proxy/birdeye/route.ts
import { NextRequest, NextResponse } from 'next/server'

const BIRDEYE_KEY = process.env.BIRDEYE_KEY!

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const apiPath = searchParams.get('path')
  if (!apiPath) return NextResponse.json({ error: 'Missing ?path=' }, { status: 400 })

  const params = new URLSearchParams(searchParams)
  params.delete('path')
  const qs = params.toString()
  const url = `https://public-api.birdeye.so${apiPath}${qs ? '?' + qs : ''}`

  const r = await fetch(url, {
    headers: {
      'X-API-KEY': BIRDEYE_KEY,
      'x-chain': searchParams.get('chain') || 'solana',
      'accept': 'application/json',
    },
  })
  return NextResponse.json(await r.json(), { status: r.status })
}
```

- [ ] **Step 6: Create QB proxy route**

```typescript
// frontend/app/api/proxy/qb/route.ts
import { NextRequest, NextResponse } from 'next/server'

const QB_BASE = 'https://quickbooks.api.intuit.com'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const apiPath = searchParams.get('path')
  const realmId = searchParams.get('realmId')
  if (!apiPath) return NextResponse.json({ error: 'Missing ?path=' }, { status: 400 })
  if (!realmId) return NextResponse.json({ error: 'Missing ?realmId=' }, { status: 400 })

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })

  const r = await fetch(`${QB_BASE}${apiPath}`, {
    headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
  })

  const text = await r.text()
  try {
    return NextResponse.json(JSON.parse(text), { status: r.status })
  } catch {
    return NextResponse.json({ error: 'QB returned non-JSON', preview: text.slice(0, 500) }, { status: 502 })
  }
}
```

---

### Task 2.2: QB OAuth routes

**Files:**
- Create: `frontend/app/api/qb/connect/route.ts`
- Create: `frontend/app/api/qb/callback/route.ts`
- Create: `frontend/app/api/qb/token/route.ts`
- Create: `frontend/app/api/qb/tokens/route.ts`

These replace the Express QB OAuth endpoints. QB tokens are stored on the `data` branch as `qb-tokens.json`.

- [ ] **Step 1-4: Create all QB OAuth routes**

(Detailed code for each route — mirrors existing Express logic but uses Next.js route handlers + GitHub data branch for token storage)

---

### Task 2.3: DeFiLlama client + price cache

**Files:**
- Create: `frontend/lib/defillama.ts`

```typescript
// frontend/lib/defillama.ts
const COIN_IDS: Record<string, string> = {
  SOL: 'coingecko:solana',
  ORCA: 'solana:orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  USDC: 'coingecko:usd-coin',
  USDT: 'coingecko:tether',
}

export async function getCurrentPrices(tokens = ['SOL', 'ORCA', 'USDC', 'USDT']) {
  const coins = tokens.map(t => COIN_IDS[t]).filter(Boolean).join(',')
  const r = await fetch(`https://coins.llama.fi/prices/current/${coins}`)
  if (!r.ok) throw new Error(`DeFiLlama: ${r.status}`)
  const data = await r.json()
  const prices: Record<string, number> = {}
  for (const token of tokens) {
    const d = data.coins?.[COIN_IDS[token]]
    if (d?.price) prices[token] = d.price
  }
  return prices
}

export async function getHistoricalPrice(token: string, timestamp: number) {
  const coinId = COIN_IDS[token]
  if (!coinId) return null
  const r = await fetch(`https://coins.llama.fi/prices/historical/${timestamp}/${coinId}`)
  if (!r.ok) return null
  const data = await r.json()
  return data.coins?.[coinId]?.price || null
}
```

---

## Chunk 3: Cron Jobs (background data fetching)

### Task 3.1: Price updater cron

**Files:**
- Create: `frontend/app/api/cron/fetch-prices/route.ts`

- [ ] **Step 1: Create price cron route**

Fetches current prices from DeFiLlama, reads existing `prices.json` from data branch, merges, writes back.

```typescript
// frontend/app/api/cron/fetch-prices/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { readDataFile, writeDataFile } from '@/lib/github'
import { getCurrentPrices } from '@/lib/defillama'

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sets this automatically)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prices = await getCurrentPrices()
  const cache = await readDataFile<Record<string, any>>('prices.json', {})

  const now = Math.floor(Date.now() / 3600000) * 3600
  for (const [token, price] of Object.entries(prices)) {
    cache[`${token}::${now}`] = price
    cache[`${token}::latest`] = price
  }
  cache._lastUpdated = new Date().toISOString()

  await writeDataFile('prices.json', cache, `prices: ${new Date().toISOString().slice(0, 16)}`)
  return NextResponse.json({ ok: true, prices })
}
```

---

### Task 3.2: Balance fetcher cron

**Files:**
- Create: `frontend/app/api/cron/fetch-balances/route.ts`

Fetches all wallet balances via Helius, writes to `balances/YYYY-MM-DD.json` on data branch.

---

### Task 3.3: Transaction indexer cron

**Files:**
- Create: `frontend/app/api/cron/fetch-transactions/route.ts`

Incremental transaction indexer. Reads existing month files, fetches new transactions, appends, writes back. Same logic as previous plan's transaction-indexer.js but as a Next.js API route writing to GitHub.

**Important:** Vercel functions have a 60s timeout on free tier (300s on Pro). The full transaction index takes much longer. Solution:
- On each cron run, process only 5-10 wallets (not all 60)
- Track progress in a `_index-progress.json` file on data branch
- Full index completes across multiple cron runs
- Or: trigger manually for initial backfill, cron handles incremental

---

### Task 3.4: QB token refresh cron

**Files:**
- Create: `frontend/app/api/cron/refresh-qb/route.ts`

Reads QB tokens from `qb-tokens.json` on data branch, refreshes any expiring within 1 hour, writes back.

---

## Chunk 4: Frontend Pages (Treasury Overview first)

### Task 4.1: Shared types, constants, formatters, API client

**Files:** `frontend/lib/types.ts`, `frontend/lib/constants.ts`, `frontend/lib/format.ts`, `frontend/lib/api.ts`

Same as previous plan — all extracted from index.html. Constants include PROXY_BASE (now relative: `/api/proxy`), ENTITIES, TOKEN_COLORS, ENTITY_COLORS, QB config.

### Task 4.2: Layout + sidebar + overview page

Root layout, sidebar nav (all 10 tabs), overview page calling `GET /api/treasury/overview`. Must render same data as v1.

### Task 4.3-4.10: Remaining pages

Same as previous plan — one page per v1 tab, each calling appropriate API routes.

---

## Chunk 5: Budget endpoints + data migration

### Task 5.1: Budget API routes

**Files:**
- Create: `frontend/app/api/budget/team/route.ts`
- Create: `frontend/app/api/budget/lines/route.ts`
- Create: `frontend/app/api/budget/mapping/route.ts`

Budget data lives as static JSON in `frontend/data/` on main branch. Budget writes go to the data branch (or are PRs to main for permanent changes).

### Task 5.2: Extract budget data from v1

Extract `BUDGET_INITIAL_TEAM`, `STATIC_BUDGET`, `CAT_LINES` from index.html into the JSON files.

---

## Chunk 6: Migration Verification + Cleanup

### Task 6.1: Data parity verification

Compare wallet counts, entity totals, transaction counts between v1 and v2.

### Task 6.2: Remove old server directory

After all pages verified, remove `server/` directory and old `frontend/index.html`.

### Task 6.3: Update deployment config

Point Vercel to `frontend/` as root directory. Ensure all env vars are set.

---

## Execution Order

1. **Chunk 1** — Next.js + GitHub data branch + wallets + Supabase auth
2. **Chunk 2** — API proxy routes (Helius, Birdeye, QB) replacing Express
3. **Chunk 3** — Cron jobs (prices, balances, transactions, QB refresh)
4. **Chunk 4** — Frontend pages (overview first, then remaining)
5. **Chunk 5** — Budget endpoints + data extraction
6. **Chunk 6** — Parity verification + cleanup
