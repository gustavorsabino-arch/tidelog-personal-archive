import { TransactionsPageClient } from '@/components/transactions-page-client'
import { ENTITIES } from '@/lib/constants'
import { getTreasuryTransactions } from '@/lib/treasury-transactions'

export const dynamic = 'force-dynamic'

export default async function TransactionsPage() {
  let initialEntity: (typeof ENTITIES)[number] = ENTITIES[0]
  let initialData = await getTreasuryTransactions({
    entity: initialEntity,
    limit: 2000,
    offset: 0,
  })

  if (initialData.total === 0) {
    for (const entity of ENTITIES.slice(1)) {
      const candidate = await getTreasuryTransactions({
        entity,
        limit: 2000,
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
    />
  )
}
