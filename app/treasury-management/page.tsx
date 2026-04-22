import { TreasuryManagementPageClient } from '@/components/treasury-management-page-client'
import { getTreasuryManagementData } from '@/lib/treasury-management'

export const dynamic = 'force-dynamic'

export default async function TreasuryManagementPage() {
  const initialData = await getTreasuryManagementData()

  return (
    <TreasuryManagementPageClient
      initialEntity="All"
      initialData={initialData}
    />
  )
}
