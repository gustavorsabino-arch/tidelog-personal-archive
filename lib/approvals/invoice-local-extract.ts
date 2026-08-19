import { extractInvoiceFieldsFromText, type ExtractedInvoiceFields } from './invoice-heuristics'

/**
 * Client-side (browser) invoice reading — the FREE path. pdf.js extracts
 * the PDF's text layer locally (the document never leaves the machine),
 * then the pure heuristics in invoice-heuristics.ts pick out the fields.
 *
 * Limitations by design: PDFs only (a photo/scan has no text layer — that
 * needs the AI extractor), and accuracy below the AI path. The prefill is
 * always human-reviewed before submission.
 */
export async function extractInvoiceFieldsLocally(file: File): Promise<ExtractedInvoiceFields> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('The free extractor reads PDF invoices only — photos/scans need the AI option')
  }

  const pdfjs = await import('pdfjs-dist')
  // Worker served from public/ (copied from pdfjs-dist at the same version)
  // — avoids bundler-specific worker wiring.
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await loadingTask.promise
  try {
    let text = ''
    const pages = Math.min(doc.numPages, 4) // invoices are short; cap the work
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      // pdf.js returns fragments in CONTENT-STREAM order, which can be
      // arbitrary (footers first, columns interleaved). Sort by visual
      // position — top-to-bottom (PDF Y grows upward), then left-to-right —
      // and only then group fragments into lines by Y proximity, so the
      // heuristics see the page the way a human reads it.
      const fragments = content.items
        .filter((item): item is typeof item & { str: string; transform: number[] } =>
          'str' in item && !!item.str)
      fragments.sort((a, b) => {
        const dy = b.transform[5] - a.transform[5]
        if (Math.abs(dy) > 2) return dy
        return a.transform[4] - b.transform[4]
      })
      let lastY: number | null = null
      for (const item of fragments) {
        const y = Math.round(item.transform[5])
        if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n'
        else if (text && !text.endsWith('\n') && !text.endsWith(' ')) text += ' '
        text += item.str
        lastY = y
      }
      text += '\n'
    }
    if (text.replace(/\s/g, '').length < 20) {
      throw new Error('This PDF has no readable text (probably a scanned image) — fill the fields manually')
    }
    return extractInvoiceFieldsFromText(text)
  } finally {
    loadingTask.destroy().catch(() => {})
  }
}
