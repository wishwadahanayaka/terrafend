// For testing only. In the dev server, ?fakeForecast= makes Open-Meteo answer 429 without any
// request being sent, so the "too many requests" screens can be seen:
//   ?fakeForecast=429       every forecast request answers 429
//   ?fakeForecast=429later  the first request is real, every one after it answers 429, and the
//                           island forecast refreshes every minute so the effect shows quickly
// The 10-minute wait is cut to 30 seconds, so the button coming back can be seen too.
// openMeteo.ts only loads this inside an import.meta.env.DEV check, so the production build
// leaves it out.

export const FAKE_WAIT_MS = 30_000
export const FAKE_REASON = 'Minutely API request limit exceeded. Please try again in one minute.'

type Mode = '429' | '429later'

export function fakeForecastMode(): Mode | null {
  const value = globalThis.location ? new URLSearchParams(globalThis.location.search).get('fakeForecast') : null
  return value === '429' || value === '429later' ? value : null
}

let requests = 0

// True when this request should be answered with a fake 429
export function fakeForecastFails(): boolean {
  const mode = fakeForecastMode()
  if (!mode) return false
  requests += 1
  return mode === '429' || requests > 1
}
