import type { LatLngTuple } from 'leaflet'
import { RAIN_COLOR, worstRain } from './rainForecast'
import { warningAreas } from './rainMap'
import { isAlertOrAbove, STEP_COLOR, worstStep } from './riverGauges'
import { GDACS_LEVEL_COLOR, isSerious } from './gdacs'
import { useGdacsEvents } from './useGdacs'
import { useMeasuredRain } from './useMeasuredRain'
import { useRainMap } from './useRainMap'
import { useRainSquares } from './useRainSquares'
import { useRiverGauges } from './useRiverGauges'
import { useSeriousReports } from './useSeriousReports'

const REPORT_COLOR = '#dc2626'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export type ThreatPart = { text: string; color: string }

// 'threats': there is something serious. 'clear': every source loaded and found nothing.
// 'partial': nothing found, but a source couldn't be loaded. 'loading': still waiting.
export type ThreatState = 'threats' | 'clear' | 'partial' | 'loading'

// Everything serious right now, counted from the river gauges, the report data, and
// the rain (satellite, forecast and gauges together). The chip shows the start of the
// list and the Layers panel shows all of it. Its own file, because the report data
// comes from Supabase, which loads after the map.
export function useThreats(): { parts: ThreatPart[]; points: LatLngTuple[]; state: ThreatState } {
  const rivers = useRiverGauges()
  const reports = useSeriousReports()
  const forecast = useRainMap()
  const measured = useMeasuredRain()
  const squares = useRainSquares()
  const alerts = useGdacsEvents(false)

  const floods = rivers.status === 'success' ? rivers.data.filter((g) => isAlertOrAbove(g.step)) : []
  const roadReports = reports.status === 'success' ? reports.data : []
  // Satellite and forecast together, so a storm that both of them show counts once
  const areas = squares ? warningAreas(squares) : []
  const gaugesHeavy = measured.status === 'success' ? measured.data.gauges.filter((g) => g.level) : []
  const stormAreas = areas.filter((area) => area.some((c) => c.level === 'thunder'))
  const heavyAreas = areas.filter((area) => !stormAreas.includes(area))

  // Orange and Red global alerts for Sri Lanka or within 500 km of it
  const globalAlerts = alerts.events?.filter((e) => isSerious(e.level)) ?? []

  const parts: ThreatPart[] = []
  const riverWorst = worstStep(floods)
  if (riverWorst) {
    parts.push({ text: `${plural(floods.length, 'river', 'rivers')} at flood level`, color: STEP_COLOR[riverWorst] })
  }
  if (roadReports.length > 0) {
    parts.push({ text: plural(roadReports.length, 'serious report', 'serious reports'), color: REPORT_COLOR })
  }
  if (globalAlerts.length > 0) {
    const worst = globalAlerts.some((e) => e.level === 'Red') ? 'Red' : 'Orange'
    parts.push({ text: plural(globalAlerts.length, 'global alert', 'global alerts'), color: GDACS_LEVEL_COLOR[worst] })
  }
  if (stormAreas.length > 0) {
    parts.push({ text: `thunderstorms in ${plural(stormAreas.length, 'area', 'areas')}`, color: RAIN_COLOR.thunder })
  }
  if (heavyAreas.length > 0) {
    const worst = worstRain(heavyAreas.flat().map((c) => c.level ?? 'heavy')) ?? 'heavy'
    parts.push({ text: `heavy rain in ${plural(heavyAreas.length, 'area', 'areas')}`, color: RAIN_COLOR[worst] })
  }
  const gaugeWorst = worstRain(gaugesHeavy.map((g) => g.level ?? 'heavy'))
  if (gaugeWorst) {
    parts.push({
      text: `heavy rain measured at ${plural(gaugesHeavy.length, 'gauge', 'gauges')}`,
      color: RAIN_COLOR[gaugeWorst],
    })
  }

  // Where to zoom to see all of it
  const points: LatLngTuple[] = [
    ...floods.map((g): LatLngTuple => [g.lat, g.lng]),
    ...roadReports.map((r): LatLngTuple => [r.lat, r.lng]),
    ...gaugesHeavy.map((g): LatLngTuple => [g.lat, g.lng]),
    ...globalAlerts.map((e): LatLngTuple => [e.lat, e.lng]),
    ...areas.flat().flatMap((c): LatLngTuple[] => [
      [c.lat - c.halfLat, c.lng - c.halfLng],
      [c.lat + c.halfLat, c.lng + c.halfLng],
    ]),
  ]

  const sources = [rivers.status, reports.status, forecast.status, measured.status, alerts.status]
  const state: ThreatState =
    parts.length > 0
      ? 'threats'
      : sources.includes('pending')
        ? 'loading'
        : sources.every((s) => s === 'success')
          ? 'clear'
          : 'partial'
  return { parts, points, state }
}
