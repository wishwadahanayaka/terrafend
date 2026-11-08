// A forecast fetched longer ago than this is not shown, even if its hours still cover the next
// 3. Forecasts lose accuracy as they age, and thunderstorms most of all: where and when a storm
// lands is the first thing a model gets wrong.
export const FORECAST_MAX_AGE_MS = 6 * 3_600_000

// Exactly 6 hours is still shown, a moment past it is not
export const forecastTooOld = (fetchedAt: number, now: number): boolean => now - fetchedAt > FORECAST_MAX_AGE_MS
