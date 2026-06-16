import { describe, it, expect } from 'bun:test'
import { reconcileClassName } from './reconcile-class'
describe('reconcileClassName', () => {
  it('maps sheet relabels to QB live names', () => {
    expect(reconcileClassName('Operations')).toBe('Ops')
    expect(reconcileClassName('Finance & Accounting')).toBe('Finance')
  })
  it('passes through names QB already uses', () => {
    for (const n of ['Ops','Engineering','Product','Marketing','Finance','Legal','Business Development','General'])
      expect(reconcileClassName(n)).toBe(n)
  })
  it('trims and is case-insensitive on the known relabels', () => {
    expect(reconcileClassName('  Operations ')).toBe('Ops')
  })
})
