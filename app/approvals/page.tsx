import { redirect } from 'next/navigation'
import { ApprovalsPageClient } from '@/components/approvals-page-client'
import { getServerUser } from '@/lib/auth/get-user'
import { hasPermission } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function ApprovalsPage() {
  const user = await getServerUser()
  if (!user || !hasPermission(user.role, 'approvals:submit')) {
    redirect('/no-access')
  }

  return <ApprovalsPageClient />
}
