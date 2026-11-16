// Gets the text of a PDF with positions, for lewm.ts. Uses unpdf: Mozilla's pdf.js packaged for
// serverless runtimes (no worker, no canvas, no DOM), so it runs in Supabase Edge Functions (Deno)
// and in the Node tests alike. deno.json pins the same version as package.json.
//
// A PDF is untrusted input. This pdf.js build has no eval path at all (the option was removed after
// the 2024 font-eval vulnerability; there is no `new Function` in unpdf's bundle), and it runs
// without system fonts, font faces or XFA forms. The size and page count are limited too.

import { getDocumentProxy } from 'unpdf'
import { readLewm, type LewmResult, type PdfPage, type TextItem } from './lewm.ts'

export const MAX_PDF_BYTES = 3_000_000
// A LEWM is 3 to 5 pages; anything much longer isn't one
export const MAX_PAGES = 12

export async function pdfPages(bytes: Uint8Array): Promise<PdfPage[]> {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error(`the PDF is over ${MAX_PDF_BYTES} bytes`)
  // pdf.js takes ownership of the buffer it is given, so it gets a copy
  const pdf = await getDocumentProxy(new Uint8Array(bytes), {
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    verbosity: 0,
  })
  try {
    if (pdf.numPages > MAX_PAGES) throw new Error(`the PDF has ${pdf.numPages} pages`)
    const pages: PdfPage[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items: TextItem[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        // The viewport turns PDF coordinates (origin bottom left) into top-left ones, rotation included
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
        items.push({ str: item.str, x, y, width: item.width })
      }
      pages.push({ items })
      page.cleanup()
    }
    return pages
  } finally {
    // This pdf.js build closes a document through its loading task
    await pdf.loadingTask.destroy()
  }
}

// The whole step: bytes in, a warning or a reason out. Never throws.
export async function readLewmPdf(bytes: Uint8Array): Promise<LewmResult> {
  let pages: PdfPage[]
  try {
    pages = await pdfPages(bytes)
  } catch (err) {
    return { parseOk: false, reason: `the PDF could not be read: ${err instanceof Error ? err.message : String(err)}` }
  }
  return readLewm(pages)
}
