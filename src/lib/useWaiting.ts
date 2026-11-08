import { useEffect, useState } from 'react'

// True until the time `until` has come. It redraws the screen at that moment, so a button
// that is held back can come back by itself. Null means nothing to wait for.
export function useWaiting(until: number | null): boolean {
  // The `until` whose time has passed, so a later, different wait starts as waiting again
  // Already over when first drawn, so nothing shows for a moment that shouldn't
  const [over, setOver] = useState<number | null>(() => (until !== null && until <= Date.now() ? until : null))

  useEffect(() => {
    if (until === null) return
    const timer = setTimeout(() => setOver(until), Math.max(until - Date.now(), 0))
    return () => clearTimeout(timer)
  }, [until])

  return until !== null && over !== until
}
