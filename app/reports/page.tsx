import { redirect } from 'next/navigation'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { getServerUser } from '@/lib/auth/get-user'

// Server component: gates on admin role, reads the static report HTML from
// disk, embeds it in a sandboxed iframe so its standalone CSS doesn't leak
// into the rest of the app. The HTML file is generated outside the app via
// /tmp/claude/treasury-breakdown.ts, copied into the repo, and deployed with
// the build. No live refresh — admins regen locally and commit.
export const dynamic = 'force-dynamic'

const HTML_PATH = path.join(process.cwd(), 'app/reports/treasury-breakdown.html')

export default async function ReportsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/no-access')

  let html: string | null = null
  let lastUpdated: string | null = null
  if (existsSync(HTML_PATH)) {
    html = readFileSync(HTML_PATH, 'utf8')
    // The report embeds its own generation timestamp inside the HTML header
    // (`Generated <code>ISO_DATE</code>`). We prefer that over filesystem
    // mtime, which Vercel resets to a fixed 2018 epoch when extracting the
    // deployment bundle.
    const m = html.match(/Generated\s*<code>([^<]+)<\/code>/i)
    if (m && !Number.isNaN(Date.parse(m[1]))) lastUpdated = m[1]
  }

  return (
    <main style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12, height: '100vh', boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title">Reports</div>
          <div className="page-sub">
            Treasury portfolio breakdown across Solana + EVM wallets, Whirlpool LPs, and on-chain treasury management positions.
          </div>
        </div>
        {lastUpdated ? (
          <div className="page-sub" style={{ fontFamily: 'var(--mono)' }}>
            Last updated: {new Date(lastUpdated).toLocaleString()}
          </div>
        ) : null}
      </header>

      {html ? (
        <iframe
          title="Treasury portfolio breakdown"
          srcDoc={html}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          style={{ flex: 1, width: '100%', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel)' }}
        />
      ) : (
        <div className="empty" style={{ padding: 32, border: '1px dashed var(--border)', borderRadius: 8 }}>
          <div className="empty-icon">∅</div>
          <div>Report not available.</div>
        </div>
      )}
    </main>
  )
}
