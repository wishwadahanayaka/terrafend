import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLewm, type LewmEntry, type LewmResult, type LewmWarning, type PdfPage, type TextItem } from '../../supabase/functions/landslide-refresh/lewm.ts'
import { MAX_PDF_BYTES, pdfPages, readLewmPdf } from '../../supabase/functions/landslide-refresh/pdfText.ts'

// NBRO's landslide warnings (LEWM), read from three real ones and from layouts built here. No network.
// The real ones are kept as text with positions (what pdfText.ts gets from the PDF), not as PDFs: the
// PDFs are DMC's documents and over 450 KB each.
//   LEWM-14-05-2026-2200-08.json 13 districts, the table over pages 2 to 4, a Level 2 cell that breaks
//                                across pages 3 and 4
//   LEWM-14-11-2026-1600-09.json 5 districts, all Level 1
//   LEWM-18-10-2026-1800-20.json the Nuwara Eliya row breaks across pages 2 and 3
// The PDF step itself (pdfText.ts) is tried on small PDFs written in the test (pdfOf below).

const FIXTURES = join(__dirname, 'fixtures', 'lewm')
const fixturePages = (name: string): PdfPage[] => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')).pages
const UP = String.fromCodePoint(0x2191)
const DOWN = String.fromCodePoint(0x2193)

function ok(result: LewmResult): LewmWarning {
  if (!result.parseOk) throw new Error(`expected a warning, got: ${result.reason}`)
  return result
}
const names = (entries: LewmEntry[], district: string) => entries.filter((e) => e.district === district).map((e) => e.name)
const iso = (ms: number) => new Date(ms).toISOString()

describe('a real LEWM with a table over three pages (LEWM-14-05-2026-2200-08)', () => {
  const read = () => ok(readLewm(fixturePages('LEWM-14-05-2026-2200-08.json')))

  it('reads the fields at the top: message, update, issue time and validity, in Sri Lanka time', () => {
    const w = read()
    expect(w.messageId).toBe('LEWM-14-05-2026-2200-08')
    expect(w.update).toBe(8)
    // 10:00 pm in Sri Lanka is 4:30 pm UTC
    expect(iso(w.issuedAt)).toBe('2026-05-14T16:30:00.000Z')
    expect(iso(w.validFrom)).toBe('2026-05-14T16:30:00.000Z')
    expect(iso(w.validTo)).toBe('2026-05-15T16:30:00.000Z')
    expect(w.previousMessageId).toBe('LEWM-14-05-2026-1600-07')
    // this one has no "First warning issued date" line
    expect(w.firstIssuedOn).toBeNull()
  })

  it('reads the whole table, over three pages', () => {
    const w = read()
    expect(w.levels[1]).toHaveLength(41)
    expect(w.levels[2]).toHaveLength(26)
    expect(w.levels[3]).toHaveLength(0)
    expect([...new Set([...w.levels[1], ...w.levels[2]].map((e) => e.district))].sort()).toEqual(
      ['Badulla', 'Colombo', 'Galle', 'Gampaha', 'Kalutara', 'Kandy', 'Kegalle', 'Kurunegala', 'Matale', 'Matara', 'Monaragala', 'Nuwara Eliya', 'Ratnapura'],
    )
  })

  it('gets each cell into its own row and level', () => {
    const w = read()
    expect(names(w.levels[1], 'Badulla')).toEqual(['Hali_Ela', 'Bandarawela', 'Passara'])
    expect(names(w.levels[2], 'Galle')).toEqual(['Neluwa'])
    expect(names(w.levels[1], 'Galle')).toEqual(['Elpitiya', 'Thawalama', 'Niyagama'])
    expect(names(w.levels[2], 'Kalutara')).toEqual(['Palindanuwara', 'Agalawatta', 'Mathugama', 'Horana', 'Walallawita'])
    // the first row on page 3
    expect(names(w.levels[1], 'Kegalle')).toEqual(['Warakapola', 'Aranayaka', 'Kegalle', 'Rambukkana', 'Dehiowita', 'Ruwanwella', 'Mawanella', 'Yatiyanthota', 'Bulathkohupitiya'])
  })

  it('reads the arrows and the stars', () => {
    const w = read()
    const kandy = w.levels[2].filter((e) => e.district === 'Kandy')
    expect(kandy.map((e) => e.name)).toEqual(['Ganga Ihala Korale', 'Delthota', 'Pasbage Korale', 'Gangawata Korale', 'Pathahewaheta', 'Yatinuwara', 'Doluwa', 'Udapalatha', 'Panvila', 'Akurana'])
    expect(kandy.every((e) => e.shift === 1 && !e.added)).toBe(true)
    const medadumbara = w.levels[1].find((e) => e.name === 'Medadumbara')!
    expect(medadumbara).toMatchObject({ district: 'Kandy', shift: 0, added: true })
    expect(w.levels[1].find((e) => e.name === 'Poojapitiya')).toMatchObject({ shift: 0, added: false })
  })

  it('keeps a cell that breaks across pages 3 and 4 in one piece, in its row', () => {
    const w = read()
    const ratnapura = w.levels[2].filter((e) => e.district === 'Ratnapura')
    expect(ratnapura.map((e) => [e.name, e.shift])).toEqual([
      ['Pelmadulla', 0],
      ['Ratnapura', 0],
      ['Eheliyagoda', 1],
      ['Ayagama', 1],
      ['Kuruwita', 1],
      ['Kiriella', 1],
      ['Kalawana', 1],
    ])
  })
})

describe('real LEWMs as text with positions', () => {
  it('LEWM-14-11-2026-1600-09: every name, with the down arrows', () => {
    const w = ok(readLewm(fixturePages('LEWM-14-11-2026-1600-09.json')))
    expect(w).toMatchObject({ messageId: 'LEWM-14-11-2026-1600-09', update: 9, firstIssuedOn: '2026-11-07', previousMessageId: 'LEWM-13-11-2026-1600-08' })
    expect(iso(w.validFrom)).toBe('2026-11-14T10:30:00.000Z')
    expect(iso(w.validTo)).toBe('2026-11-15T10:30:00.000Z')
    expect(w.levels[1].map((e) => [e.district, e.name, e.shift])).toEqual([
      ['Badulla', 'Soranathota', -1],
      ['Badulla', 'Hali_Ela', -1],
      ['Badulla', 'Badulla', -1],
      ['Badulla', 'Bandarawela', -1],
      ['Badulla', 'Passara', -1],
      ['Badulla', 'Ella', -1],
      ['Kandy', 'Udunuwara', 0],
      ['Kandy', 'Yatinuwara', 0],
      ['Kegalle', 'Yatiyanthota', 0],
      ['Kegalle', 'Mawanella', 0],
      ['Kegalle', 'Aranayake', 0],
      ['Nuwara Eliya', 'Norwood', 0],
      ['Nuwara Eliya', 'Ambagamuwa Korale', 0],
      ['Ratnapura', 'Eheliyagoda', 0],
      ['Ratnapura', 'Weligepola', 0],
      ['Ratnapura', 'Elapatha', 0],
      ['Ratnapura', 'Ayagama', 0],
    ])
    expect(w.levels[2]).toEqual([])
    expect(w.levels[3]).toEqual([])
  })

  it('LEWM-18-10-2026-1800-20: a row that breaks across pages keeps all its cells', () => {
    const w = ok(readLewm(fixturePages('LEWM-18-10-2026-1800-20.json')))
    expect(w.firstIssuedOn).toBe('2026-10-03')
    // "Nuwara Eliya" is at the bottom of page 2 with one line of each cell; the rest is on page 3
    expect(names(w.levels[1], 'Nuwara Eliya')).toEqual(['Ambagamuwa'])
    expect(names(w.levels[2], 'Nuwara Eliya')).toEqual(['Hanguranketha', 'Mathurata', 'Walapane', 'Nildandahinna'])
    // and the rows on page 3 after it
    expect(names(w.levels[2], 'Ratnapura')).toEqual(['Elapatha', 'Kuruwita', 'Ratnapura'])
    expect(w.levels[1]).toHaveLength(33)
    expect(w.levels[2]).toHaveLength(12)
  })
})

// ---- Layouts built here, in the same shape as the real ones ----

const LINE = 13.8
const COLUMN_X = { 0: 37.2, 1: 133.5, 2: 290.7, 3: 448 } as const
const CLOSING_LINES = ['Divisional Secretariat', 'Division(s) (DSD) and', 'surrounding areas.']
const item = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 5 })

type Row = { district: string | string[]; cells: Partial<Record<1 | 2 | 3, string[]>> }
type Options = {
  fields?: string[]
  header?: TextItem[]
  issued?: string
  note?: boolean
}

const FIELDS = [
  'First warning issued date: 07-11-2026',
  'Message ID: LEWM-14-11-2026-1600-09',
  'Update: 9th update',
  'Validity Period: From 16:00 hrs on 14.11.2026 To 16:00 hrs on 15.11.2026',
]
const HEADER = [item('District', 62.9, 110), item('Level 1 (Yellow)', 164.4, 110), item('Level 2 (Amber)', 321.3, 110), item('Level 3 (Red)', 464.5, 110)]
HEADER[0].width = 43.5
HEADER[1].width = 93.7
HEADER[2].width = 94.5
HEADER[3].width = 77.3

// Page 1 has the fields, page 2 the table (each row as tall as its longest cell, the district name and
// the cells centred in it), page 3 the issue time
function layout(rows: Row[], options: Options = {}): PdfPage[] {
  const first = (options.fields ?? FIELDS).map((line, i) => item(line, 37.2, 60 + i * LINE))
  const table: TextItem[] = [...(options.header ?? HEADER)]
  let top = 120
  for (const row of rows) {
    const lines = Math.max(...Object.values(row.cells).map((c) => c!.length + CLOSING_LINES.length))
    const centre = top + 8 + ((lines - 1) * LINE) / 2
    const district = Array.isArray(row.district) ? row.district : [row.district]
    district.forEach((part, i) => table.push(item(part, COLUMN_X[0], centre + (i - (district.length - 1) / 2) * LINE)))
    for (const [level, cell] of Object.entries(row.cells) as [string, string[]][]) {
      const all = [...cell, ...CLOSING_LINES]
      const start = centre - ((all.length - 1) * LINE) / 2
      all.forEach((line, i) => table.push(item(line, COLUMN_X[Number(level) as 1 | 2 | 3], start + i * LINE)))
    }
    top += lines * LINE + 16
  }
  if (options.note !== false) table.push(item('Note: shifted one level up, shifted one level down.', 37.2, top + 10))
  const last = [item('Issued by:', 37.2, 60), item(options.issued ?? '14-11-2026, 16:00 hrs', 420, 60), item('Date and time issued', 420, 74)]
  return [{ items: first }, { items: table }, { items: last }]
}

const SAMPLE: Row[] = [
  { district: 'Badulla', cells: { 1: [`${DOWN} Soranathota, ${DOWN} Hali_Ela,`, 'Passara and Ella'] } },
  { district: 'Kegalle', cells: { 1: ['Yatiyanthota and', 'Mawanella'], 2: [`${UP} Aranayake`] } },
  { district: 'Ratnapura', cells: { 2: ['* Elapatha'], 3: [`${UP}${UP} Ayagama,`, `* ${UP} Kuruwita and`, 'Kalawana'] } },
]

describe('layouts built here', () => {
  it('read like the real ones', () => {
    const w = ok(readLewm(layout(SAMPLE)))
    expect(w.messageId).toBe('LEWM-14-11-2026-1600-09')
    expect(w.levels[1].map((e) => [e.district, e.name, e.shift])).toEqual([
      ['Badulla', 'Soranathota', -1],
      ['Badulla', 'Hali_Ela', -1],
      ['Badulla', 'Passara', 0],
      ['Badulla', 'Ella', 0],
      ['Kegalle', 'Yatiyanthota', 0],
      ['Kegalle', 'Mawanella', 0],
    ])
    expect(w.levels[2].map((e) => [e.district, e.name, e.shift, e.added])).toEqual([
      ['Kegalle', 'Aranayake', 1, false],
      ['Ratnapura', 'Elapatha', 0, true],
    ])
  })

  it('read Level 3 (Red), which none of the real samples had, with double arrows and stars', () => {
    const w = ok(readLewm(layout(SAMPLE)))
    expect(w.levels[3]).toEqual([
      { district: 'Ratnapura', name: 'Ayagama', shift: 2, added: false },
      { district: 'Ratnapura', name: 'Kuruwita', shift: 1, added: true },
      { district: 'Ratnapura', name: 'Kalawana', shift: 0, added: false },
    ])
  })

  it('read a district name that wraps onto two lines', () => {
    const w = ok(readLewm(layout([{ district: ['Nuwara', 'Eliya'], cells: { 1: ['Norwood'] } }])))
    expect(w.levels[1]).toEqual([{ district: 'Nuwara Eliya', name: 'Norwood', shift: 0, added: false }])
  })

  it('accept a table with no rows: every warning lifted', () => {
    const w = ok(readLewm(layout([])))
    expect(w.levels).toEqual({ 1: [], 2: [], 3: [] })
  })

  it('accept the variations seen in the real ones: "Message ID :", no Update line, "Previous Message ID : -"', () => {
    const fields = [
      'Message ID : LEWM-12-06-2026-0400-00',
      'Validity Period : From 04:00 hrs on 12.06.2026 To 04:00 hrs on 13.06.2026',
      'Previous Message ID : -',
    ]
    const w = ok(readLewm(layout(SAMPLE, { fields, issued: '12-06-2026, 04:00 hrs' })))
    expect(w).toMatchObject({ messageId: 'LEWM-12-06-2026-0400-00', update: 0, previousMessageId: null, firstIssuedOn: null })
    expect(iso(w.issuedAt)).toBe('2026-06-11T22:30:00.000Z')
  })
})

// ---- Anything unexpected: parseOk false, with a reason, never half a table ----

function failsWith(pages: PdfPage[], reason: RegExp) {
  const result = readLewm(pages)
  expect(result.parseOk, JSON.stringify(result).slice(0, 200)).toBe(false)
  if (!result.parseOk) expect(result.reason).toMatch(reason)
}

// The real 14 Nov fixture with one change
function changed(change: (items: TextItem[], page: number) => TextItem[]): PdfPage[] {
  return fixturePages('LEWM-14-11-2026-1600-09.json').map((p, i) => ({ items: change(p.items, i) }))
}
const without = (text: string) => changed((items) => items.filter((i) => i.str !== text))
const replaced = (from: string | RegExp, to: string) => changed((items) => items.map((i) => ({ ...i, str: i.str.replace(from, to) })))

describe('a changed or broken layout gives parseOk false', () => {
  it('the real fixture reads fine before any change', () => {
    expect(readLewm(fixturePages('LEWM-14-11-2026-1600-09.json')).parseOk).toBe(true)
  })

  it('no pages, or no text at all (a scan)', () => {
    failsWith([], /no pages/)
    failsWith([{ items: [] }, { items: [{ str: '  ', x: 1, y: 1, width: 1 }] }], /no text/)
  })

  it('a header that is missing a column, has the wrong colour, or is out of order', () => {
    failsWith(without('Level 2 (Amber)'), /header is incomplete/)
    failsWith(replaced('Level 1 (Yellow)', 'Level 1 (Red)'), /Level 1 is Red/)
    failsWith(layout(SAMPLE, { header: [HEADER[0], HEADER[2], HEADER[1], HEADER[3]].map((h, i) => ({ ...h, x: [62.9, 164.4, 321.3, 464.5][i] })) }), /out of order/)
    failsWith(layout(SAMPLE, { header: HEADER.map((h, i) => (i === 3 ? { ...h, y: h.y + 20 } : h)) }), /not on one line/)
    failsWith(layout(SAMPLE, { header: [] }), /no warning table/)
  })

  it('no end of the table (the "Note:" line)', () => {
    failsWith(layout(SAMPLE, { note: false }), /end of the table/)
  })

  it('a cell without its closing words, or with them in the middle', () => {
    // without the first cell's closing words it runs into the next row's cell
    failsWith(changed((items) => items.filter((i, k) => !(i.str === 'surrounding areas.' && k === items.findIndex((j) => j.str === 'surrounding areas.')))), /closing words in the middle/)
    failsWith(changed((items, page) => (page === 1 ? items.filter((i) => !(i.str === 'surrounding areas.' && i.y > 480)) : items)), /doesn't end with/)
    failsWith(layout([{ district: 'Kegalle', cells: { 1: ['Mawanella', 'Divisional Secretariat', 'Division(s) (DSD) and', 'surrounding areas.', 'Kegalle'] } }]), /closing words in the middle|lines up/)
  })

  it('a cell that lines up with no district, or with two', () => {
    failsWith(without('Kandy'), /lines up with 0 districts/)
    // Kandy's name moved up into Badulla's row (more than a line away, so not read as a wrapped name)
    failsWith(changed((items) => items.map((i) => (i.str === 'Kandy' ? { ...i, y: 175 } : i))), /lines up with 2 districts/)
  })

  it('a district with no cells, or with two rows', () => {
    failsWith(layout([...SAMPLE, { district: 'Kandy', cells: {} as Row['cells'] }].map((r) => (r.district === 'Kandy' ? { ...r, cells: { 1: [] } } : r))), /lists no divisions|no cells/)
    failsWith(layout([SAMPLE[0], { ...SAMPLE[1], district: 'Badulla' }]), /two rows/)
  })

  it('text that runs from one column into the next', () => {
    failsWith(changed((items) => items.map((i) => (i.str === 'Udunuwara and Yatinuwara' ? { ...i, width: 400 } : i))), /crosses into the next column/)
  })

  it('something other than a DS name in a cell', () => {
    failsWith(replaced('Udunuwara and Yatinuwara', 'Udunuwara and 12345'), /unexpected text/)
    failsWith(layout([{ district: 'Badulla', cells: { 1: [`${UP}${DOWN} Ella`] } }]), /both arrows/)
    failsWith(layout([{ district: 'Badulla', cells: { 1: [`${UP}${UP}${UP} Ella`] } }]), /too many arrows/)
    failsWith(layout([{ district: 'Badulla 2', cells: { 1: ['Ella'] } }]), /District column/)
  })

  it('no Message ID, two different ones, or an Update that disagrees with it', () => {
    failsWith(replaced(/Message ID: LEWM-14-11-2026-1600-09/, 'Message: LEWM'), /no Message ID/)
    failsWith(layout(SAMPLE, { fields: [...FIELDS, 'Message ID: LEWM-15-11-2026-1600-10'] }), /two different Message IDs/)
    failsWith(layout(SAMPLE, { fields: FIELDS.map((f) => f.replace('Update: 9th', 'Update: 8th')) }), /doesn't match the Message ID/)
  })

  it('a missing, impossible or odd Validity Period', () => {
    failsWith(layout(SAMPLE, { fields: FIELDS.filter((f) => !f.startsWith('Validity')) }), /no Validity Period/)
    const validity = (text: string) => layout(SAMPLE, { fields: FIELDS.map((f) => (f.startsWith('Validity') ? text : f)) })
    failsWith(validity('Validity Period: From 16:00 hrs on 15.11.2026 To 16:00 hrs on 14.11.2026'), /odd Validity Period/)
    failsWith(validity('Validity Period: From 16:00 hrs on 14.11.2026 To 16:00 hrs on 24.11.2026'), /odd Validity Period/)
    failsWith(validity('Validity Period: From 16:00 hrs on 31.02.2026 To 16:00 hrs on 01.03.2026'), /not a real date/)
    failsWith(validity('Validity Period: From 16:00 hrs on 20.11.2026 To 16:00 hrs on 21.11.2026'), /doesn't start near the issue time/)
  })

  it('a printed issue time that disagrees with the Message ID', () => {
    failsWith(layout(SAMPLE, { issued: '14-11-2026, 18:00 hrs' }), /printed issue time/)
  })
})

// A small PDF with the given text at the given places (y from the top of the page, like TextItem), in
// Helvetica 9 pt. ASCII only. Enough to try pdfText.ts without a real PDF.
function pdfOf(pages: PdfPage[]): Uint8Array {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  pages.forEach((page, i) => {
    const stream = page.items.map((it) => `BT /F1 9 Tf 1 0 0 1 ${it.x} ${792 - it.y} Tm (${escape(it.str)}) Tj ET`).join('\n')
    objects[4 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`
    objects[5 + 2 * i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = out.length
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

// SAMPLE without arrows, which Helvetica's plain encoding can't write
const PLAIN: Row[] = [
  { district: 'Badulla', cells: { 1: ['Soranathota, Hali_Ela,', 'Passara and Ella'] } },
  { district: 'Kegalle', cells: { 1: ['Yatiyanthota and', 'Mawanella'], 2: ['* Aranayake'] } },
  { district: 'Ratnapura', cells: { 2: ['* Elapatha'], 3: ['Ayagama,', '* Kuruwita and', 'Kalawana'] } },
]

describe('the PDF step', () => {
  it('turns a PDF page into text with positions: left to right, and from the top of the page down', async () => {
    const pages = await pdfPages(pdfOf([{ items: [item('Hello', 100, 200), item('Level 1 (Yellow)', 300, 400)] }, { items: [item('Second page', 50, 60)] }]))
    expect(pages).toHaveLength(2)
    const [hello, level] = pages[0].items
    expect([hello.str, level.str]).toEqual(['Hello', 'Level 1 (Yellow)'])
    expect(hello.x).toBeCloseTo(100, 0)
    expect(hello.y).toBeCloseTo(200, 0)
    expect(level.x).toBeCloseTo(300, 0)
    expect(level.y).toBeCloseTo(400, 0)
    expect(hello.width).toBeGreaterThan(10)
    expect(pages[1].items[0]).toMatchObject({ str: 'Second page' })
  })

  it('reads a warning from a PDF just as from the text: the same fields, levels and names', async () => {
    const pages = layout(PLAIN)
    const fromPdf = ok(await readLewmPdf(pdfOf(pages)))
    const fromText = ok(readLewm(pages))
    expect(fromPdf).toEqual(fromText)
    expect(fromPdf.messageId).toBe('LEWM-14-11-2026-1600-09')
    expect(fromPdf.levels[3].map((e) => e.name)).toEqual(['Ayagama', 'Kuruwita', 'Kalawana'])
  })

  it('never throws on bytes that are not a PDF, a cut-off PDF, or one that is too big', async () => {
    const notPdf = await readLewmPdf(new TextEncoder().encode('<html>Not found</html>'))
    expect(notPdf).toMatchObject({ parseOk: false })
    if (!notPdf.parseOk) expect(notPdf.reason).toMatch(/could not be read/)

    const whole = pdfOf(layout(PLAIN))
    expect((await readLewmPdf(whole.subarray(0, Math.floor(whole.length / 2)))).parseOk).toBe(false)

    const big = await readLewmPdf(new Uint8Array(MAX_PDF_BYTES + 1))
    expect(big).toMatchObject({ parseOk: false })
    if (!big.parseOk) expect(big.reason).toMatch(/over/)
  })

  it('refuses a PDF with too many pages, with a reason', async () => {
    const result = await readLewmPdf(pdfOf(Array.from({ length: 13 }, () => ({ items: [item('x', 10, 10)] }))))
    expect(result).toMatchObject({ parseOk: false })
    if (!result.parseOk) expect(result.reason).toMatch(/13 pages/)
  })

  it('keeps no PDF in the fixtures folder: the real warnings are kept as text with positions', () => {
    const files = readdirSync(FIXTURES)
    expect(files.filter((f) => /\.pdf$/i.test(f))).toEqual([])
    expect(files.sort()).toEqual(['LEWM-14-05-2026-2200-08.json', 'LEWM-14-11-2026-1600-09.json', 'LEWM-18-10-2026-1800-20.json'])
  })

  it('uses the same unpdf version in the function as in the tests', () => {
    const deno = JSON.parse(readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'landslide-refresh', 'deno.json'), 'utf8'))
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'))
    expect(deno.imports.unpdf).toBe(`npm:unpdf@${pkg.devDependencies.unpdf}`)
  })
})
