import type { MildLevel, RainLevel } from './rainForecast'

// For testing only. In the dev server, ?fakeRainMap= fakes rain on a dry day. It's a
// comma-separated list of [kind-]level:place, where the kind says which source to fake:
//
//   thunder:kandy         forecast (no kind). Thunderstorms near Kandy.
//   sat-heavy:colombo     satellite. Heavy rain in the past 3 hours near Colombo.
//   gauge-heavy:glencourse   a gauge measurement. The place is a real gauge name
//                         (spaces ignored), or a town from the list below.
//
// Levels: light, moderate, heavy, veryheavy, thunder (forecast only, since satellite
// and gauges can't see thunder). Example:
//   ?fakeRainMap=thunder:kandy,sat-heavy:colombo,gauge-veryheavy:glencourse
//
// Only used inside import.meta.env.DEV checks, so the production build removes it.

export type FakeKind = 'forecast' | 'satellite' | 'gauge'

export type FakeLevel = { level: RainLevel | null; mild: MildLevel | null; mm: number }

const LEVELS: Record<string, FakeLevel> = {
  light: { level: null, mild: 'light', mm: 1 },
  moderate: { level: null, mild: 'moderate', mm: 4 },
  heavy: { level: 'heavy', mild: null, mm: 9 },
  veryheavy: { level: 'veryHeavy', mild: null, mm: 18 },
  thunder: { level: 'thunder', mild: null, mm: 20 },
}

export const TEST_PLACES: Record<string, [number, number]> = {
  colombo: [6.93, 79.86],
  kandy: [7.29, 80.64],
  galle: [6.03, 80.22],
  jaffna: [9.66, 80.01],
  trincomalee: [8.57, 81.23],
  batticaloa: [7.71, 81.7],
  anuradhapura: [8.31, 80.4],
  nuwaraeliya: [6.97, 80.77],
  ratnapura: [6.68, 80.4],
  matara: [5.95, 80.55],
  badulla: [6.99, 81.06],
  hambantota: [6.12, 81.12],
  kurunegala: [7.49, 80.37],
  negombo: [7.21, 79.84],
  mannar: [8.98, 79.91],
  polonnaruwa: [7.94, 81.0],
  ampara: [7.3, 81.67],
  puttalam: [8.03, 79.83],
  kalutara: [6.58, 79.96],
  vavuniya: [8.75, 80.5],
}

export type Fake = {
  kind: FakeKind
  fake: FakeLevel
  // The place with spaces removed and in lower case, to match against gauge names
  place: string
  // Where it is, if it's a town from the list
  spot: [number, number] | null
}

export const normalise = (text: string) => text.replace(/\s+/g, '').toLowerCase()

export function readFakeRainMap(kind: FakeKind): Fake[] {
  const spec = new URLSearchParams(window.location.search).get('fakeRainMap')
  if (!spec) return []

  const found: Fake[] = []
  for (const part of spec.split(',')) {
    const [what, where = ''] = part.split(':')
    const [prefix, levelName] = what.includes('-') ? what.split('-') : ['', what]
    const prefixName = prefix.trim().toLowerCase()
    const partKind: FakeKind = prefixName === 'sat' ? 'satellite' : prefixName === 'gauge' ? 'gauge' : 'forecast'
    const fake = LEVELS[levelName.trim().toLowerCase()]
    const place = normalise(where)
    const spot = TEST_PLACES[place] ?? null

    const okLevel = fake && (fake.level !== 'thunder' || partKind === 'forecast')
    const okPlace = spot !== null || partKind === 'gauge'
    if (!okLevel || !okPlace) {
      // Every kind reads the same list, so only one of them reports the mistake
      if (kind === 'forecast') console.warn(
        `fakeRainMap: can't use "${part}". Levels: ${Object.keys(LEVELS)} (thunder only for the forecast). ` +
          `Kinds: sat-, gauge-, or none for the forecast. Towns: ${Object.keys(TEST_PLACES)}`,
      )
      continue
    }
    if (partKind === kind) found.push({ kind, fake, place, spot })
  }
  return found
}

// Straight-line kilometres, plenty good for picking out nearby cells
export function kmFrom(lat: number, lng: number, [spotLat, spotLng]: [number, number]): number {
  return Math.hypot((lat - spotLat) * 111.32, (lng - spotLng) * 111.32 * Math.cos((spotLat * Math.PI) / 180))
}
