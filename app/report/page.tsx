import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth/get-user'
import { hasPermission } from '@/lib/auth/permissions'
import { getCachedReportYears } from '@/lib/qb/cache-reads'
import { ReportClient } from '@/components/report-client'

export const dynamic = 'force-dynamic'

export default async function ReportPage() {
  const user = await getServerUser()
  if (!user || !hasPermission(user.role, 'qb:read')) redirect('/no-access')
  const years = await getCachedReportYears('profit_and_loss')
  const currentYear = new Date().getUTCFullYear()
  return <ReportClient initialYear={years.at(-1) ?? currentYear} years={years.length ? years : [currentYear]} />
}
