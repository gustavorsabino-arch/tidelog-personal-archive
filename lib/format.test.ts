import { test, expect } from 'bun:test'
import { fmtPrice } from './format'

test('fmtPrice formats spot prices: commas, adaptive decimals, e-notation < $0.001', () => {
  expect(fmtPrice(90000)).toBe('$90,000.00')
  expect(fmtPrice(1234.5678)).toBe('$1,234.57')   // rounded, comma
  expect(fmtPrice(73.77)).toBe('$73.77')
  expect(fmtPrice(1.2425)).toBe('$1.2425')         // trailing zeros trimmed
  expect(fmtPrice(0.5)).toBe('$0.50')
  expect(fmtPrice(0.023)).toBe('$0.023')           // stays decimal
  expect(fmtPrice(0.0024)).toBe('$0.0024')         // >= 0.001 → decimal
  expect(fmtPrice(0.0000234)).toBe('$2.34e-5')     // < 0.001 → e-notation
  expect(fmtPrice(-5.5)).toBe('-$5.50')
  expect(fmtPrice(0)).toBe('—')
  expect(fmtPrice(null)).toBe('—')
  expect(fmtPrice(undefined)).toBe('—')
  expect(fmtPrice(NaN)).toBe('—')
})
