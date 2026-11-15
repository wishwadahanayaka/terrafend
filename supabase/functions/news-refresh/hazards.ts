// The kinds of disaster a headline is filed under. In a file of its own because the phone's app needs
// this short list too, and keywords.ts (the big word lists) must not be downloaded with it.
// No imports and nothing Deno-only.

export type Hazard =
  | 'flood'
  | 'landslide'
  | 'cyclone'
  | 'rain'
  | 'wind_sea'
  | 'tsunami'
  | 'earthquake'
  | 'elephant'
  | 'road'
  | 'drought'
  | 'other'

// When a headline names several hazards, the first one in this list is the one it is filed under, and
// the app lists the hazards in this order. The database's check on news_items.hazard allows exactly
// these (a test compares them).
export const HAZARDS: Hazard[] = [
  'tsunami',
  'cyclone',
  'landslide',
  'flood',
  'earthquake',
  'wind_sea',
  'rain',
  'elephant',
  'road',
  'drought',
  'other',
]
