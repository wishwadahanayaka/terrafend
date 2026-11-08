import type { HazardType, Severity } from './hazards'
import { metresBetween } from './routeGauges'

// Asking "is this the same one?" when a new report is this close to an active report of
// the same type. The database function similar_reports_nearby uses the same number.
export const DUPLICATE_RADIUS_M = 100

// In the route check, reports of one type this close to each other count as one hazard
export const GROUP_RADIUS_M = 150

// Worst last, so a bigger number is more serious
const RANK: Record<Severity, number> = { passable: 0, large_vehicles_only: 1, blocked: 2 }

export const severityRank = (severity: Severity) => RANK[severity]

// The severities someone can switch an existing report to, worse ones first
export type SeverityChoice = { severity: Severity; direction: 'worse' | 'better' }

export function severityChoices(current: Severity): SeverityChoice[] {
  const others = (Object.keys(RANK) as Severity[]).filter((s) => s !== current)
  return others
    .sort((a, b) => RANK[b] - RANK[a])
    .map((severity) => ({ severity, direction: RANK[severity] > RANK[current] ? 'worse' : 'better' }))
}

type Placed = { id: string; hazard_type: HazardType; lat: number; lng: number; expires_at: string }

// Active reports of the same type within radiusM of a spot, nearest first. Hazards of a
// different type in the same spot, or of the same type further away, are not duplicates.
export function findSimilar<T extends Placed>(
  reports: T[],
  spot: { lat: number; lng: number },
  hazardType: HazardType,
  now: number,
  radiusM = DUPLICATE_RADIUS_M,
): (T & { distance_m: number })[] {
  return reports
    .filter((r) => r.hazard_type === hazardType && new Date(r.expires_at).getTime() > now)
    .map((r) => ({ ...r, distance_m: metresBetween([spot.lng, spot.lat], [r.lng, r.lat]) }))
    .filter((r) => r.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m)
}

type Groupable = {
  id: string
  hazard_type: HazardType
  severity: Severity
  lat: number
  lng: number
  created_at: string
  distance_along_m: number
}

// One hazard made of one or more reports. It looks like its main report (the most serious,
// and the newest of those), so it can be listed and opened like any report. Only its
// distance along the route is different: the middle of all its reports, which is where a
// reroute should steer clear.
export type Grouped<T extends Groupable> = T & { members: T[] }

const closeTo = (a: Groupable, b: Groupable, radiusM: number) =>
  metresBetween([a.lng, a.lat], [b.lng, b.lat]) <= radiusM

// Reports are taken in route order. Each joins the first group of its own type where it is
// within radiusM of every report already in it, or starts a new group. Checking every
// member (not just the nearest) keeps a group from stretching along a road as a chain of
// reports each 140 m from the next, so no group is wider than radiusM.
export function groupReports<T extends Groupable>(reports: T[], radiusM = GROUP_RADIUS_M): Grouped<T>[] {
  const ordered = [...reports].sort(
    (a, b) => a.distance_along_m - b.distance_along_m || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )

  const groups: T[][] = []
  for (const report of ordered) {
    const home = groups.find(
      (members) => members[0].hazard_type === report.hazard_type && members.every((m) => closeTo(m, report, radiusM)),
    )
    if (home) home.push(report)
    else groups.push([report])
  }

  return groups
    .map((members) => {
      const main = members.reduce((best, r) => {
        const better = RANK[r.severity] - RANK[best.severity] || r.created_at.localeCompare(best.created_at)
        return better > 0 ? r : best
      })
      const along = members.map((m) => m.distance_along_m)
      return { ...main, distance_along_m: (Math.min(...along) + Math.max(...along)) / 2, members }
    })
    .sort((a, b) => a.distance_along_m - b.distance_along_m)
}

// How many reports stand behind a list of hazards
export const reportTotal = (groups: { members: unknown[] }[]) => groups.reduce((sum, g) => sum + g.members.length, 0)

export type SeverityResult =
  | 'ok'
  | 'already_updated'
  | 'needs_still_there'
  | 'too_many'
  | 'inactive'
  | 'failed'

// The database function answers with one of these words as its error message
export function severityResultFor(message: string): SeverityResult {
  if (message.includes('already_updated')) return 'already_updated'
  if (message.includes('needs_still_there')) return 'needs_still_there'
  if (message.includes('too_many_updates')) return 'too_many'
  if (message.includes('report_not_active')) return 'inactive'
  return 'failed'
}
