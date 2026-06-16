import { describe, it, expect } from 'bun:test'
import {
  mapQbClassesToRows,
  mapQbVendorsToRows,
  classByName,
  vendorByName,
} from './catalog-map'

const NOW = new Date('2026-06-16T00:00:00Z')

describe('mapQbClassesToRows', () => {
  it('prefers FullyQualifiedName, keeps active, skips missing Id/name', () => {
    const rows = mapQbClassesToRows('opco', [
      { Id: '1', Name: 'Ops - Global Colo', FullyQualifiedName: 'Ops:Ops - Global Colo', Active: true },
      { Id: '2', Name: 'Ops', Active: true },
      { Id: '3', Name: 'Old', Active: false },
      { Name: 'NoId', Active: true },
    ], NOW)
    expect(rows).toEqual([
      { entityId: 'opco', qbClassId: '1', qbClassName: 'Ops:Ops - Global Colo', fetchedAt: NOW },
      { entityId: 'opco', qbClassId: '2', qbClassName: 'Ops', fetchedAt: NOW },
    ])
  })
  it('treats undefined Active as active (QB sometimes omits it)', () => {
    const rows = mapQbClassesToRows('opco', [{ Id: '9', Name: 'Finance' }], NOW)
    expect(rows).toHaveLength(1)
  })
})

describe('mapQbVendorsToRows', () => {
  it('keeps active vendors with Id + DisplayName, drops the rest', () => {
    const rows = mapQbVendorsToRows('opco', [
      { Id: '10', DisplayName: 'Vamient Capital', Active: true },
      { Id: '11', DisplayName: 'Gone', Active: false },
      { Id: '12', Active: true },
    ], NOW)
    expect(rows).toEqual([
      { entityId: 'opco', qbVendorId: '10', displayName: 'Vamient Capital', fetchedAt: NOW },
    ])
  })
})

describe('by-name lookups', () => {
  it('classByName / vendorByName key on the stored name', () => {
    const c = classByName([{ entityId: 'opco', qbClassId: '1', qbClassName: 'Ops', fetchedAt: NOW }])
    expect(c.get('Ops')?.qbClassId).toBe('1')
    const v = vendorByName([{ entityId: 'opco', qbVendorId: '10', displayName: 'Vamient Capital', fetchedAt: NOW }])
    expect(v.get('Vamient Capital')?.qbVendorId).toBe('10')
  })
})
