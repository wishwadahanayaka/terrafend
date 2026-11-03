import { metresBetween } from './routeGauges'

// A route line is [lng, lat] pairs. These work out positions along it by distance.

// Distance in metres from the start to each point
export function cumulativeMetres(line: [number, number][]): number[] {
  const along = [0]
  for (let i = 1; i < line.length; i++) along.push(along[i - 1] + metresBetween(line[i - 1], line[i]))
  return along
}

// The spot `metres` along the line, as [lat, lng]. Beyond either end it stops at the end.
export function positionAt(line: [number, number][], along: number[], metres: number): [number, number] {
  const d = Math.min(Math.max(metres, 0), along[along.length - 1])
  let j = 1
  while (j < line.length - 1 && along[j] < d) j++
  const length = along[j] - along[j - 1]
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, (d - along[j - 1]) / length))
  const [lng0, lat0] = line[j - 1]
  const [lng1, lat1] = line[j]
  return [lat0 + (lat1 - lat0) * t, lng0 + (lng1 - lng0) * t]
}

// The part of the line between two distances, as [lat, lng] pairs
export function sliceRoute(line: [number, number][], fromKm: number, toKm: number): [number, number][] {
  if (line.length < 2) return []
  const along = cumulativeMetres(line)
  const total = along[along.length - 1]
  const from = Math.min(Math.max(fromKm * 1000, 0), total)
  const to = Math.min(Math.max(toKm * 1000, 0), total)

  const path: [number, number][] = [positionAt(line, along, from)]
  for (let i = 0; i < line.length; i++) {
    if (along[i] > from && along[i] < to) path.push([line[i][1], line[i][0]])
  }
  path.push(positionAt(line, along, to))
  return path
}
