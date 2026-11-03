export const RIVER_API_URL = 'https://waterlevels.lk/api/levels'

export const RIVER_CREDIT =
  'Data: Sri Lanka Water Levels (Shakeeb Sadikeen), from the Department of Irrigation'

// The official steps, plus the two cases where there is nothing to grade
export type RiverStep = 'normal' | 'alert' | 'minor' | 'major' | 'none' | 'stale'

export type FloodMark = 'alert' | 'minor' | 'major'

export type Forecast = {
  levelFt: number
  lowFt: number | null
  highFt: number | null
  direction: 'rising' | 'falling' | 'steady' | null
  crossing: FloodMark | null
}

export type RiverGauge = {
  id: string
  river: string
  station: string
  lat: number
  lng: number
  step: RiverStep
  // Written by the API, for example "Near alert"
  note: string | null
  // In feet. null means unknown, never zero.
  level: number | null
  marks: Record<FloodMark, number> | null
  observedAt: string | null
  url: string | null
  forecast: Forecast | null
}

export const STEP_LABEL: Record<RiverStep, string> = {
  normal: 'Normal',
  alert: 'Alert',
  minor: 'Minor flood',
  major: 'Major flood',
  none: 'No official flood levels',
  stale: 'Not reporting',
}

// Yellow, orange, red in that order. The orange is a bright one and the red a
// deep one, so the two can't be mixed up at a glance.
export const STEP_COLOR: Record<RiverStep, string> = {
  normal: '#0284c7',
  alert: '#facc15',
  minor: '#f97316',
  major: '#b91c1c',
  none: '#94a3b8',
  stale: '#cbd5e1',
}

// White text doesn't read well on the lighter colours
export function stepTextColor(step: RiverStep): string {
  return step === 'normal' || step === 'major' ? '#ffffff' : '#0f172a'
}

export function isAlertOrAbove(step: RiverStep): boolean {
  return step === 'alert' || step === 'minor' || step === 'major'
}

const SEVERITY_ORDER: RiverStep[] = ['alert', 'minor', 'major']

// The most serious step among the gauges given, or null if none are at Alert or above
export function worstStep(gauges: RiverGauge[]): RiverStep | null {
  let worst = -1
  for (const g of gauges) worst = Math.max(worst, SEVERITY_ORDER.indexOf(g.step))
  return worst === -1 ? null : SEVERITY_ORDER[worst]
}

// "watch" is the API's name for a Normal gauge close to its alert mark, so it
// is shown as Normal with the note. A status not in this list is skipped.
const STATUS_TO_STEP = new Map<string, RiverStep>([
  ['normal', 'normal'],
  ['watch', 'normal'],
  ['alert', 'alert'],
  ['minor', 'minor'],
  ['major', 'major'],
  ['none', 'none'],
  ['stale', 'stale'],
])

const DIRECTIONS = ['rising', 'falling', 'steady'] as const
const MARKS: FloodMark[] = ['alert', 'minor', 'major']

// Only used to throw out nonsense positions, not to place anything
const LAT_RANGE = [5.5, 10.3]
const LNG_RANGE = [79.2, 82.3]

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isText(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseForecast(raw: unknown): Forecast | null {
  if (!isObject(raw) || !isNum(raw.level_ft)) return null
  const direction = DIRECTIONS.find((d) => d === raw.direction) ?? null
  const crossing = MARKS.find((m) => m === raw.crossing) ?? null
  return {
    levelFt: raw.level_ft,
    lowFt: isNum(raw.low_ft) ? raw.low_ft : null,
    highFt: isNum(raw.high_ft) ? raw.high_ft : null,
    direction,
    crossing,
  }
}

function parseStation(raw: unknown): RiverGauge | null {
  if (!isObject(raw)) return null
  const { river, station, latitude, longitude, status } = raw
  if (!isText(river) || !isText(station) || !isNum(latitude) || !isNum(longitude)) return null
  if (latitude < LAT_RANGE[0] || latitude > LAT_RANGE[1]) return null
  if (longitude < LNG_RANGE[0] || longitude > LNG_RANGE[1]) return null

  const step = typeof status === 'string' ? STATUS_TO_STEP.get(status) : undefined
  if (!step) return null

  // Some gauges with no flood levels send level 0 and no unit. That 0 is a
  // placeholder, so a level only counts when it comes with feet.
  const level = step !== 'stale' && isNum(raw.level) && raw.unit === 'ft' ? raw.level : null

  const m = raw.marks
  const marks =
    isObject(m) && isNum(m.alert) && isNum(m.minor) && isNum(m.major)
      ? { alert: m.alert, minor: m.minor, major: m.major }
      : null

  const observedAt = isText(raw.observedAt) && !Number.isNaN(Date.parse(raw.observedAt)) ? raw.observedAt : null

  // Only real web links are kept, so a bad value can never become a script link
  let url: string | null = null
  if (isText(raw.url)) {
    try {
      if (new URL(raw.url).protocol === 'https:') url = raw.url
    } catch {
      // not a URL
    }
  }

  return {
    id: isText(raw.id) ? raw.id : `${river}/${station}`,
    river: river.trim(),
    station: station.trim(),
    lat: latitude,
    lng: longitude,
    step,
    note: isText(raw.statusNote) ? raw.statusNote : null,
    level,
    marks,
    observedAt,
    url,
    forecast: parseForecast(raw.nextHour),
  }
}

// Throws when the response isn't the shape we expect, so the layer can hide itself
export function parseGauges(json: unknown): RiverGauge[] {
  const list = isObject(json) ? json.stations : undefined
  if (!Array.isArray(list)) throw new Error('River levels: unexpected response')

  const gauges: RiverGauge[] = []
  for (const raw of list) {
    const gauge = parseStation(raw)
    if (gauge) gauges.push(gauge)
  }
  if (gauges.length === 0) throw new Error('River levels: no usable gauges in the response')
  return gauges
}

export function formatFt(feet: number): string {
  return `${feet.toFixed(2)} ft`
}

export const CROSSING_LABEL: Record<FloodMark, string> = {
  alert: 'Alert',
  minor: 'Minor flood',
  major: 'Major flood',
}
