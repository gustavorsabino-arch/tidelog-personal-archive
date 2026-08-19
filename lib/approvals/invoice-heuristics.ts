/**
 * FREE invoice field extraction: pure text heuristics over the PDF's text
 * layer (extracted client-side with pdf.js — the document never leaves the
 * browser). No API, no cost. Accuracy is deliberately conservative: when a
 * field isn't confidently present it stays null and the human fills it in —
 * the prefill is always reviewed before submission.
 *
 * When ANTHROPIC_API_KEY is configured server-side, the AI extractor
 * (lib/approvals/invoice-extract.ts) takes precedence and this module is
 * the fallback. Keep both output shapes identical.
 */

export type ExtractedInvoiceFields = {
  vendorName: string | null
  description: string | null
  amount: number | null
  currency: string | null
  invoiceNumber: string | null
  invoiceDate: string | null   // YYYY-MM-DD
  dueDate: string | null       // YYYY-MM-DD
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function toIso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Parse "1,234.56", "1.234,56", "1234.56", "12 345,00" → number. */
export function parseMoney(raw: string): number | null {
  const s = raw.replace(/[\s']/g, '')
  if (!/\d/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let normalized: string
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present — the later one is the decimal separator.
    normalized = lastDot > lastComma
      ? s.replace(/,/g, '')
      : s.replace(/\./g, '').replace(',', '.')
  } else if (lastComma >= 0) {
    // Only commas: ",dd" at the end = decimal; otherwise thousands.
    const after = s.length - lastComma - 1
    normalized = after === 2 && (s.match(/,/g) ?? []).length === 1
      ? s.replace(',', '.')
      : s.replace(/,/g, '')
  } else {
    // Only dots: ".ddd" groups repeated = thousands; a single ".dd" = decimal.
    const dots = (s.match(/\./g) ?? []).length
    const after = lastDot >= 0 ? s.length - lastDot - 1 : 0
    normalized = dots > 1 || (dots === 1 && after === 3 && s.length > 4 && !/^0\./.test(s))
      ? s.replace(/\./g, '')
      : s
  }
  const n = parseFloat(normalized)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

type FoundDate = { iso: string; index: number }

function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = []
  // ISO: 2026-08-19
  for (const m of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    const iso = toIso(+m[1], +m[2], +m[3])
    if (iso) out.push({ iso, index: m.index ?? 0 })
  }
  // Slash/dot: 19/08/2026, 08.19.2026 — disambiguate by >12 where possible,
  // otherwise assume MM/DD (most USD invoices).
  for (const m of text.matchAll(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/g)) {
    const a = +m[1]; const b = +m[2]; const y = +m[3]
    let iso: string | null
    if (a > 12 && b <= 12) iso = toIso(y, b, a)
    else if (b > 12 && a <= 12) iso = toIso(y, a, b)
    else iso = toIso(y, a, b) // ambiguous → MM/DD
    if (iso) out.push({ iso, index: m.index ?? 0 })
  }
  // "Aug 19, 2026" / "August 19 2026"
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/g)) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()]
    if (!mon) continue
    const iso = toIso(+m[3], mon, +m[2])
    if (iso) out.push({ iso, index: m.index ?? 0 })
  }
  // "19 Aug 2026" / "19th of August, 2026"
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})\b/g)) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (!mon) continue
    const iso = toIso(+m[3], mon, +m[1])
    if (iso) out.push({ iso, index: m.index ?? 0 })
  }
  return out.sort((a, b) => a.index - b.index)
}

const CURRENCY_CODES = ['USDC', 'USDT', 'USD', 'EUR', 'GBP', 'AED', 'MYR'] as const

function findCurrency(text: string): string | null {
  for (const code of CURRENCY_CODES) {
    if (new RegExp(`\\b${code}\\b`, 'i').test(text)) return code
  }
  if (text.includes('€')) return 'EUR'
  if (text.includes('£')) return 'GBP'
  if (text.includes('$')) return 'USD'
  return null
}

// Money tokens: optional currency marker + digit group with separators.
const MONEY_TOKEN = /(?:USDC|USDT|USD|EUR|GBP|AED|MYR|\$|€|£)?\s?(\d{1,3}(?:[.,\s']\d{3})*(?:[.,]\d{2})?|\d+[.,]\d{2})\b/g

function amountsInLine(line: string): number[] {
  const out: number[] = []
  for (const m of line.matchAll(MONEY_TOKEN)) {
    const n = parseMoney(m[1])
    if (n !== null && n < 1_000_000_000) out.push(n)
  }
  return out
}

export function extractInvoiceFieldsFromText(raw: string): ExtractedInvoiceFields {
  const text = raw.replace(/ /g, ' ')
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  // ── Amount: prefer lines with total/due keywords; take the largest
  // amount on the strongest keyword tier that has one.
  const TIERS: RegExp[] = [
    /\b(total\s+due|amount\s+due|balance\s+due|grand\s+total|total\s+payable)\b/i,
    /\btotal\b/i,
    /\b(amount|due)\b/i,
  ]
  let amount: number | null = null
  for (const tier of TIERS) {
    const candidates = lines.filter((l) => tier.test(l)).flatMap(amountsInLine)
    if (candidates.length > 0) { amount = Math.max(...candidates); break }
  }
  if (amount === null) {
    const all = lines.flatMap(amountsInLine).filter((n) => n >= 1)
    if (all.length > 0) amount = Math.max(...all)
  }

  // ── Invoice number: keyworded first, bare INV-… pattern as fallback.
  // Iterate ALL matches — the standalone word "INVOICE" earlier in the
  // document produces digitless first matches that must be skipped.
  let invoiceNumber: string | null = null
  for (const m of text.matchAll(/invoice\s*(?:no\.?|number|num\.?|#|id)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-\/_.]{0,24})/gi)) {
    const tok = m[1].replace(/[.,:]+$/, '')
    if (!/\d/.test(tok)) continue         // "Invoice Number" header itself
    if (/^20\d{2}$/.test(tok)) continue   // bare year is a date fragment
    invoiceNumber = tok
    break
  }
  if (!invoiceNumber) {
    for (const m of text.matchAll(/\b(INV[-\/]?[A-Za-z0-9\-]{2,20})\b/gi)) {
      if (/\d/.test(m[1])) { invoiceNumber = m[1]; break }
    }
  }

  // ── Dates: label each found date by the 48 chars before it.
  const dates = findDates(text)
  let invoiceDate: string | null = null
  let dueDate: string | null = null
  for (const d of dates) {
    const before = text.slice(Math.max(0, d.index - 48), d.index)
    if (dueDate === null && /\bdue\b/i.test(before)) { dueDate = d.iso; continue }
    if (invoiceDate === null && /(invoice\s*date|date\s*of\s*issue|issue\s*date|issued|billing\s*date|\bdate\b)/i.test(before)) {
      invoiceDate = d.iso
    }
  }
  if (invoiceDate === null && dates.length > 0) invoiceDate = dates[0].iso
  if (dueDate === null) {
    const later = dates.map((d) => d.iso).filter((iso) => invoiceDate !== null && iso > invoiceDate)
    if (later.length > 0) dueDate = later.sort()[0]
  }

  // ── Vendor — the party being PAID, in confidence order:
  //  1. "Account Name:" in the wire/payment details (the beneficiary IS the
  //     vendor on invoices that carry bank instructions)
  //  2. an explicit "From:" line
  //  3. a company-suffix line (LLC/Ltd/PTE/GmbH/Inc/S.A./…) near the top
  //  4. the first header-ish line
  // Lines that are clearly OUR side (Orca/Altitude/Zagreus/Juku entities)
  // or section headers (PAYMENT ADVICE etc.) are never vendor candidates.
  const isOurEntity = (l: string) => /\b(orca|altitude|zagreus|juku)\b/i.test(l)
  const isSectionHeader = (l: string) =>
    /^(payment\s+(advice|information|details)|remittance|statement|wire\s+instructions?|bank\s+details?)\b/i.test(l)
  const cleanVendor = (s: string): string | null => {
    const v = s.trim().replace(/[.,;:]+$/, '').slice(0, 60)
    return v && !isOurEntity(v) ? v : null
  }

  let vendorName: string | null = null
  const accountName = text.match(/account\s+name\s*[:\-]\s*([^\n]{3,80})/i)
  if (accountName) vendorName = cleanVendor(accountName[1])
  if (!vendorName) {
    const fromLine = lines.find((l) => /^from\s*[:\-]\s*\S/i.test(l))
    if (fromLine) vendorName = cleanVendor(fromLine.replace(/^from\s*[:\-]\s*/i, ''))
  }
  if (!vendorName) {
    const suffixLine = lines.slice(0, 14).find((l) =>
      /\b(llc|ltd\.?|limited|pte\.?|gmbh|inc\.?|corp\.?|s\.?a\.?|sarl|bv|oy|ag)\b\.?$/i.test(l.trim())
      && !isOurEntity(l) && !isSectionHeader(l) && l.length <= 70,
    )
    if (suffixLine) vendorName = cleanVendor(suffixLine)
  }
  if (!vendorName) {
    for (const l of lines.slice(0, 8)) {
      if (/^(tax\s+)?invoice\b/i.test(l)) continue
      if (/^(bill|ship|invoice)\s+to\b/i.test(l)) break // customer block starts — stop
      if (/invoice\s*(no|number|#|date)/i.test(l)) continue
      if (isSectionHeader(l) || isOurEntity(l)) continue
      if (findDates(l).length > 0) continue
      const letters = (l.match(/[A-Za-z]/g) ?? []).length
      if (letters >= 3 && l.length <= 60 && letters > l.length / 3) {
        vendorName = cleanVendor(l)
        if (vendorName) break
      }
    }
  }

  return {
    vendorName,
    description: null, // too layout-dependent to guess safely — human fills it
    amount,
    currency: findCurrency(text),
    invoiceNumber,
    invoiceDate,
    dueDate,
  }
}
