import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchPlaces, type Point } from './routing'

const DEBOUNCE_MS = 400
const MIN_CHARS = 3

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

const round1 = (n: number) => Math.round(n * 10) / 10

// Searches are limited per day, so: wait for typing to stop, need 3+ characters,
// remember every answer, and never retry a failure automatically.
export function usePlaceSearch(text: string, focus: Point, enabled: boolean) {
  const trimmed = text.trim()
  const debounced = useDebounced(trimmed, DEBOUNCE_MS)
  const ready = enabled && debounced.length >= MIN_CHARS

  const query = useQuery({
    // The focus is rounded (about 11 km) so a small map nudge still hits the cache
    queryKey: ['places', debounced.toLowerCase(), round1(focus.lat), round1(focus.lng)],
    queryFn: () => searchPlaces(debounced, focus),
    enabled: ready,
    // Backup answers go stale after a minute, so the main search is tried again once it's back
    staleTime: (q) => (q.state.data?.backup ? 60_000 : Infinity),
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  return {
    places: ready ? (query.data?.places ?? []) : [],
    backup: ready && (query.data?.backup ?? false),
    searching: enabled && trimmed.length >= MIN_CHARS && (debounced !== trimmed || query.isFetching),
    error: ready && query.isError ? query.error.message : null,
  }
}
