import { useCallback, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { dataFrom, offlineMessage } from '../lib/offline'
import { useOnline } from '../lib/useOnline'

// Shown above the map while there is no connection. It sits in the page flow instead of
// floating over the map, so it can't cover the buttons, and the map just gets a bit shorter.
// The time is when the data on screen was loaded, so old data is never passed off as current.
export default function OfflineBanner() {
  useTranslation() // redraws the message when the language changes
  const online = useOnline()
  const cache = useQueryClient().getQueryCache()

  const subscribe = useCallback((notify: () => void) => cache.subscribe(notify), [cache])
  const getFrom = useCallback(
    () => dataFrom(cache.getAll().map((q) => ({ queryKey: q.queryKey, dataUpdatedAt: q.state.dataUpdatedAt }))),
    [cache],
  )
  const from = useSyncExternalStore(subscribe, getFrom)

  if (online) return null
  return (
    <p role="status" className="shrink-0 bg-amber-100 px-3 py-2 text-center text-sm font-medium text-amber-950">
      {offlineMessage(from)}
    </p>
  )
}
