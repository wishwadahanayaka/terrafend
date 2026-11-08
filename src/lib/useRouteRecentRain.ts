import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { NO_RECENT_RAIN, recentRainAlongRoute, type RecentRain } from './routeRecentRain'
import type { RouteResult } from './routing'
import { useMeasuredRain } from './useMeasuredRain'

// What the satellite and the gauges say about the checked route. Both come from the one
// shared measured-rain query, so this adds no request. If it can't be loaded the result is
// empty, with checked false, and the rest of the panel carries on.
export function useRouteRecentRain(route: RouteResult | null): RecentRain {
  const measured = useMeasuredRain(route !== null)
  const data = measured.status === 'success' ? measured.data : null
  // The time the data was loaded stands in for "now", so the wording doesn't flicker
  const loadedAt = measured.dataUpdatedAt
  // The lines are finished text, so they are worked out again when the language changes
  const { i18n } = useTranslation()
  const language = i18n.language

  return useMemo(() => {
    void language
    return route ? recentRainAlongRoute(route, data, loadedAt) : NO_RECENT_RAIN
  }, [route, data, loadedAt, language])
}
