import { describe, it, expect } from 'bun:test'
import { formatIndividualDocNumber, formatBulkDocNumber, parseDocSequence } from './doc-number'

describe('doc-number', () => {
  it('formats individual JE: TL-{Mon}-JE##', () => {
    expect(formatIndividualDocNumber(new Date('2026-02-15'), 7)).toBe('TL-Feb-JE07')
    expect(formatIndividualDocNumber(new Date('2026-12-01'), 1)).toBe('TL-Dec-JE01')
    expect(formatIndividualDocNumber(new Date('2026-02-15'), 100)).toBe('TL-Feb-JE100')
  })

  it('formats bulk JE: BULK-{TOKEN}-{YYYY-MM}', () => {
    expect(formatBulkDocNumber('USDC', new Date('2026-02-15'))).toBe('BULK-USDC-2026-02')
    expect(formatBulkDocNumber('USDC', new Date('2026-02-15'), 1)).toBe('BULK-USDC-2026-02-01')
    expect(formatBulkDocNumber('USDC', new Date('2026-02-15'), 2)).toBe('BULK-USDC-2026-02-02')
  })

  it('parses sequence number from existing doc numbers (for max-per-month query)', () => {
    expect(parseDocSequence('TL-Feb-JE07', 'TL-Feb')).toBe(7)
    expect(parseDocSequence('TL-Feb-JE100', 'TL-Feb')).toBe(100)
    expect(parseDocSequence('TL-Mar-JE07', 'TL-Feb')).toBe(null)
    expect(parseDocSequence('BULK-USDC-2026-02', 'TL-Feb')).toBe(null)
  })
})

