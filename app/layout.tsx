import './globals.css'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { LayoutShell } from '@/components/layout-shell'
import { SwrProvider } from '@/components/swr-provider'
import { getInitialAccess } from '@/lib/auth/server-access'

const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-mono' })
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' })

// Temporary maintenance banner — auto-hides after this timestamp. Update or
// remove once the underlying issue (AWS OIDC provider re-registration) is
// resolved and the banner is no longer needed.
const MAINTENANCE_UNTIL = new Date('2026-06-02T22:00:00Z')

export const metadata = { title: 'Tidelog' }

export const viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve access from x-user-* headers (set by the proxy) on the server so
  // the client paints with access already in hand — no /api/me round-trip.
  const initialAccess = await getInitialAccess()
  const showMaintenanceBanner = Date.now() < MAINTENANCE_UNTIL.getTime()
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`}>
      <body>
        {showMaintenanceBanner ? (
          <div
            role="status"
            style={{
              padding: '10px 16px',
              background: '#fff4cc',
              color: '#5a4500',
              borderBottom: '1px solid #e8c547',
              fontFamily: 'var(--sans)',
              fontSize: '0.9rem',
              textAlign: 'center',
            }}
          >
            tidelog is undergoing maintenance for approximately the next hour. Some features may be unavailable.
          </div>
        ) : null}
        <SwrProvider>
          <LayoutShell initialAccess={initialAccess}>{children}</LayoutShell>
        </SwrProvider>
      </body>
    </html>
  )
}
