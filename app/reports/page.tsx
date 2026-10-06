import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth/get-user'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/no-access')
  redirect('/report?tab=treasury')
}
