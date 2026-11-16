import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { LatLngTuple } from 'leaflet'
import { chipCounts, LEVEL_COLOR } from './landslide'
import { boxPoints, placeAreas } from './landslideShapes'
import { useLandslide, useLandslideShapes } from './useLandslide'
import { RAIN_COLOR, worstRain } from './rainForecast'
import { warningAreas } from './rainMap'
import { isAlertOrAbove, STEP_COLOR, worstStep } from './riverGauges'
import { GDACS_LEVEL_COLOR, isSerious } from './gdacs'
import { useGdacsEvents } from './useGdacs'
import { useMeasuredRain } from './useMeasuredRain'
import { useRainMap } from './useRainMap'
import type { RainView } from './rainView'
import { useRainSquares } from './useRainSquares'
import { useRiverGauges } from './useRiverGauges'
import { useSeriousReports } from './useSeriousReports'

const REPORT_COLOR = '#dc2626'

// `view` is set on the rain parts: tapping one switches the map to the rain view it is about.
// `landslide` marks the landslide parts: with the areas on the map a tap fits the map to them, and
// without (the layer is off) it opens the Layers panel, where the warning is described.
export type ThreatPart = { text: string; color: string; view?: RainView; landslide?: true }

// 'threats': there is something serious. 'clear': every source loaded and found nothing.
// 'partial': nothing found, but a source couldn't be loaded. 'loading': still waiting.
export type ThreatState = 'threats' | 'clear' | 'partial' | 'loading'

// Everything serious right now, counted from the river gauges, the report data, and
// the rain (satellite, forecast and gauges together). The chip shows the start of the
// list and the Layers panel shows all of it. Its own file, because the report data
// comes from Supabase, which loads after the map.
export function useThreats(): {
  parts: ThreatPart[]
  points: LatLngTuple[]
  state: ThreatState
  // True when the landslide areas of the chip's parts are on the map (Level 2 and 3 always are, once
  // their outlines have loaded), so a tap can fit the map to them
  landslideOnMap: boolean
} {
  const { t } = useTranslation()
  const rivers = useRiverGauges()
  const landslide = useLandslide()
  // Only what is already loaded: the outlines are asked for by the map layer, never by the chip
  const shapes = useLandslideShapes(false)
  const reports = useSeriousReports()
  const forecast = useRainMap()
  const measured = useMeasuredRain()
  const squares = useRainSquares()
  const alerts = useGdacsEvents(false)

  const floods = rivers.status === 'success' ? rivers.data.filter((g) => isAlertOrAbove(g.step)) : []
  const roadReports = reports.status === 'success' ? reports.data : []
  // The past (satellite) and the next (forecast) are counted apart, since the map shows them apart
  const pastAreas = warningAreas(squares.past ?? [])
  const nextAreas = warningAreas(squares.next ?? [])
  const areas = [...pastAreas, ...nextAreas]
  const gaugesHeavy = measured.status === 'success' ? measured.data.gauges.filter((g) => g.level) : []
  const stormAreas = nextAreas.filter((area) => area.some((c) => c.level === 'thunder'))
  const heavyAreas = nextAreas.filter((area) => !stormAreas.includes(area))

  // Orange and Red global alerts for Sri Lanka or within 500 km of it
  const globalAlerts = alerts.events?.filter((e) => isSerious(e.level)) ?? []

  // Level 3 and Level 2 areas of an active warning (Level 1 is on the map only, see chipCounts)
  const warning = landslide.view?.kind === 'active' ? landslide.view.warning : null
  const slides = warning ? chipCounts(warning) : { level3: 0, level2: 0 }
  const shapeData = shapes.data
  const landslidePoints = useMemo(
    () => (warning && shapeData ? boxPoints(placeAreas(warning.areas, shapeData).drawn, [2, 3]) : []),
    [warning, shapeData],
  )

  const parts: ThreatPart[] = []
  // Official landslide warnings come first: an evacuation warning outranks everything else here, and
  // the chip cuts off what doesn't fit from the end
  if (slides.level3 > 0) {
    parts.push({ text: t('chip.landslide3', { count: slides.level3 }), color: LEVEL_COLOR[3], landslide: true })
  }
  if (slides.level2 > 0) {
    parts.push({ text: t('chip.landslide2', { count: slides.level2 }), color: LEVEL_COLOR[2], landslide: true })
  }
  const riverWorst = worstStep(floods)
  if (riverWorst) {
    parts.push({ text: t('chip.river', { count: floods.length }), color: STEP_COLOR[riverWorst] })
  }
  if (roadReports.length > 0) {
    parts.push({ text: t('chip.report', { count: roadReports.length }), color: REPORT_COLOR })
  }
  if (globalAlerts.length > 0) {
    const worst = globalAlerts.some((e) => e.level === 'Red') ? 'Red' : 'Orange'
    parts.push({ text: t('chip.alert', { count: globalAlerts.length }), color: GDACS_LEVEL_COLOR[worst] })
  }
  // Forecast parts say "likely", measured ones say "measured", so the chip never mixes the two
  if (stormAreas.length > 0) {
    parts.push({ text: t('chip.storm', { count: stormAreas.length }), color: RAIN_COLOR.thunder, view: 'next' })
  }
  if (heavyAreas.length > 0) {
    const worst = worstRain(heavyAreas.flat().map((c) => c.level ?? 'heavy')) ?? 'heavy'
    parts.push({ text: t('chip.heavy', { count: heavyAreas.length }), color: RAIN_COLOR[worst], view: 'next' })
  }
  if (pastAreas.length > 0) {
    const worst = worstRain(pastAreas.flat().map((c) => c.level ?? 'heavy')) ?? 'heavy'
    parts.push({ text: t('chip.heavyMeasured', { count: pastAreas.length }), color: RAIN_COLOR[worst], view: 'past' })
  }
  const gaugeWorst = worstRain(gaugesHeavy.map((g) => g.level ?? 'heavy'))
  if (gaugeWorst) {
    parts.push({
      text: t('chip.gauge', { count: gaugesHeavy.length }),
      color: RAIN_COLOR[gaugeWorst],
      view: 'past',
    })
  }

  // Where to zoom to see all of it
  const points: LatLngTuple[] = [
    ...floods.map((g): LatLngTuple => [g.lat, g.lng]),
    ...roadReports.map((r): LatLngTuple => [r.lat, r.lng]),
    ...gaugesHeavy.map((g): LatLngTuple => [g.lat, g.lng]),
    ...globalAlerts.map((e): LatLngTuple => [e.lat, e.lng]),
    ...landslidePoints,
    ...areas.flat().flatMap((c): LatLngTuple[] => [
      [c.lat - c.halfLat, c.lng - c.halfLng],
      [c.lat + c.halfLat, c.lng + c.halfLng],
    ]),
  ]

  const sources = [rivers.status, reports.status, forecast.status, measured.status, alerts.status, landslide.status]
  const state: ThreatState =
    parts.length > 0
      ? 'threats'
      : sources.includes('pending')
        ? 'loading'
        : sources.every((s) => s === 'success')
          ? 'clear'
          : 'partial'
  return { parts, points, state, landslideOnMap: landslidePoints.length > 0 }
}
