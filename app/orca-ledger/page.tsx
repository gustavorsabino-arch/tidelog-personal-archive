import { redirect } from 'next/navigation'
import { OrcaLedgerClient } from '@/components/orca-ledger-client'
import { ENTITIES } from '@/lib/constants'
import { getServerUser } from '@/lib/auth/get-user'
import { hasPermission } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function OrcaLedgerPage() {
  const user = await getServerUser()
  if (!user || !hasPermission(user.role, 'treasury:read')) {
    redirect(user?.role === 'budget_viewer' ? '/budget' : '/no-access')
  }
  return <OrcaLedgerClient initialEntity={ENTITIES[0]} />
}
