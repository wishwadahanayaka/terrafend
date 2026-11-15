// The organisations the "How to help" screen links to, in one place so they are easy to check and
// update. Only these three, and only links on the organisation's own website: people give money
// through this screen, so a wrong link here is worse than a missing one.
//
// When a link changes: edit it here, open it and check it still goes where it says, then move
// HELP_LAST_CHECKED to that day. The screen shows that date. Never add a bank account number, a QR
// code, a payment form or a link to a third-party donation platform. A test checks the links.

// A plain date (year-month-day) of the last time the links were checked
export const HELP_LAST_CHECKED = '2026-11-15'

export type HelpLinkKind = 'donate' | 'volunteer' | 'official'

export type HelpLink = { kind: HelpLinkKind; url: string }

// The page of the organisation's own site the facts and links came from
export type HelpSource = { label: string; url: string }

export type HelpOrganisation = {
  id: string
  // The only website its links may be on. `www.` in front of it is fine, nothing else is.
  domain: string
  // Translation keys: the name people know, and one line on what they do
  nameKey: string
  whatKey: string
  // An extra note shown under the line, if there is one
  noteKey?: string
  links: HelpLink[]
  source: HelpSource
}

export const HELP_ORGANISATIONS: HelpOrganisation[] = [
  {
    id: 'red-cross',
    domain: 'redcross.lk',
    nameKey: 'help.org.redCross.name',
    whatKey: 'help.org.redCross.what',
    links: [
      { kind: 'donate', url: 'https://www.redcross.lk/' },
      { kind: 'volunteer', url: 'https://www.redcross.lk/volunteers/' },
    ],
    source: { label: 'Sri Lanka Red Cross Society website', url: 'https://www.redcross.lk/' },
  },
  {
    id: 'sarvodaya',
    domain: 'sarvodaya.org',
    nameKey: 'help.org.sarvodaya.name',
    whatKey: 'help.org.sarvodaya.what',
    links: [
      { kind: 'donate', url: 'https://www.sarvodaya.org/donations/' },
      { kind: 'volunteer', url: 'https://www.sarvodaya.org/volunteering/' },
    ],
    source: { label: 'Sarvodaya website', url: 'https://www.sarvodaya.org/' },
  },
  {
    id: 'rebuilding-sri-lanka-fund',
    domain: 'cbsl.gov.lk',
    nameKey: 'help.org.rebuilding.name',
    whatKey: 'help.org.rebuilding.what',
    noteKey: 'help.org.rebuilding.note',
    // The fund has one official page, not a separate donate and volunteer page
    links: [
      { kind: 'official', url: 'https://www.cbsl.gov.lk/en/faq/let-us-unite-and-donate-to-help-our-motherland' },
    ],
    source: {
      label: 'Central Bank of Sri Lanka, Rebuilding Sri Lanka Fund page',
      url: 'https://www.cbsl.gov.lk/en/faq/let-us-unite-and-donate-to-help-our-motherland',
    },
  },
]

// "www.redcross.lk" -> "redcross.lk". This is what is shown under each button so people can see
// where it goes. An address that can't be read gives an empty text.
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// True only for an https address on exactly this domain (or www. in front of it): no other host,
// no sub-domain of a look-alike, no login part in the address and no odd port.
export function isOwnDomain(url: string, domain: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' &&
      u.username === '' &&
      u.password === '' &&
      u.port === '' &&
      (u.hostname === domain || u.hostname === `www.${domain}`)
    )
  } catch {
    return false
  }
}

// The links of one organisation that really are on its own website. The screen draws only these,
// so a bad edit to the list can't turn into a button.
export function safeLinks(org: HelpOrganisation): HelpLink[] {
  return org.links.filter((link) => isOwnDomain(link.url, org.domain))
}
