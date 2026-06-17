import type { PriceSourceTag, PriceKind } from '@/lib/types'

const SOURCE_LABEL: Record<PriceSourceTag, string> = {
  birdeye: 'Birdeye',
  defillama: 'DeFiLlama (Birdeye fallback)',
  stable: 'Stablecoin',
}

function tooltip(source: PriceSourceTag, kind: PriceKind, asOfDate?: string | null): string | undefined {
  if (source === 'stable') return undefined
  const kindLabel = kind === 'close' ? `UTC daily close${asOfDate ? ` · ${asOfDate}` : ''}` : 'live'
  return `${SOURCE_LABEL[source]} · ${kindLabel}`
}

export function PriceWithSource({
  value,
  source,
  kind,
  decimals = 2,
  asOfDate = null,
}: {
  value: number | null
  source: PriceSourceTag
  kind: PriceKind
  decimals?: number
  asOfDate?: string | null
}) {
  if (value == null) return <span style={{ color: 'var(--red)' }}>no price</span>
  const tip = tooltip(source, kind, asOfDate)
  const style = source === 'defillama' ? { color: 'var(--fallback)' } : undefined
  // `.price-tip` is an instant (no-delay) CSS tooltip in globals.css — the
  // native `title` attribute has a ~1s browser delay, too slow for this.
  return (
    <span className={tip ? 'price-tip' : undefined} data-tip={tip} style={style}>
      ${value.toFixed(decimals)}
    </span>
  )
}
