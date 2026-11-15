// Which language of news reports the sheet shows: all of them, or one. Remembered on the phone
// (see layerSettings.ts). Its own small file so the main download doesn't carry the news code.
export type NewsFilter = 'all' | 'en' | 'si' | 'ta'

export const DEFAULT_NEWS_FILTER: NewsFilter = 'all'

// Anything that isn't one of the four reads as "all", so a damaged or old saved value is harmless
export function parseNewsFilter(value: unknown): NewsFilter {
  return value === 'en' || value === 'si' || value === 'ta' || value === 'all' ? value : DEFAULT_NEWS_FILTER
}
