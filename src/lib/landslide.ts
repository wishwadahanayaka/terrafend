import { isOwnLink } from '../../supabase/functions/news-refresh/shared'
import { currentLang, t } from '../i18n'
import { sriLankaDateTime } from './time'

// NBRO's landslide warnings as the app uses them: reading what landslide_current() answers (migration
// 0011), working out on the phone whether the warning is still valid, and what the chip, the Layers
// panel and the map cards say about it. No network and no React here, so it can all be tested.

export type Level = 1 | 2 | 3

export type LandslideArea = {
  level: Level
  // As printed in the warning
  district: string
  name: string
  // The Survey Department's p-codes, null when the name could not be matched to a DS division
  code: string | null
  districtCode: string | null
  // -2 to 2: the level changed since the last message. added: new in this message.
  shift: number
  added: boolean
  note: string | null
}

// What landslide_current() says, with the times as milliseconds. A warning that could not be read has
// no message, no times and no areas, only its link.
export type LandslideAnswer =
  | { found: false }
  | {
      found: true
      parseOk: false
      listedAt: number
      pdfUrl: string | null
    }
  | {
      found: true
      parseOk: true
      messageId: string
      update: number
      issuedAt: number
      validFrom: number
      validTo: number
      listedAt: number
      pdfUrl: string | null
      areas: LandslideArea[]
    }

// ---- Reading the answer ----

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null)
const time = (value: unknown): number | null => {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

// Where DMC keeps the warning PDFs (the same rule as migration 0011's check on pdf_url)
const PDF_PATH = '/images/dmcreports/'

// Only a link on DMC's own site, in its PDF folder, is shown as "the official warning". The app asks
// again before it draws a link, so a row that got into the table some other way can't send anyone
// elsewhere.
export function officialPdfUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !isOwnLink(url, ['dmc.gov.lk'])) return null
  try {
    return new URL(url).pathname.startsWith(PDF_PATH) ? url : null
  } catch {
    return null
  }
}

function parseArea(raw: unknown): LandslideArea | null {
  if (!isObject(raw)) return null
  const level = raw.level
  if (level !== 1 && level !== 2 && level !== 3) return null
  const district = text(raw.district, 60)
  const name = text(raw.name, 80)
  if (!district || !name) return null
  const code = raw.code === null ? null : typeof raw.code === 'string' && /^LK[0-9]{4}$/.test(raw.code) ? raw.code : undefined
  const districtCode =
    raw.district_code === null || raw.district_code === undefined
      ? null
      : typeof raw.district_code === 'string' && /^LK[0-9]{2}$/.test(raw.district_code)
        ? raw.district_code
        : undefined
  if (code === undefined || districtCode === undefined) return null
  // A matched name has its district too (the table says so)
  if (code !== null && (districtCode === null || !code.startsWith(districtCode))) return null
  const shift = raw.shift
  if (typeof shift !== 'number' || !Number.isInteger(shift) || shift < -2 || shift > 2) return null
  if (typeof raw.added !== 'boolean') return null
  const note = raw.note === null || raw.note === undefined ? null : text(raw.note, 200)
  // An unmatched name has its reason (the table says so)
  if (code === null && note === null) return null
  return { level, district, name, code, districtCode, shift, added: raw.added, note }
}

// What the function answers, checked field by field. Anything that doesn't make sense is null, which
// is a failed load and not an empty answer: nothing is guessed, and nothing is dropped (one name that
// can't be read makes the whole answer unreadable, rather than quietly leaving an area out).
export function parseLandslide(raw: unknown): LandslideAnswer | null {
  if (!isObject(raw)) return null
  if (raw.found === false) return { found: false }
  if (raw.found !== true) return null
  const listedAt = time(raw.listed_at)
  if (listedAt === null || typeof raw.parse_ok !== 'boolean') return null
  const pdfUrl = officialPdfUrl(raw.pdf_url)
  if (!raw.parse_ok) return { found: true, parseOk: false, listedAt, pdfUrl }

  const messageId = text(raw.message_id, 40)
  const update = raw.update
  const issuedAt = time(raw.issued_at)
  const validFrom = time(raw.valid_from)
  const validTo = time(raw.valid_to)
  if (!messageId || typeof update !== 'number' || !Number.isInteger(update) || update < 0) return null
  if (issuedAt === null || validFrom === null || validTo === null || validTo <= validFrom) return null
  if (!Array.isArray(raw.areas)) return null
  const areas: LandslideArea[] = []
  for (const item of raw.areas) {
    const area = parseArea(item)
    if (!area) return null
    areas.push(area)
  }
  return { found: true, parseOk: true, messageId, update, issuedAt, validFrom, validTo, listedAt, pdfUrl, areas }
}

// ---- Is it still valid? ----

// Worked out here, from valid_to and the clock, and never from the server's own "valid" flag: an
// answer kept on the phone and read offline hours later must expire on time.
export function isValidNow(answer: LandslideAnswer, now: number): boolean {
  return answer.found && answer.parseOk && now < answer.validTo
}

export type ActiveWarning = {
  messageId: string
  update: number
  issuedAt: number
  validTo: number
  pdfUrl: string | null
  // Every name in the warning, matched or not
  areas: LandslideArea[]
}

// What the app shows right now. The newest warning only: if it could not be read, that is what is
// said, and an older one is never put in its place (the function makes sure of that).
export type LandslideView =
  // Nothing stored, or the newest warning is over
  | { kind: 'none' }
  | { kind: 'unreadable'; pdfUrl: string | null }
  | { kind: 'active'; warning: ActiveWarning }

export function landslideView(answer: LandslideAnswer, now: number): LandslideView {
  if (!answer.found) return { kind: 'none' }
  if (!answer.parseOk) return { kind: 'unreadable', pdfUrl: answer.pdfUrl }
  if (!isValidNow(answer, now)) return { kind: 'none' }
  const { messageId, update, issuedAt, validTo, pdfUrl, areas } = answer
  return { kind: 'active', warning: { messageId, update, issuedAt, validTo, pdfUrl, areas } }
}

// How long until the warning runs out, so the screen can change at that moment and not up to a minute
// later. null when there is nothing to wait for. Capped because setTimeout can't wait much over 24 days.
const MAX_WAIT_MS = 2 ** 31 - 1
export function msUntilExpiry(answer: LandslideAnswer | undefined, now: number): number | null {
  if (!answer || !answer.found || !answer.parseOk) return null
  const left = answer.validTo - now
  return left > 0 ? Math.min(left, MAX_WAIT_MS) : null
}

// ---- The areas ----

// Which levels are drawn, like every other layer: the serious ones (Level 3 Evacuate, Level 2 Alert)
// always show while the warning is valid, and the switch only adds Level 1 (Watch)
export const isDrawnLevel = (level: Level, switchOn: boolean): boolean => level >= 2 || switchOn

// The areas that go on the map: the ones with a division to draw, at a level that is shown. The
// outlines are only downloaded when this is not empty.
export const areasToDraw = (areas: LandslideArea[], switchOn: boolean): LandslideArea[] =>
  areas.filter((a) => a.code !== null && isDrawnLevel(a.level, switchOn))

// Level 1 areas the switch is keeping off the map (it is off, and the warning has some)
export const hiddenWatchAreas = (areas: LandslideArea[], switchOn: boolean): LandslideArea[] =>
  switchOn ? [] : areas.filter((a) => a.code !== null && a.level === 1)

export const matchedAreas = (areas: LandslideArea[]) => areas.filter((a) => a.code !== null)
export const unmatchedAreas = (areas: LandslideArea[]) => areas.filter((a) => a.code === null)

// The status line's number: every area the warning names, whether or not it can be drawn
export const areaCount = (warning: ActiveWarning) => warning.areas.length

// "Also named in the warning": names as printed, each with its district and level, for the ones that
// could not be put on the map
export function namesWithLevel(areas: LandslideArea[]): string[] {
  return areas.map((a) => `${a.name} (${a.district}, ${t('landslide.levelShort', { level: a.level })})`)
}

// ---- The threats chip ----

// Level 3 (Evacuate) and Level 2 (Alert) count, Level 1 (Watch) doesn't. The chip is for serious
// things, like a river at Alert or above and heavy rain, and a Watch is the lowest step that NBRO
// issues for a long list of divisions on most rainy days (the real warnings name 17 to 39 of them).
// It is still on the map, and in the Layers panel. Every name counts, drawn or not: the warning
// names them, so the chip says so.
export function chipCounts(warning: ActiveWarning): { level3: number; level2: number } {
  return {
    level3: warning.areas.filter((a) => a.level === 3).length,
    level2: warning.areas.filter((a) => a.level === 2).length,
  }
}

// ---- Colours and the way an area is drawn ----

export const LEVEL_COLOR: Record<Level, string> = { 1: '#facc15', 2: '#f97316', 3: '#dc2626' }
// A darker line round each area, so a yellow one still shows on the light map
export const LEVEL_OUTLINE: Record<Level, string> = { 1: '#a16207', 2: '#c2410c', 3: '#991b1b' }

// Light fill and an outline that gets heavier with the level. Level 1 is dashed, so the three still
// differ for someone who can't tell yellow from orange. These are DS divisions, so their edges are
// irregular, unlike the rain's squares, and they have a line round them, which the rain's
// squares mostly don't.
export type AreaStyle = { color: string; weight: number; opacity: number; dashArray?: string; fillColor: string; fillOpacity: number }
export function areaStyle(level: Level): AreaStyle {
  const base = { color: LEVEL_OUTLINE[level], opacity: 0.95, fillColor: LEVEL_COLOR[level] }
  if (level === 1) return { ...base, weight: 2, dashArray: '6 4', fillOpacity: 0.28 }
  if (level === 2) return { ...base, weight: 3, fillOpacity: 0.34 }
  return { ...base, weight: 4, fillOpacity: 0.42 }
}

// ---- Credits (English only, like the other data credits) ----

export const LANDSLIDE_CREDIT = 'Landslide warnings: NBRO, via DMC'
// The same words as the boundary files' own metadata (a test checks)
export const BOUNDARY_CREDIT =
  'Administrative boundaries: Survey Department of Sri Lanka, via OCHA (Humanitarian Data Exchange), CC BY-IGO 3.0. Simplified, with name fixes, by TerraFend.'
export const BOUNDARY_URL = 'https://data.humdata.org/dataset/cod-ab-lka'
// What the map's own attribution corner adds while the areas are drawn
export const MAP_ATTRIBUTION = 'Boundaries: Survey Department of Sri Lanka via HDX, CC BY-IGO'

// ---- The card ----

// "Raised since the last warning", "Lowered since the last warning", "Newly added", or nothing
export type ChangeKind = 'added' | 'raised' | 'raisedTwo' | 'lowered' | 'loweredTwo'
export function changeOf(area: Pick<LandslideArea, 'shift' | 'added'>): ChangeKind | null {
  if (area.added) return 'added'
  if (area.shift >= 2) return 'raisedTwo'
  if (area.shift === 1) return 'raised'
  if (area.shift <= -2) return 'loweredTwo'
  if (area.shift === -1) return 'lowered'
  return null
}

type Named = { en: string; si: string; ta: string }
const pick = (names: Named | undefined, fallback: string): string => {
  if (!names) return fallback
  const lang = currentLang()
  return names[lang] || names.en || fallback
}

export type CardContent = {
  level: Level
  // "Level 2 (Amber): Alert", as NBRO prints the levels
  levelText: string
  // "Aranayake DS division, Kegalle district", in the person's language
  place: string
  change: string | null
  issued: string
  validUntil: string
  source: string
  // Only a link on dmc.gov.lk, or null
  pdfUrl: string | null
}

// Everything the card says about one area. `division` and `district` are the Survey Department's
// names in the three languages, when the boundary file has them.
export function cardContent(
  area: LandslideArea,
  warning: ActiveWarning,
  names: { division?: Named; district?: Named },
): CardContent {
  const change = changeOf(area)
  return {
    level: area.level,
    levelText: t(`landslide.level.${area.level}`),
    place: t('landslide.place', { name: pick(names.division, area.name), district: pick(names.district, area.district) }),
    change: change ? t(`landslide.change.${change}`) : null,
    // Both with the date, since a warning runs over two days: "Issued 16 Nov, 6:52 pm"
    issued: t('landslide.issued', { when: sriLankaDateTime(warning.issuedAt) }),
    validUntil: t('landslide.validUntil', { when: sriLankaDateTime(warning.validTo) }),
    source: t('landslide.source'),
    pdfUrl: officialPdfUrl(warning.pdfUrl),
  }
}
