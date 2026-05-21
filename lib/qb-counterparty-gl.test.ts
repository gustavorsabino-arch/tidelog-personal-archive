import { describe, it, expect } from 'bun:test'
import { resolveCounterpartyGl } from './qb-counterparty-gl'

describe('resolveCounterpartyGl', () => {
  it('returns null when no override and no map entry', () => {
    expect(resolveCounterpartyGl({ override: null, mapped: null })).toBe(null)
  })

  it('returns the mapped value when override is null', () => {
    expect(resolveCounterpartyGl({ override: null, mapped: '5010' })).toBe('5010')
  })

  it('returns the override when set, regardless of map', () => {
    expect(resolveCounterpartyGl({ override: '6020', mapped: '5010' })).toBe('6020')
  })

  it('returns override even when map is null', () => {
    expect(resolveCounterpartyGl({ override: '6020', mapped: null })).toBe('6020')
  })
})
