import { redirect } from 'next/navigation'
import { PnlPageClient, type EntityChoice, type PnlMode } from '@/components/pnl-page-client'
import { getPnlData, PnlNotCachedError, type PnlData, type PnlDataScope } from '@/lib/qb/pnl-data'
import { getCachedReportYears } from '@/lib/qb/cache-reads'
import { isQboEntity } from '@/lib/qb/config'
import { getServerUser } from '@/lib/auth/get-user'
import { hasPermission } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

const DEFAULT_ENTITY: EntityChoice = 'Opco'
const DEFAULT_MODE: PnlMode = 'ytd'

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parseEntity(raw: string | undefined): EntityChoice {
  if (!raw) return DEFAULT_ENTITY
  if (raw === 'All') return 'All'
  return isQboEntity(raw) ? raw : DEFAULT_ENTITY
}

function parseMode(raw: string | undefined): PnlMode {
  return raw === 'month' ? 'month' : DEFAULT_MODE
}

function parseInt0(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return Math.floor(n)
}

type SearchParams = Record<string, string | string[] | undefined>

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getServerUser()
  if (!user || !hasPermission(user.role, 'qb:read')) {
    redirect(user?.role === 'budget_viewer' ? '/budget' : '/no-access')
  }

  const sp = await searchParams
  const get = (key: string) => {
    const v = sp[key]
    return Array.isArray(v) ? v[0] : v
  }

  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1

  const entity = parseEntity(get('entity'))
  const mode = parseMode(get('mode'))
  const year = parseInt0(get('year'), currentYear, 2000, 2100)
  const month = parseInt0(get('month'), currentMonth, 1, 12)

  const lastDay = lastDayOfMonth(year, month)
  const mm = String(month).padStart(2, '0')
  const periodEnd = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
  const periodStart = mode === 'ytd' ? `${year}-01-01` : `${year}-${mm}-01`

  const scope: PnlDataScope = entity
  const [initialDataResult, availableYears] = await Promise.all([
    getPnlData(scope, periodStart, periodEnd).catch((err) => {
      if (err instanceof PnlNotCachedError) return null
      throw err
    }),
    getCachedReportYears('profit_and_loss'),
  ])
  const initialData: PnlData | null = initialDataResult

  return (
    <PnlPageClient
      initialEntity={entity}
      initialMode={mode}
      initialYear={year}
      initialMonth={month}
      initialData={initialData}
      availableYears={availableYears}
    />
  )
}
