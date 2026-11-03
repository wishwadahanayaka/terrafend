import { latLngBounds, type LatLngTuple, type Map as LeafletMap } from 'leaflet'
import { RAIN_COLOR, worstRain } from '../lib/rainForecast'
import { warningAreas } from '../lib/rainMap'
import { isAlertOrAbove, STEP_COLOR, worstStep } from '../lib/riverGauges'
import { useRainMap } from '../lib/useRainMap'
import { useRiverGauges } from '../lib/useRiverGauges'
import { useSeriousReports } from '../lib/useSeriousReports'

const REPORT_COLOR = '#dc2626'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

type Part = { text: string; color: string }

// One chip for everything serious right now: rivers at Alert or above, blocked or
// restricted road reports, and heavy rain or thunderstorms in the next 3 hours.
// Tapping it zooms the map out to show all of them. Its own file, because the report
// data it counts comes from Supabase, which loads after the map.
export default function ThreatChip({ map }: { map: LeafletMap | null }) {
  const rivers = useRiverGauges()
  const reports = useSeriousReports()
  const rain = useRainMap()

  const floods = rivers.status === 'success' ? rivers.data.filter((g) => isAlertOrAbove(g.step)) : []
  const roadReports = reports.status === 'success' ? reports.data : []
  const areas = rain.status === 'success' ? warningAreas(rain.data.cells) : []
  const stormAreas = areas.filter((area) => area.some((c) => c.level === 'thunder'))
  const heavyAreas = areas.filter((area) => !stormAreas.includes(area))

  const parts: Part[] = []
  const riverWorst = worstStep(floods)
  if (riverWorst) {
    parts.push({ text: `${plural(floods.length, 'river', 'rivers')} at flood level`, color: STEP_COLOR[riverWorst] })
  }
  if (roadReports.length > 0) {
    parts.push({ text: plural(roadReports.length, 'serious report', 'serious reports'), color: REPORT_COLOR })
  }
  if (stormAreas.length > 0) {
    parts.push({ text: `thunderstorms in ${plural(stormAreas.length, 'area', 'areas')}`, color: RAIN_COLOR.thunder })
  }
  if (heavyAreas.length > 0) {
    const worst = worstRain(heavyAreas.flat().map((c) => c.level ?? 'heavy')) ?? 'heavy'
    parts.push({ text: `heavy rain in ${plural(heavyAreas.length, 'area', 'areas')}`, color: RAIN_COLOR[worst] })
  }

  function showThreats() {
    if (!map) return
    const points: LatLngTuple[] = [
      ...floods.map((g): LatLngTuple => [g.lat, g.lng]),
      ...roadReports.map((r): LatLngTuple => [r.lat, r.lng]),
      ...areas.flat().flatMap((c): LatLngTuple[] => [
        [c.lat - c.halfLat, c.lng - c.halfLng],
        [c.lat + c.halfLat, c.lng + c.halfLng],
      ]),
    ]
    if (points.length === 0) return
    map.fitBounds(latLngBounds(points), { paddingTopLeft: [40, 160], paddingBottomRight: [40, 100], maxZoom: 13 })
  }

  if (parts.length > 0) {
    return (
      <button
        type="button"
        onClick={showThreats}
        className="flex max-w-[calc(100vw-2rem)] flex-wrap gap-x-1.5 gap-y-0.5 rounded-2xl bg-white px-3 py-2 text-left text-[13px] font-semibold text-slate-900 shadow-lg active:bg-slate-100"
      >
        {/* Each part stays on one line, and the dot after it moves with it */}
        {parts.map((part, i) => (
          <span key={part.text} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: part.color }}
              aria-hidden="true"
            />
            {part.text}
            {i < parts.length - 1 && (
              <span aria-hidden="true" className="ml-0.5">
                &middot;
              </span>
            )}
          </span>
        ))}
      </button>
    )
  }

  // Nothing found. "No active threats" is only said when everything loaded, since a
  // missing source could be hiding one.
  const sources = [rivers.status, reports.status, rain.status]
  if (sources.includes('pending')) return null
  return (
    <p className="rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow">
      {sources.every((s) => s === 'success') ? 'No active threats' : 'No threats found in the data that loaded'}
    </p>
  )
}
