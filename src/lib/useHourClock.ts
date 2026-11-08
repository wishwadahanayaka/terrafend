import { useEffect, useState } from 'react'
import { currentHourEnd, HOUR_MS } from './openMeteo'

// How long until a new Sri Lanka hour starts, plus a moment so the timer doesn't fire just before it
export function msToNextHour(now: number): number {
  return currentHourEnd(now) - now + 1000
}

// The time, renewed each time a new hour starts. The rain map's "next 3 hours" move on then,
// and nothing else about the screen needs a clock.
export function useHourClock(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const renew = () => {
      const current = Date.now()
      setNow((before) => (currentHourEnd(before) === currentHourEnd(current) ? before : current))
    }
    const schedule = () => {
      timer = setTimeout(() => {
        renew()
        schedule()
      }, Math.min(msToNextHour(Date.now()), HOUR_MS + 1000))
    }
    schedule()
    // Timers are slowed or paused in a background tab, so look again when it comes back
    const onVisible = () => {
      if (document.visibilityState === 'visible') renew()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return now
}
