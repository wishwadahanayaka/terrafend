// Kept in its own file so code that only needs the key doesn't pull in the Supabase client
export const REPORTS_KEY = 'reports'

// Active reports near a spot, asked by the report form. Never saved offline.
export const SIMILAR_KEY = 'similar-reports'

// The caller's own reports, for the My reports panel. Never saved offline.
export const MY_REPORTS_KEY = 'my-reports'
