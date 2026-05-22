import { describe, it, expect } from 'bun:test'
import { matchVendorByLabel, type QbVendor } from './vendor-match'

describe('matchVendorByLabel', () => {
  const vendors: QbVendor[] = [
    { Id: '1', DisplayName: 'Coinbase, Inc.' },
    { Id: '2', DisplayName: 'AWS' },
    { Id: '3', DisplayName: 'Vitalik Buterin' },
  ]

  it('exact match', () => {
    expect(matchVendorByLabel('AWS', vendors)?.Id).toBe('2')
  })

  it('case-insensitive', () => {
    expect(matchVendorByLabel('aws', vendors)?.Id).toBe('2')
  })

  it('strips punctuation', () => {
    expect(matchVendorByLabel('Coinbase Inc', vendors)?.Id).toBe('1')
  })

  it('no match returns null', () => {
    expect(matchVendorByLabel('Unknown Vendor', vendors)).toBe(null)
  })
})
