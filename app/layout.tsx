import './globals.css'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { LayoutShell } from '@/components/layout-shell'
import { SwrProvider } from '@/components/swr-provider'
import { getInitialAccess } from '@/lib/auth/server-access'

const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-mono' })
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' })

export const metadata = { title: 'Tidelog' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve access from x-user-* headers (set by the proxy) on the server so
  // the client paints with access already in hand — no /api/me round-trip.
  const initialAccess = await getInitialAccess()
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`}>
      <body>
        <SwrProvider>
          <LayoutShell initialAccess={initialAccess}>{children}</LayoutShell>
        </SwrProvider>
      </body>
    </html>
  )
}
