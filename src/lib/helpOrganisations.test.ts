import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en'
import si from '../i18n/locales/si'
import ta from '../i18n/locales/ta'
import {
  domainOf,
  HELP_LAST_CHECKED,
  HELP_ORGANISATIONS,
  isOwnDomain,
  safeLinks,
  type HelpOrganisation,
} from './helpOrganisations'
import { dayMonthYear } from './time'

type Tree = { [key: string]: string | Tree }
function lookup(tree: Tree, path: string): string | undefined {
  let node: string | Tree | undefined = tree
  for (const part of path.split('.')) node = typeof node === 'object' ? node[part] : undefined
  return typeof node === 'string' ? node : undefined
}
// Every text under one key, e.g. all of "help"
function texts(tree: Tree, path: string): string[] {
  let node: string | Tree | undefined = tree
  for (const part of path.split('.')) node = typeof node === 'object' ? node[part] : undefined
  const out: string[] = []
  const walk = (n: string | Tree | undefined) => {
    if (typeof n === 'string') out.push(n)
    else if (n) Object.values(n).forEach(walk)
  }
  walk(node)
  return out
}

const languages = [['en', en], ['si', si], ['ta', ta]] as const
const ALLOWED_DOMAINS = ['redcross.lk', 'sarvodaya.org', 'cbsl.gov.lk']
const allUrls = HELP_ORGANISATIONS.flatMap((o) => [...o.links.map((l) => l.url), o.source.url])

describe('the organisations', () => {
  it('are exactly the three that were asked for, in this order', () => {
    expect(HELP_ORGANISATIONS.map((o) => o.id)).toEqual(['red-cross', 'sarvodaya', 'rebuilding-sri-lanka-fund'])
  })

  it('have exactly these links, and no others', () => {
    const links = Object.fromEntries(HELP_ORGANISATIONS.map((o) => [o.id, o.links.map((l) => `${l.kind} ${l.url}`)]))
    expect(links).toEqual({
      'red-cross': ['donate https://www.redcross.lk/', 'volunteer https://www.redcross.lk/volunteers/'],
      sarvodaya: ['donate https://www.sarvodaya.org/donations/', 'volunteer https://www.sarvodaya.org/volunteering/'],
      'rebuilding-sri-lanka-fund': [
        'official https://www.cbsl.gov.lk/en/faq/let-us-unite-and-donate-to-help-our-motherland',
      ],
    })
  })

  it('only the Rebuilding Sri Lanka Fund has no volunteer link', () => {
    for (const org of HELP_ORGANISATIONS) {
      const hasVolunteer = org.links.some((l) => l.kind === 'volunteer')
      expect(hasVolunteer, org.id).toBe(org.id !== 'rebuilding-sri-lanka-fund')
    }
  })

  it('has a unique id for each', () => {
    const ids = HELP_ORGANISATIONS.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the links', () => {
  it('are all https', () => {
    for (const url of allUrls) expect(url).toMatch(/^https:\/\//)
  })

  it('are each on the organisation\'s own domain, and only redcross.lk, sarvodaya.org and cbsl.gov.lk are used', () => {
    expect(HELP_ORGANISATIONS.map((o) => o.domain).sort()).toEqual([...ALLOWED_DOMAINS].sort())
    for (const org of HELP_ORGANISATIONS) {
      for (const link of org.links) expect(isOwnDomain(link.url, org.domain), `${org.id} ${link.url}`).toBe(true)
      expect(isOwnDomain(org.source.url, org.domain), `${org.id} source`).toBe(true)
    }
    expect(new Set(allUrls.map(domainOf))).toEqual(new Set(ALLOWED_DOMAINS))
  })

  it('go to no third-party donation platform', () => {
    const platforms =
      /gofundme|justgiving|paypal|patreon|ko-fi|kofi|buymeacoffee|donorbox|stripe|razorpay|payhere|crowdfund|chuffed|givegab|facebook|whatsapp|bit\.ly|tinyurl|t\.co\b/i
    for (const url of allUrls) expect(url, url).not.toMatch(platforms)
  })

  it('carry no login part, port, query string or fragment', () => {
    for (const url of allUrls) {
      const u = new URL(url)
      expect([u.username, u.password, u.port, u.search, u.hash], url).toEqual(['', '', '', '', ''])
    }
  })

  it('show the domain under each button, without www.', () => {
    expect(domainOf('https://www.redcross.lk/volunteers/')).toBe('redcross.lk')
    expect(domainOf('https://www.sarvodaya.org/donations/')).toBe('sarvodaya.org')
    expect(domainOf('https://www.cbsl.gov.lk/en/faq/x')).toBe('cbsl.gov.lk')
    expect(domainOf('not a web address')).toBe('')
  })
})

describe('isOwnDomain', () => {
  it('accepts the domain and www. in front of it', () => {
    expect(isOwnDomain('https://redcross.lk/', 'redcross.lk')).toBe(true)
    expect(isOwnDomain('https://www.redcross.lk/volunteers/', 'redcross.lk')).toBe(true)
  })

  it('refuses look-alikes, other sub-domains, other schemes and tricks', () => {
    for (const url of [
      'http://www.redcross.lk/',
      'https://redcross.lk.evil.com/',
      'https://evilredcross.lk/',
      'https://redcross.lk@evil.com/',
      'https://user:pass@redcross.lk/',
      'https://redcross.lk:8443/',
      'https://donate.redcross.lk/',
      'https://www.redcross.org/',
      'https://xn--redcross-lk.com/',
      'javascript:alert(1)',
      'tel:117',
      '',
    ]) {
      expect(isOwnDomain(url, 'redcross.lk'), url).toBe(false)
    }
  })

  it('does not accept one organisation\'s domain for another', () => {
    expect(isOwnDomain('https://www.sarvodaya.org/donations/', 'redcross.lk')).toBe(false)
  })
})

describe('safeLinks', () => {
  const org: HelpOrganisation = {
    ...HELP_ORGANISATIONS[0],
    links: [
      { kind: 'donate', url: 'https://www.redcross.lk/' },
      { kind: 'volunteer', url: 'https://redcross.lk.evil.com/volunteers/' },
    ],
  }

  it('drops a link that is not on the organisation\'s own site, so it never becomes a button', () => {
    expect(safeLinks(org).map((l) => l.kind)).toEqual(['donate'])
  })

  it('keeps every real link as it is', () => {
    for (const real of HELP_ORGANISATIONS) expect(safeLinks(real)).toEqual(real.links)
  })
})

describe('the last-checked date', () => {
  it('is 15 Nov 2026', () => {
    expect(HELP_LAST_CHECKED).toBe('2026-11-15')
    expect(dayMonthYear(HELP_LAST_CHECKED)).toBe('15 Nov 2026')
  })
})

describe('the words', () => {
  it('give every organisation a name and a line in English, Sinhala and Tamil', () => {
    for (const org of HELP_ORGANISATIONS) {
      for (const [lang, tree] of languages) {
        expect(lookup(tree as unknown as Tree, org.nameKey), `${org.id} name in ${lang}`).toBeTruthy()
        expect(lookup(tree as unknown as Tree, org.whatKey), `${org.id} line in ${lang}`).toBeTruthy()
        if (org.noteKey) expect(lookup(tree as unknown as Tree, org.noteKey), `${org.id} note in ${lang}`).toBeTruthy()
      }
    }
  })

  it('give every kind of button a label in every language', () => {
    const kinds = new Set(HELP_ORGANISATIONS.flatMap((o) => o.links.map((l) => l.kind)))
    for (const kind of kinds) {
      for (const [lang, tree] of languages) {
        expect(lookup(tree as unknown as Tree, `help.${kind}`), `${kind} in ${lang}`).toBeTruthy()
      }
    }
  })

  it('use the names people know', () => {
    expect(en.help.org.redCross.name).toBe('Sri Lanka Red Cross Society')
    expect(si.help.org.redCross.name).toBe('ශ්‍රී ලංකා රතු කුරුස සංගමය')
    expect(si.help.org.sarvodaya.name).toBe('සර්වෝදය')
    expect(en.help.org.sarvodaya.name).toBe('Sarvodaya')
    expect(en.help.org.rebuilding.name).toBe('Rebuilding Sri Lanka Fund')
  })

  it('say what was asked on the screen, in English', () => {
    expect(en.help.safety).toBe(
      "Only give through an organisation's own website. Never send money to bank accounts shared on WhatsApp, Facebook or by phone. TerraFend never asks for money.",
    )
    expect(en.help.offline).toBe("You're offline. The links will work once you're back online.")
    expect(en.help.org.rebuilding.note).toBe('Set up after Cyclone Ditwah. Check the page for whether it is still open.')
    expect(en.help.donate).toBe('Donate on their website')
    expect(en.help.volunteer).toBe('Volunteer')
    expect(en.help.lastChecked).toBe('Links last checked: {{date}}')
  })

  it('say the safety text and the offline note in every language', () => {
    for (const [lang, tree] of languages) {
      expect(lookup(tree as unknown as Tree, 'help.safety'), lang).toMatch(/WhatsApp/)
      expect(lookup(tree as unknown as Tree, 'help.safety'), lang).toMatch(/TerraFend/)
      expect(lookup(tree as unknown as Tree, 'help.offline'), lang).toBeTruthy()
    }
  })
})

describe('nothing that looks like a way to pay, anywhere', () => {
  // A run of digits long enough to be an account or card number, with or without spaces and dashes
  const accountLike = /\d{6,}|(?:\d[ -]?){9,}/
  const data = JSON.stringify(HELP_ORGANISATIONS)

  it('has no bank-account-like digits in the data', () => {
    expect(data).not.toMatch(accountLike)
  })

  it('has no bank-account-like digits in the words, in any language', () => {
    for (const [lang, tree] of languages) {
      for (const text of texts(tree as unknown as Tree, 'help')) expect(text, lang).not.toMatch(accountLike)
    }
  })

  it('catches what it is meant to catch', () => {
    expect(accountLike.test('Account 1234567890')).toBe(true)
    expect(accountLike.test('1234 5678 9012')).toBe(true)
    expect(accountLike.test('1234-5678-9012')).toBe(true)
    expect(accountLike.test('15 Nov 2026')).toBe(false)
    expect(accountLike.test('Call 117 or 119')).toBe(false)
  })

  it('has no account, card or QR wording in the data or the help words', () => {
    const wording = /\biban\b|swift|account\s*(no|number)|a\/c|\bqr\b|card number|\bcvv\b/i
    expect(data).not.toMatch(wording)
    for (const [lang, tree] of languages) {
      for (const text of texts(tree as unknown as Tree, 'help')) expect(text, lang).not.toMatch(wording)
    }
  })

  it('has no payment or QR library installed, and no form or payment code in the app', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const installed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(installed.filter((name) => /qr|stripe|paypal|payment|checkout|payhere/i.test(name))).toEqual([])

    function sourceFiles(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sourceFiles(path)
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
      })
    }
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/<form\b|\bqrcode\b|\bstripe\b|\bpaypal\b|payhere/i)
    }
  })
})

describe('the screen', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8').replace(/\r\n/g, '\n')
  const panel = read('components', 'HelpPanel.tsx')

  it('opens every link in a new tab with rel="noopener noreferrer"', () => {
    expect(panel).toContain('target="_blank"')
    expect(panel).toContain('rel="noopener noreferrer"')
    expect(panel.match(/<a\b/g)?.length).toBe(1)
  })

  it('shows the safety box without any condition, and only the offline note depends on being online', () => {
    expect(panel).toMatch(/\{t\('help\.safety'\)\}/)
    expect(panel).not.toMatch(/online && *\n? *<div[^>]*>\s*<ShieldAlert/)
    expect(panel).toContain('{!online && (')
    // The buttons still show offline: nothing turns a link off
    expect(panel).not.toMatch(/disabled|aria-disabled|pointer-events-none/)
  })

  it('is reached from the legend panel and the emergency numbers screen, not from the toolbar or the banner', () => {
    expect(read('components', 'LayerControls.tsx')).toContain("t('help.button')")
    expect(read('components', 'EmergencyPanel.tsx')).toContain("t('help.fromEmergency')")
    expect(read('components', 'Banner.tsx')).not.toMatch(/help/i)
  })
})
