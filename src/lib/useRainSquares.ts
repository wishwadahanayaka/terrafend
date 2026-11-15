import { useMemo } from 'react'
import type { GaugeRain } from './rainMeasured'
import { nextSquares, pastSquares } from './rainSquares'
import type { RainSquareSets } from './rainView'
import { useMeasuredRain } from './useMeasuredRain'
import { useRainMap } from './useRainMap'

const NO_GAUGES: GaugeRain[] = []

// The two sets of squares for the rain map: the past 3 hours (satellite) and the next 3 hours
// (forecast). They are kept apart on purpose and never combined. Each is null when its own data
// can't be loaded, and the other carries on. After a failed refresh the old numbers are dropped
// rather than shown as if current.
export function useRainSquares(): RainSquareSets {
  const forecast = useRainMap()
  const measured = useMeasuredRain()

  const forecastData = forecast.status === 'success' ? forecast.data : null
  const satellite = measured.status === 'success' ? measured.data.satellite : null
  const gauges = measured.status === 'success' ? measured.data.gauges : NO_GAUGES

  // "Now" for the gauge rules is the moment the measured rain was loaded, not the moment of drawing:
  // it is what the readings were judged against, and it is the same when saved data is restored
  const loadedAt = measured.dataUpdatedAt
  const past = useMemo(() => pastSquares(satellite, gauges, loadedAt), [satellite, gauges, loadedAt])
  const next = useMemo(() => nextSquares(forecastData), [forecastData])
  return useMemo(() => ({ past, next }), [past, next])
}
