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

// The two small Sinhala and Tamil fallback fonts in public/fonts. They are kept the first time
// a phone actually needs one (a phone with no Sinhala or Tamil font of its own), not at install.
export const FONT_PATH_PREFIX = '/fonts/'
export const FONT_CACHE_NAME = 'terrafend-fonts'

// The DS division outlines for the landslide layer (src/data/areas/dsAreas.ts, a chunk of its own,
// 134 KB gzipped). It is not part of the install: the app downloads it the first time a warning is
// drawn, and the service worker keeps it from then on, so the areas draw offline too. The built file
// is named after its source (dsAreas-<hash>.js) and nothing else is, so this finds only it.
export const SHAPES_CHUNK_PREFIX = '/assets/dsAreas-'
export const SHAPES_CACHE_NAME = 'terrafend-landslide-areas'
// The name that is left out of the install list, written for the build's file-matching
export const SHAPES_CHUNK_GLOB = '**/dsAreas-*.js'
