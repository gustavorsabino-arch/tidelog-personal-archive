import { describe, expect, test } from 'bun:test'
import { extractInvoiceFieldsFromText, parseMoney } from './invoice-heuristics'

describe('parseMoney', () => {
  test('US format', () => {
    expect(parseMoney('1,234.56')).toBe(1234.56)
    expect(parseMoney('12,345')).toBe(12345)
    expect(parseMoney('999.99')).toBe(999.99)
  })
  test('EU format', () => {
    expect(parseMoney('1.234,56')).toBe(1234.56)
    expect(parseMoney('12.345.678,00')).toBe(12345678)
  })
  test('plain and spaced', () => {
    expect(parseMoney('5000')).toBe(5000)
    expect(parseMoney('12 345,00')).toBe(12345)
  })
})

describe('extractInvoiceFieldsFromText', () => {
  test('typical US invoice', () => {
    const text = [
      'Node40 LLC',
      '123 Main Street, Troy NY',
      'INVOICE',
      'Invoice Number: INV-2026-0815',
      'Invoice Date: August 1, 2026',
      'Due Date: August 31, 2026',
      'Bill To: Orca OpCo Ltd',
      'Description Qty Price',
      'Accounting services 1 $4,500.00',
      'Subtotal $4,500.00',
      'Total Due $4,500.00 USD',
    ].join('\n')
    const f = extractInvoiceFieldsFromText(text)
    expect(f.vendorName).toBe('Node40 LLC')
    expect(f.amount).toBe(4500)
    expect(f.currency).toBe('USD')
    expect(f.invoiceNumber).toBe('INV-2026-0815')
    expect(f.invoiceDate).toBe('2026-08-01')
    expect(f.dueDate).toBe('2026-08-31')
  })

  test('EU-style invoice with slash dates and EUR', () => {
    const text = [
      'ACME Consulting GmbH',
      'Rechnungs-Nr / Invoice # 2026-114',
      'Date: 19/08/2026',
      'Payment due: 18/09/2026',
      'Beratung 2.500,00',
      'MwSt 475,00',
      'Total 2.975,00 EUR',
    ].join('\n')
    const f = extractInvoiceFieldsFromText(text)
    expect(f.vendorName).toBe('ACME Consulting GmbH')
    expect(f.amount).toBe(2975)
    expect(f.currency).toBe('EUR')
    expect(f.invoiceNumber).toBe('2026-114')
    expect(f.invoiceDate).toBe('2026-08-19')
    expect(f.dueDate).toBe('2026-09-18')
  })

  test('missing fields stay null instead of guessing', () => {
    const f = extractInvoiceFieldsFromText('random text with no structure at all')
    expect(f.amount).toBeNull()
    expect(f.invoiceNumber).toBeNull()
    expect(f.invoiceDate).toBeNull()
    expect(f.dueDate).toBeNull()
    expect(f.currency).toBeNull()
    expect(f.description).toBeNull()
  })

  test('From: line wins vendor, USDC detected', () => {
    const text = [
      'INVOICE',
      'From: Chill Bros Studio',
      'To: Orca Foundation',
      'Invoice #77',
      'Date 2026-07-15',
      'Amount due: 1,250.00 USDC',
    ].join('\n')
    const f = extractInvoiceFieldsFromText(text)
    expect(f.vendorName).toBe('Chill Bros Studio')
    expect(f.amount).toBe(1250)
    expect(f.currency).toBe('USDC')
    expect(f.invoiceNumber).toBe('77')
    expect(f.invoiceDate).toBe('2026-07-15')
  })

  test('total tier beats subtotal and bigger unrelated numbers are ignored', () => {
    const text = [
      'Vendor Co',
      'PO 99887766554433',
      'Item A 100.00',
      'Item B 900.00',
      'Subtotal 1,000.00',
      'Grand Total 1,080.00',
    ].join('\n')
    const f = extractInvoiceFieldsFromText(text)
    expect(f.amount).toBe(1080)
  })
})
