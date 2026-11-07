// Shared by vite.config.ts (the service worker) and the tests. Kept free of browser code
// so the config can import it.

// Only tiles a person has looked at are kept. OpenStreetMap forbids fetching tiles ahead
// of time, and asks for tiles to be cached for at least 7 days, so that is both how long
// they are kept and the longest they are reused without asking again.
export const TILE_URL_PATTERN = /^https:\/\/tile\.openstreetmap\.org\//
export const TILE_CACHE_NAME = 'osm-tiles'
export const TILE_CACHE_DAYS = 7
// About 5 to 10 MB. The oldest go first when it is full.
export const TILE_CACHE_MAX_ENTRIES = 400
