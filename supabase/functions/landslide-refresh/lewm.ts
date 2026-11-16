// Reads NBRO's Landslide Early Warning Message (LEWM), the PDF that DMC links from its landslide
// warning list. It works on the PDF's text with positions (pdfText.ts gets them), never on a picture.
// No imports and nothing Deno-only, so the tests can run it.
//
// What a LEWM looks like (checked on ten of them from May to November 2026):
//   - "Message ID: LEWM-14-11-2026-1600-09" (issue date and time, and the update number), sometimes
//     "Update: 9th update", "Validity Period: From 16:00 hrs on 14.11.2026 To 16:00 hrs on 15.11.2026",
//     "Previous Message ID: ..." and "First warning issued date: ...".
//   - A table with the header District | Level 1 (Yellow) | Level 2 (Amber) | Level 3 (Red), one row per
//     district. A cell lists DS divisions ("↑ Thawalama, * Elpitiya and Karandeniya") and always ends
//     with "Divisional Secretariat Division(s) (DSD) and surrounding areas." The district name and the
//     cells are centred in the row. A long table runs onto the next pages without repeating the
//     header, and ends at the "Note:" line.
//   - The Sinhala and Tamil text is partly in legacy fonts and reads as gibberish, so only the
//     English is used.
//
// Anything that doesn't fit this gives parseOk: false and a reason. It never returns half a table.

export type TextItem = {
  str: string
  x: number
  // Distance from the top of the page to the text's baseline
  y: number
  width: number
}
export type PdfPage = { items: TextItem[] }

export type Level = 1 | 2 | 3
export const LEVELS: Record<Level, { name: string; colour: string }> = {
  1: { name: 'Watch', colour: 'Yellow' },
  2: { name: 'Alert', colour: 'Amber' },
  3: { name: 'Evacuate', colour: 'Red' },
}

export type LewmEntry = {
  // As written in the PDF: "Nuwara Eliya", "Hali_Ela"
  district: string
  name: string
  // ↑ is +1, ↑↑ +2, ↓ -1, ↓↓ -2: the level changed since the last message
  shift: number
  // * : newly added with this message
  added: boolean
}

export type LewmWarning = {
  parseOk: true
  messageId: string
  update: number
  issuedAt: number
  validFrom: number
  validTo: number
  // 'YYYY-MM-DD', when the run of messages began
  firstIssuedOn: string | null
  previousMessageId: string | null
  levels: Record<Level, LewmEntry[]>
}
export type LewmFailure = { parseOk: false; reason: string }
export type LewmResult = LewmWarning | LewmFailure

class Unexpected extends Error {}
const fail = (reason: string): never => {
  throw new Unexpected(reason)
}

// ---- Lines and runs ----

// Items closer than this vertically are on one line; a gap wider than RUN_GAP on a line is a new cell
const LINE_TOLERANCE = 2
const RUN_GAP = 4

type Run = { page: number; text: string; x: number; end: number; y: number }

export function runsOf(pages: PdfPage[]): Run[] {
  const runs: Run[] = []
  pages.forEach((page, p) => {
    const items = page.items.filter((i) => i.str.trim() !== '').sort((a, b) => a.y - b.y || a.x - b.x)
    const lines: TextItem[][] = []
    for (const item of items) {
      const line = lines[lines.length - 1]
      if (line && Math.abs(line[0].y - item.y) <= LINE_TOLERANCE) line.push(item)
      else lines.push([item])
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x)
      let run: Run | null = null
      for (const item of line) {
        const end = item.x + Math.max(0, item.width)
        if (run && item.x - run.end <= RUN_GAP) {
          run.text += (item.x - run.end > 1 && !run.text.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str
          run.end = Math.max(run.end, end)
        } else {
          run = { page: p, text: item.str, x: item.x, end, y: line[0].y }
          runs.push(run)
        }
      }
    }
  })
  for (const r of runs) r.text = r.text.replace(/\s+/g, ' ').trim()
  return runs
}

// The document as plain text, a line per line, for the fields at the top
function documentText(runs: Run[]): string {
  const lines: string[] = []
  let last: Run | null = null
  for (const r of runs) {
    if (last && last.page === r.page && Math.abs(last.y - r.y) <= LINE_TOLERANCE) lines[lines.length - 1] += ' ' + r.text
    else lines.push(r.text)
    last = r
  }
  return lines.join('\n')
}

// ---- Times (Sri Lanka time, UTC+5:30, no daylight saving) ----

const SRI_LANKA_OFFSET_MS = 5.5 * 3_600_000

function sriLankaTime(day: string, month: string, year: string, hour = '0', minute = '0'): number {
  const [d, m, y, h, mi] = [day, month, year, hour, minute].map(Number)
  const ms = Date.UTC(y, m - 1, d, h, mi)
  const check = new Date(ms)
  if (y < 2000 || y > 2100 || h > 23 || mi > 59 || check.getUTCDate() !== d || check.getUTCMonth() !== m - 1) {
    fail(`not a real date and time: ${day}.${month}.${year} ${hour}:${minute}`)
  }
  return ms - SRI_LANKA_OFFSET_MS
}

// ---- The fields at the top ----

const ID = /(?<!Previous\s{0,3})Message\s*ID\s*:\s*(LEWM-(\d{2})-(\d{2})-(\d{4})-(\d{2})(\d{2})-(\d{1,3}))\b/g
const PREVIOUS = /Previous\s*Message\s*ID\s*:\s*(LEWM-[0-9-]+|-)/
const UPDATE = /\bUpdate\s*:\s*(\d{1,3})/
const VALIDITY =
  /Validity\s*Period\s*:\s*From\s+(\d{1,2})[:.](\d{2})\s*hrs?\.?\s+on\s+(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s+To\s+(\d{1,2})[:.](\d{2})\s*hrs?\.?\s+on\s+(\d{1,2})[./-](\d{1,2})[./-](\d{4})/gi
const PRINTED_ISSUE = /\b(\d{2})-(\d{2})-(\d{4}),?\s+(\d{1,2}):(\d{2})\s*hrs\b/g
const FIRST_ISSUED = /First\s*warning\s*issued\s*date\s*:\s*(\d{2})-(\d{2})-(\d{4})/i

const MAX_VALID_MS = 72 * 3_600_000

function readFields(text: string) {
  const ids = [...text.matchAll(ID)]
  if (ids.length === 0) fail('no Message ID')
  if (new Set(ids.map((m) => m[1])).size > 1) fail(`two different Message IDs: ${[...new Set(ids.map((m) => m[1]))].join(', ')}`)
  const [, messageId, d, mo, y, h, mi, n] = ids[0]
  const issuedAt = sriLankaTime(d, mo, y, h, mi)
  const update = Number(n)

  const printedUpdate = UPDATE.exec(text)
  if (printedUpdate && Number(printedUpdate[1]) !== update) fail(`"Update: ${printedUpdate[1]}" doesn't match the Message ID ${messageId}`)

  const validity = [...text.matchAll(VALIDITY)]
  if (validity.length === 0) fail('no Validity Period')
  if (new Set(validity.map((m) => m[0].replace(/\s+/g, ' '))).size > 1) fail('two different Validity Periods')
  const v = validity[0]
  const validFrom = sriLankaTime(v[3], v[4], v[5], v[1], v[2])
  const validTo = sriLankaTime(v[8], v[9], v[10], v[6], v[7])
  if (validTo <= validFrom || validTo - validFrom > MAX_VALID_MS) fail(`odd Validity Period: ${v[0]}`)
  if (Math.abs(validFrom - issuedAt) > 24 * 3_600_000) fail(`the Validity Period doesn't start near the issue time in ${messageId}`)

  for (const p of text.matchAll(PRINTED_ISSUE)) {
    if (sriLankaTime(p[1], p[2], p[3], p[4], p[5]) !== issuedAt) fail(`the printed issue time ${p[0]} doesn't match ${messageId}`)
  }

  const first = FIRST_ISSUED.exec(text)
  if (first) sriLankaTime(first[1], first[2], first[3])
  const previous = PREVIOUS.exec(text)
  return {
    messageId,
    update,
    issuedAt,
    validFrom,
    validTo,
    firstIssuedOn: first ? `${first[3]}-${first[2]}-${first[1]}` : null,
    previousMessageId: previous && previous[1] !== '-' ? previous[1] : null,
  }
}

// ---- The table ----

const DISTRICT_HEADER = /^District$/i
const LEVEL_HEADER = /^Level\s*([123])\s*(?:\(\s*([A-Za-z]+)\s*\))?$/i
// The words at the end of every cell
const CLOSING = /\s*Divisional\s+Secretariat\s+Division\s*\(\s*s\s*\)\s*\(\s*DSD\s*\)\s*and\s+surrounding\s+areas\s*\.?\s*$/i
const END_OF_TABLE = /^(Note\s*:|\*\s*newly\s+added|Special\s+Note|Areas\s+and\s+places)/i
// A district's name may wrap onto a second line, closer than this
const DISTRICT_WRAP = 15

type Columns = { thresholds: [number, number, number]; starts: [number, number, number, number] }

// The header line of a page, or null if the page has none. Words of a header without the rest of
// it mean the layout changed.
function headerOf(runs: Run[]): { y: number; columns: Columns } | null {
  const district = runs.filter((r) => DISTRICT_HEADER.test(r.text))
  const levels = runs.filter((r) => LEVEL_HEADER.test(r.text))
  if (district.length === 0 && levels.length === 0) return null
  if (district.length !== 1 || levels.length !== 3) fail('the table header is incomplete')
  const [d] = district
  const byLevel = new Map<number, Run>()
  for (const r of levels) {
    const [, n, colour] = LEVEL_HEADER.exec(r.text)!
    const level = Number(n) as Level
    if (colour && colour.toLowerCase() !== LEVELS[level].colour.toLowerCase()) fail(`the header says Level ${n} is ${colour}`)
    byLevel.set(level, r)
  }
  const cols = [d, byLevel.get(1), byLevel.get(2), byLevel.get(3)]
  if (cols.some((c) => !c)) fail('the table header is incomplete')
  const [c0, c1, c2, c3] = cols as Run[]
  if (cols.some((c) => Math.abs(c!.y - d.y) > LINE_TOLERANCE)) fail('the table header is not on one line')
  if (!(c0.end < c1.x && c1.end < c2.x && c2.end < c3.x)) fail('the table header is out of order')
  // A cell's text starts at its column's left edge, which is right of the previous column's header
  // (headers are centred in their columns). So a run belongs to the last column whose previous
  // header ends left of where the run starts.
  return { y: d.y, columns: { thresholds: [c0.end, c1.end, c2.end], starts: [c0.x, c1.x, c2.x, c3.x] } }
}

function columnOf(run: Run, { thresholds, starts }: Columns): 0 | 1 | 2 | 3 {
  const col = run.x < thresholds[0] ? 0 : run.x < thresholds[1] ? 1 : run.x < thresholds[2] ? 2 : 3
  // Text that runs past where the next column's header starts would be in two cells at once
  if (col < 3 && run.end > starts[col + 1] + LINE_TOLERANCE) fail(`text crosses into the next column: "${run.text}"`)
  return col
}

type Placed = Run & { col: 0 | 1 | 2 | 3 }
// A cell: its lines on its first page (top and bottom), and where it ends if it runs onto the next page
type Segment = { level: Level; page: number; top: number; bottom: number; next: { page: number; bottom: number } | null; text: string }

function tableRuns(runs: Run[], pageCount: number): Placed[] {
  const placed: Placed[] = []
  let columns: Columns | null = null
  for (let page = 0; page < pageCount; page++) {
    const onPage = runs.filter((r) => r.page === page)
    const header = headerOf(onPage)
    if (header) columns = header.columns
    if (!columns) continue
    const cols = columns
    // After the header (on its page), up to the line that ends the table
    let rest = header ? onPage.filter((r) => r.y > header.y + LINE_TOLERANCE) : onPage
    const end = rest.find((r) => END_OF_TABLE.test(r.text) && r.x < cols.thresholds[0])
    if (end) rest = rest.filter((r) => r.y < end.y - LINE_TOLERANCE)
    for (const r of rest) placed.push({ ...r, col: columnOf(r, cols) })
    if (end) return placed
  }
  return columns ? fail('the end of the table (the "Note:" line) was not found') : fail('no warning table')
}

function segmentsOf(placed: Placed[]): Segment[] {
  const segments: Segment[] = []
  for (const level of [1, 2, 3] as Level[]) {
    let open: Segment | null = null
    for (const r of placed.filter((p) => p.col === level)) {
      if (!open) open = { level, page: r.page, top: r.y, bottom: r.y, next: null, text: r.text }
      else {
        open.text += ' ' + r.text
        if (r.page === open.page) open.bottom = r.y
        else if (r.page === open.page + 1) open.next = { page: r.page, bottom: r.y }
        else fail(`a Level ${level} cell runs over more than one page break`)
      }
      if (CLOSING.test(open.text)) {
        open.text = open.text.replace(CLOSING, '').trim()
        if (!open.text) fail(`a Level ${level} cell lists no divisions`)
        if (/Divisional\s+Secretariat/i.test(open.text)) fail(`a Level ${level} cell has its closing words in the middle`)
        segments.push(open)
        open = null
      }
    }
    if (open) fail(`a Level ${level} cell doesn't end with "Divisional Secretariat Division(s) (DSD) and surrounding areas."`)
  }
  return segments
}

type DistrictRow = { name: string; page: number; y: number }

function districtRows(placed: Placed[]): DistrictRow[] {
  const rows: DistrictRow[] = []
  for (const r of placed.filter((p) => p.col === 0)) {
    const last = rows[rows.length - 1]
    if (last && last.page === r.page && r.y - last.y <= DISTRICT_WRAP) last.name += ' ' + r.text
    else rows.push({ name: r.text, page: r.page, y: r.y })
  }
  for (const row of rows) if (!/^[A-Za-z][A-Za-z .'-]*$/.test(row.name)) fail(`unexpected text in the District column: "${row.name}"`)
  return rows
}

const UP = '↑'
const DOWN = '↓'

export function namesOf(text: string, district: string): LewmEntry[] {
  const entries: LewmEntry[] = []
  for (const raw of text.split(/,|;|\s+and\s+|\s+&\s+/i)) {
    let token = raw.trim()
    if (!token) continue
    const ups = [...token].filter((c) => c === UP).length
    const downs = [...token].filter((c) => c === DOWN).length
    const added = token.includes('*')
    if (ups && downs) fail(`both arrows on "${token}"`)
    const shift = ups - downs
    if (Math.abs(shift) > 2) fail(`too many arrows on "${token}"`)
    token = token.replace(new RegExp(`[${UP}${DOWN}*]`, 'g'), '').replace(/^[\s.:]+|[\s.:]+$/g, '').replace(/\s+/g, ' ')
    if (!/^[A-Za-z][A-Za-z0-9 .'()_-]*$/.test(token)) fail(`unexpected text where a DS division should be: "${raw.trim()}"`)
    entries.push({ district, name: token, shift, added })
  }
  if (entries.length === 0) fail(`a cell in ${district} lists no divisions`)
  return entries
}

function readTable(runs: Run[], pageCount: number): Record<Level, LewmEntry[]> {
  const placed = tableRuns(runs, pageCount)
  const rows = districtRows(placed)
  const segments = segmentsOf(placed)
  const levels: Record<Level, LewmEntry[]> = { 1: [], 2: [], 3: [] }
  const filled = new Set<string>()
  const used = new Set<DistrictRow>()

  const names = rows.map((r) => r.name.toLowerCase())
  if (new Set(names).size !== names.length) fail('a district has two rows')

  const t = LINE_TOLERANCE + 1
  // Rows that break across a page, by the page they break after
  const broken = new Map<number, DistrictRow>()
  const rowOf = new Map<Segment, DistrictRow>()

  // First the cells that run onto the next page. Their row is the one breaking there: the bottom
  // row of the first page, or, if the name was carried over, the top row of the next.
  for (const s of segments.filter((x) => x.next)) {
    const next = s.next!
    let found = rows.filter((r) => r.page === s.page && r.y >= s.top - t)
    if (found.length === 0) found = rows.filter((r) => r.page === next.page && r.y <= next.bottom + t)
    if (found.length !== 1) fail(`a Level ${s.level} cell running onto the next page lines up with ${found.length} districts`)
    const have = broken.get(s.page)
    if (have && have !== found[0]) fail(`two different rows break after page ${s.page + 1}`)
    broken.set(s.page, found[0])
    rowOf.set(s, found[0])
  }

  for (const s of segments.filter((x) => !x.next)) {
    // The district name and the cells are centred in their row, so a cell's lines span the name
    let found = rows.filter((r) => r.page === s.page && r.y >= s.top - t && r.y <= s.bottom + t)
    if (found.length === 0) {
      // Or it is the part of a broken row that sits wholly on the other page: at the bottom of the page
      // the row breaks after, or at the top of the page after
      const others = (page: number, except: DistrictRow) => rows.filter((r) => r.page === page && r !== except)
      const after = broken.get(s.page)
      const before = broken.get(s.page - 1)
      if (after && others(s.page, after).every((r) => r.y < s.top - t)) found = [after]
      else if (before && others(s.page, before).every((r) => r.y > s.bottom + t)) found = [before]
    }
    if (found.length !== 1) fail(`a Level ${s.level} cell ("${s.text.slice(0, 40)}") lines up with ${found.length} districts`)
    rowOf.set(s, found[0])
  }

  for (const s of segments) {
    const row = rowOf.get(s)!
    const key = `${row.name}:${s.level}`
    if (filled.has(key)) fail(`${row.name} has two Level ${s.level} cells`)
    filled.add(key)
    used.add(row)
    levels[s.level].push(...namesOf(s.text, row.name))
  }
  const empty = rows.filter((r) => !used.has(r))
  if (empty.length) fail(`no cells for ${empty.map((r) => r.name).join(', ')}`)
  return levels
}

// ---- The whole message ----

export function readLewm(pages: PdfPage[]): LewmResult {
  try {
    if (pages.length === 0) fail('the PDF has no pages')
    const runs = runsOf(pages)
    if (runs.length === 0) fail('the PDF has no text (a scan?)')
    const fields = readFields(documentText(runs))
    const levels = readTable(runs, pages.length)
    return { parseOk: true, ...fields, levels }
  } catch (err) {
    if (err instanceof Unexpected) return { parseOk: false, reason: err.message }
    return { parseOk: false, reason: `the reader failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
