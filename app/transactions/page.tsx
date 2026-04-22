import { redirect } from 'next/navigation'
import { TransactionsPageClient } from '@/components/transactions-page-client'
import { ENTITIES } from '@/lib/constants'
import { getServerUser } from '@/lib/auth/get-user'
import { hasPermission } from '@/lib/auth/permissions'
import { getTreasuryTransactions } from '@/lib/treasury-transactions'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export default async function TransactionsPage() {
  const user = await getServerUser()
  if (!user || !hasPermission(user.role, 'treasury:read')) {
    redirect(user?.role === 'budget_viewer' ? '/budget' : '/no-access')
  }

  let initialEntity: (typeof ENTITIES)[number] = ENTITIES[0]
  let initialData = await getTreasuryTransactions({
    entity: initialEntity,
    limit: PAGE_SIZE,
    offset: 0,
  })

  // If the default entity has no data, pick the first entity that does so the
  // page isn't empty on first paint. This only runs once on SSR.
  if (initialData.total === 0) {
    for (const entity of ENTITIES.slice(1)) {
      const candidate = await getTreasuryTransactions({
        entity,
        limit: PAGE_SIZE,
        offset: 0,
      })
      if (candidate.total > 0) {
        initialEntity = entity
        initialData = candidate
        break
      }
    }
  }

  return (
    <TransactionsPageClient
      initialEntity={initialEntity}
      initialTransactions={initialData.transactions}
      initialTotal={initialData.total}
      initialSummary={initialData.summary}
      pageSize={PAGE_SIZE}
    />
  )
}
