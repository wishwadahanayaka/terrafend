import { useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'

// Uses the same online flag as TanStack Query, so the screen and the data loading always
// agree: while it says offline, queries wait instead of failing, and they run again by
// themselves when the connection is back.
export function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
  )
}
