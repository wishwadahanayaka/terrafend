import { useMemo } from 'react'
import { combineRain, type RainSquare } from './rainSquares'
import { useMeasuredRain } from './useMeasuredRain'
import { useRainMap } from './useRainMap'

// The squares for the rain map, from the satellite and the forecast together. If one
// of them can't be loaded the other carries on alone; null means neither is available.
// After a failed refresh the old numbers are dropped rather than shown as if current.
export function useRainSquares(): RainSquare[] | null {
  const forecast = useRainMap()
  const measured = useMeasuredRain()

  const forecastData = forecast.status === 'success' ? forecast.data : null
  const satellite = measured.status === 'success' ? measured.data.satellite : null

  return useMemo(
    () => (forecastData || satellite ? combineRain(forecastData, satellite) : null),
    [forecastData, satellite],
  )
}
