import { useEffect, useState } from 'react'

// The time, renewed every minute, so "25 min ago" and the news chip's last-24-hours count stay right
// while the app is left open. Also renewed at once when the tab comes back, since timers are slowed
// or paused in a background tab.
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const renew = () => setNow(Date.now())
    const timer = setInterval(renew, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') renew()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return now
}
