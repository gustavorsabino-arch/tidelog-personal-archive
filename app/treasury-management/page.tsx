import { redirect } from 'next/navigation'
import { TreasuryManagementPageClient } from '@/components/treasury-management-page-client'
import { getServerUser } from '@/lib/auth/get-user'
import { hasPermission } from '@/lib/auth/permissions'
import { getTreasuryManagementData } from '@/lib/treasury-management'

export const dynamic = 'force-dynamic'

export default async function TreasuryManagementPage() {
  const user = await getServerUser()
  if (!user || !hasPermission(user.role, 'treasury:read')) {
    redirect(user?.role === 'budget_viewer' ? '/budget' : '/no-access')
  }

  const initialData = await getTreasuryManagementData()

  return (
    <TreasuryManagementPageClient
      initialEntity="All"
      initialData={initialData}
    />
  )
}
