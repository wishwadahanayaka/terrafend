// Kept in its own file so code that only needs the key doesn't pull in the Supabase client
export const REPORTS_KEY = 'reports'

// Active reports near a spot, asked by the report form. Never saved offline.
export const SIMILAR_KEY = 'similar-reports'

// The caller's own reports, for the My reports panel. Never saved offline.
export const MY_REPORTS_KEY = 'my-reports'

// Disaster news headlines. Saved offline for 24 hours, but not counted in the offline banner.
export const NEWS_KEY = 'news'

// The landslide warning (landslide_current()). Saved offline for 24 hours, but not counted in the
// offline banner: the Layers panel says when it was saved.
export const LANDSLIDE_KEY = 'landslide'

// The DS division outlines, loaded only when there is a warning to draw. Not saved by the query
// saver: the service worker keeps the file itself.
export const LANDSLIDE_SHAPES_KEY = 'landslide-shapes'
