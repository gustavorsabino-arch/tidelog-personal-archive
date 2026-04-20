import './globals.css'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { LayoutShell } from '@/components/layout-shell'

const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-mono' })
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' })

export const metadata = { title: 'Tidelog' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`}>
      <body>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  )
}
