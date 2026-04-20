import { GainLossPageClient } from '@/components/gain-loss-page-client'
import { ENTITIES } from '@/lib/constants'
import { getTreasuryGainLoss } from '@/lib/treasury-gain-loss'

export const dynamic = 'force-dynamic'

export default async function GainLossPage() {
  let initialEntity: (typeof ENTITIES)[number] = ENTITIES[0]
  let initialData = await getTreasuryGainLoss(initialEntity)

  if (initialData.gainLoss.length === 0) {
    for (const entity of ENTITIES.slice(1)) {
      const candidate = await getTreasuryGainLoss(entity)
      if (candidate.gainLoss.length > 0) {
        initialEntity = entity
        initialData = candidate
        break
      }
    }
  }

  return (
    <GainLossPageClient
      initialEntity={initialEntity}
      initialGainLoss={initialData.gainLoss}
      initialSummary={initialData.summary}
    />
  )
}
