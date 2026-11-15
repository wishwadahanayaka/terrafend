// The small pieces the news-refresh function and the phone's app both use: cleaning a headline and
// checking a link. In a file of its own so the app can use them without downloading the rest of
// logic.ts (the keyword lists especially). logic.ts re-exports all of it.
// No imports and nothing Deno-only, so it loads in Deno, in the browser build and in the tests.

export const MAX_TITLE = 300
export const MAX_URL = 2048

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeOnce(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      const valid = Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      return valid ? String.fromCodePoint(code) : ''
    }
    return NAMED[name.toLowerCase()] ?? whole
  })
}

// Feeds often escape their HTML twice (&amp;#8217;), so this decodes twice
export function decodeEntities(s: string): string {
  return decodeOnce(decodeOnce(s))
}

export const unwrapCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

// Control characters (C0 and C1), and the characters that flip the direction of text. Written with
// explicit code points so no invisible character sits in this file. The joiners Sinhala needs inside
// letters (U+200C, U+200D) are not in the list.
// Matching control characters is the point here: they are removed.
// eslint-disable-next-line no-control-regex
const UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]', 'g')

// A headline as it is kept: no control or text-direction characters, single spaces, at most 300
// characters (counted as letters, not code units, so Sinhala and Tamil aren't cut mid-letter).
export function tidyTitle(text: string): string {
  const clean = text.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(clean)
  return chars.length <= MAX_TITLE ? clean : chars.slice(0, MAX_TITLE - 1).join('') + '…'
}

// A headline from a feed: also without tags, with the entities decoded
export function cleanTitle(raw: string): string {
  return tidyTitle(decodeEntities(unwrapCdata(raw)).replace(/<[^>]*>/g, ' '))
}

export function isOwnHost(host: string, domains: string[]): boolean {
  const h = host.toLowerCase()
  return domains.some((d) => h === d || h === `www.${d}`)
}

// A link as it is stored: https only (http on the source's own site is moved up to https), on the
// source's own site, no login part or port, no #part, no tracking parameters. null if it fails.
// This is what stops a hacked feed from adding a link to somewhere else.
export function normaliseUrl(raw: string, base: string, domains: string[]): string | null {
  let u: URL
  try {
    u = new URL(raw.trim(), base)
  } catch {
    return null
  }
  if (u.protocol === 'http:') u.protocol = 'https:'
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (!isOwnHost(u.hostname, domains)) return null
  u.hash = ''
  for (const key of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(key) || key === 'fbclid' || key === 'gclid') u.searchParams.delete(key)
  }
  return u.href.length <= MAX_URL ? u.href : null
}

// Whether a stored link is still fine to show: exactly https, on the source's own site, no login
// part or port. The app asks this again before it draws a link, so a row that got into the table some
// other way (a hand edit, a bug) still can't send anyone to another site. Unlike normaliseUrl it
// changes nothing.
export function isOwnLink(raw: string, domains: string[]): boolean {
  if (raw.length > MAX_URL) return false
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && isOwnHost(u.hostname, domains)
  } catch {
    return false
  }
}
