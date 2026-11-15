import { useMemo } from 'react'
import type { GaugeRain } from './rainMeasured'
import { rainViewCounts, type RainView } from './rainView'
import { useMeasuredRain } from './useMeasuredRain'
import { useRainSquares } from './useRainSquares'

const NO_GAUGES: GaugeRain[] = []

// How many serious things each rain view holds, for the badge on the half of the switch that
// isn't showing
export function useRainViewCounts(): Record<RainView, number> {
  const squares = useRainSquares()
  const measured = useMeasuredRain()
  const gauges = measured.status === 'success' ? measured.data.gauges : NO_GAUGES
  return useMemo(() => rainViewCounts(squares, gauges), [squares, gauges])
}
