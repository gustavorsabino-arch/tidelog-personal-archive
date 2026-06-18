import type { PriceSourceTag, PriceKind } from '@/lib/types'
import { fmtPrice } from '@/lib/format'

const GENESIS_LABEL = 'Genesis · seeded opening cost basis (TGE)'

// Provenance label for a stored price source. null → no tooltip (stable/unknown).
function sourceLabel(source: PriceSourceTag): string | null {
  switch (source) {
    case 'birdeye':
      return 'Birdeye'
    case 'defillama':
    case 'cache': // legacy day-level DeFiLlama — same display, no legacy distinction
      return 'DeFiLlama'
    case 'genesis':
    case 'ln': // seeded ORCA opening basis (TGE), not an API price
      return GENESIS_LABEL
    default:
      return null // 'stable' and any unknown stored value → no indicator
  }
}

function tooltip(source: PriceSourceTag, kind?: PriceKind, asOfDate?: string | null): string | undefined {
  const label = sourceLabel(source)
  if (!label) return undefined
  if (source === 'genesis' || source === 'ln') return label // self-contained
  if (!kind) return label // transaction-row usage: source only
  const kindLabel = kind === 'close' ? `UTC daily close${asOfDate ? ` · ${asOfDate}` : ''}` : 'live'
  return `${label} · ${kindLabel}`
}

export function PriceWithSource({
  value,
  source,
  kind,
  asOfDate = null,
}: {
  value: number | null
  source: PriceSourceTag
  kind?: PriceKind
  asOfDate?: string | null
}) {
  if (value == null) return <span style={{ color: 'var(--red)' }}>no price</span>
  const tip = tooltip(source, kind, asOfDate)
  // DeFiLlama-derived (point-in-time fallback OR legacy day-level cache) → violet.
  const style = source === 'defillama' || source === 'cache' ? { color: 'var(--fallback)' } : undefined
  // `.price-tip` is an instant (no-delay) CSS tooltip in globals.css.
  return (
    <span className={tip ? 'price-tip' : undefined} data-tip={tip} style={style}>
      {fmtPrice(value)}
    </span>
  )
}
