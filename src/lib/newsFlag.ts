// The news feed is on for everyone. To take it away again (for example if a source misbehaves),
// change this one line to false: it is then shown only to people who open the app with ?news=1 in
// the address, so it can still be tried on the live site. It works in the production build too.
export const NEWS_FOR_EVERYONE = true

// The rule with the setting passed in, so both settings can be tested
export function newsEnabledWith(everyone: boolean, search?: string): boolean {
  if (everyone) return true
  const query = search ?? (globalThis.location ? globalThis.location.search : '')
  return new URLSearchParams(query).get('news') === '1'
}

// Kept apart from the news code so the main download only carries this small check: the news screens
// and their data code load later, and only when this says yes.
export function newsEnabled(search?: string): boolean {
  return newsEnabledWith(NEWS_FOR_EVERYONE, search)
}
