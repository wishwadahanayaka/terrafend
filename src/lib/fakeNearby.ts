import { findSimilar } from './duplicates'
import { SEVERITY_WORDS } from './fakeReports'
import { HAZARD_TYPES, type HazardType, type Severity } from './hazards'
import type { SimilarReport } from './reports'

// For testing only, used when the dev server is opened with ?fakeNearby=. It pretends that
// reports already exist near the spot you pick in the report form, so the "is this the same
// one?" question can be tried without putting real reports in the database. reports.ts only
// loads this inside an import.meta.env.DEV check.
//
// A comma-separated list of type:metres[:severity[:minutes]]. The type is a hazard type such
// as fallen_tree. Metres is how far north of the picked spot the report is. Severity is
// blocked, large or passable (large if left out). Minutes is how long ago it was reported
// (20 if left out). Add "!" to the severity to make it look like someone already changed it.
//
// Examples:
//   ?fakeNearby=fallen_tree:40            a fallen tree 40 m away: the question appears
//   ?fakeNearby=fallen_tree:150           too far (over 100 m): no question
//   ?fakeNearby=flood:40                  another type: with a fallen tree picked, no question
//   ?fakeNearby=fallen_tree:40:blocked:5  blocked, reported 5 minutes ago
//   ?fakeNearby=fallen_tree:40:blocked!   blocked, and "Updated to Blocked" shows on its card
//
// The same distance rule as the database is used, so these are tested like real reports.
// Their ids start with "fake-", so confirming one pretends to work and sends nothing.

const METRES_PER_DEGREE_LAT = 110_574

type Fake = Omit<SimilarReport, 'distance_m' | 'lat' | 'lng'> & { metresNorth: number }

function parse(param: string): Fake[] {
  const now = Date.now()
  const fakes: Fake[] = []
  for (const part of param.split(',')) {
    const [type, metres, severityWord = 'large', minutes = '20'] = part.trim().split(':')
    const updated = severityWord.endsWith('!')
    const severity: Severity | undefined = SEVERITY_WORDS[severityWord.replace('!', '').toLowerCase()]
    const hazardType = HAZARD_TYPES.find((h) => h.value === type)?.value as HazardType | undefined
    if (!hazardType || !severity || !/^\d+(\.\d+)?$/.test(metres ?? '') || !/^\d+$/.test(minutes)) {
      console.warn(`fakeNearby: couldn't read "${part}"`)
      continue
    }
    fakes.push({
      id: `fake-nearby-${part.trim()}`,
      hazard_type: hazardType,
      severity,
      metresNorth: Number(metres),
      created_at: new Date(now - Number(minutes) * 60_000).toISOString(),
      expires_at: new Date(now + 4 * 3_600_000).toISOString(),
      severity_updated_at: updated ? new Date(now - 5 * 60_000).toISOString() : null,
    })
  }
  return fakes
}

export function fakeSimilar(lat: number, lng: number, hazardType: HazardType): SimilarReport[] {
  const param = new URLSearchParams(window.location.search).get('fakeNearby') ?? ''
  const reports = parse(param).map(({ metresNorth, ...rest }) => ({
    ...rest,
    lat: lat + metresNorth / METRES_PER_DEGREE_LAT,
    lng,
  }))
  return findSimilar(reports, { lat, lng }, hazardType, Date.now())
}
