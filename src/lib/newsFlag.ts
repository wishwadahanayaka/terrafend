// The news feed is shown only to people who open the app with ?news=1 in the address, so it can be
// tried on the live site before anyone else sees it. It works in the production build too.
//
// To switch it on for everyone, change this one line to true. Nothing else needs to change.
export const NEWS_FOR_EVERYONE = false

// Kept apart from the news code so the main download only carries this small check: the news screens
// and their data code load later, and only when this says yes.
export function newsEnabled(search?: string): boolean {
  if (NEWS_FOR_EVERYONE) return true
  const query = search ?? (globalThis.location ? globalThis.location.search : '')
  return new URLSearchParams(query).get('news') === '1'
}
