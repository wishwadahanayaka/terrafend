import { useMemo } from 'react'
import { newsEntryState, type NewsEntryState } from './news'
import { useMinuteClock } from './useMinuteClock'
import { useNews } from './useNews'

export type { NewsEntryState }

// What the News part of the threats chip and the Layers panel's entry show: null while the news feed is
// off or still loading, a count of the last 24 hours (against the clock, so saved headlines read right
// too), or a bare entry without a number when the load failed and nothing is saved.
export function useNewsChip(enabled: boolean): NewsEntryState | null {
  const query = useNews(false, enabled)
  const now = useMinuteClock()
  const items = query.data
  // "Has failed", not "is failing right now": see newsEntryState
  const hasFailed = query.errorUpdatedAt > 0
  const state = useMemo(() => newsEntryState(items, hasFailed, now), [items, hasFailed, now])
  return enabled ? state : null
}
