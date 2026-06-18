import { test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PriceWithSource } from './price-with-source'

test('defillama source renders in the --fallback color + instant tooltip', () => {
  const html = renderToStaticMarkup(
    <PriceWithSource value={1.2345} source="defillama" kind="close" asOfDate="2026-06-12" />,
  )
  expect(html).toContain('var(--fallback)')
  // instant CSS tooltip, not the slow native `title`
  expect(html).toContain('class="price-tip"')
  expect(html).toContain('data-tip="DeFiLlama · UTC daily close · 2026-06-12"')
  expect(html).not.toContain('title=')
})

test('birdeye source: no fallback color, but still an instant tooltip', () => {
  const html = renderToStaticMarkup(<PriceWithSource value={75.1} source="birdeye" kind="live" />)
  expect(html).not.toContain('var(--fallback)')
  expect(html).toContain('class="price-tip"')
  expect(html).toContain('data-tip="Birdeye · live"')
})

test('stable source shows no indicator and no tooltip', () => {
  const html = renderToStaticMarkup(<PriceWithSource value={1} source="stable" kind="live" />)
  expect(html).not.toContain('var(--fallback)')
  expect(html).not.toContain('price-tip')
  expect(html).not.toContain('data-tip')
  expect(html).not.toContain('Birdeye')
})

test('null value renders the placeholder', () => {
  const html = renderToStaticMarkup(<PriceWithSource value={null} source="birdeye" kind="close" />)
  expect(html).toContain('no price')
})

test('cache source renders violet with a plain DeFiLlama tooltip (no kind)', () => {
  const html = renderToStaticMarkup(<PriceWithSource value={0.89} source="cache" />)
  expect(html).toContain('var(--fallback)')
  expect(html).toContain('data-tip="DeFiLlama"')
  expect(html).not.toContain('·') // no kind suffix when kind omitted
})

test('genesis source: no fallback color, clarifying TGE hover', () => {
  const html = renderToStaticMarkup(<PriceWithSource value={2.64956} source="genesis" />)
  expect(html).not.toContain('var(--fallback)')
  expect(html).toContain('data-tip="Genesis · seeded opening cost basis (TGE)"')
})

test('ln source is treated like genesis', () => {
  const html = renderToStaticMarkup(<PriceWithSource value={2.64956} source="ln" />)
  expect(html).not.toContain('var(--fallback)')
  expect(html).toContain('Genesis · seeded opening cost basis (TGE)')
})

test('birdeye with kind omitted (tx-row usage) → source-only tooltip', () => {
  const html = renderToStaticMarkup(<PriceWithSource value={75.1} source="birdeye" />)
  expect(html).toContain('data-tip="Birdeye"')
  expect(html).not.toContain('· live')
})
