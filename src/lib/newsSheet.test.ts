import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en'

// The news sheet is a React component and there is no React testing library here, so these read the
// source for the things that must stay true. The same things were also checked by hand in a browser
// (see CLAUDE.md): the sheet, its states, both entry points, and 320 px in all three languages.

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8')
const sheet = read('components', 'NewsSheet.tsx')
const entry = read('components', 'NewsEntry.tsx')

describe('links', () => {
  it('open in a new tab with noopener noreferrer, all through one setting', () => {
    expect(sheet).toContain("const linkProps = { target: '_blank', rel: 'noopener noreferrer' } as const")
    const anchors = sheet.match(/<a\b/g)?.length ?? 0
    expect(anchors).toBeGreaterThanOrEqual(2)
    expect(sheet.match(/\{\.\.\.linkProps\}/g)?.length).toBe(anchors)
  })

  it('go only where a row says, and a row was already checked against its source’s own site', () => {
    expect(sheet).toContain('href={item.url}')
    expect(sheet).toContain('href={main.url}')
    // nothing opens a window or builds a link some other way
    expect(sheet).not.toMatch(/window\.open|location\.href|dangerouslySetInnerHTML|<img|<iframe/)
    expect(entry).not.toMatch(/<a\b|window\.open|dangerouslySetInnerHTML/)
  })

  it('say that they open in a new tab, for screen readers', () => {
    expect(sheet.match(/news\.newTab/g)?.length).toBe(2)
  })
})

describe('what is on the sheet', () => {
  it('has the official block before the news reports', () => {
    expect(sheet.indexOf("t('news.officialHeading')")).toBeGreaterThan(-1)
    expect(sheet.indexOf("t('news.officialHeading')")).toBeLessThan(sheet.indexOf("t('news.reportsHeading')"))
  })

  it('draws an official notice with a blue border, a shield, who it is from, and when it was issued', () => {
    const official = sheet.slice(sheet.indexOf('function OfficialItem'), sheet.indexOf('function StoryItem'))
    expect(official).toContain('border-blue-600')
    expect(official).toContain('<ShieldCheck')
    expect(official).toContain("t('news.officialFrom', { source: sourceName(item.source) })")
    expect(official).toContain("t('news.issued'")
    // fixed channels are named in the person’s language; the grey "not official" line is not on them
    expect(official).toContain('channelName(item.channel)')
    expect(official).not.toContain('news.notOfficial')
  })

  it('greys a notice that is past its 24 hours and says so, in words and not only in colour', () => {
    const official = sheet.slice(sheet.indexOf('function OfficialItem'), sheet.indexOf('function StoryItem'))
    expect(official).toContain('officialAge(item, now)')
    expect(official).toContain('border-slate-300 bg-slate-100')
    expect(official).toContain("t('news.issuedMaybeExpired', { when })")
    expect(official).toContain("t('news.issuedOlder', { when })")
  })

  it('draws a news report with its headline in its own language, a language label, the source, the time ago and the grey line', () => {
    const story = sheet.slice(sheet.indexOf('function StoryItem'))
    expect(story).toContain('lang={main.language}')
    expect(story).toContain('language.short')
    expect(story).toContain('sourceName(main.source)')
    expect(story).toContain('timeAgo(')
    expect(story).toContain("t('news.notOfficial')")
    expect(story).toContain("t('news.also'")
  })

  it('has the language filter with All and the three languages, each labelled for its own language', () => {
    expect(sheet).toContain("const FILTERS: NewsFilter[] = ['all', 'en', 'si', 'ta']")
    expect(sheet).toContain('role="radiogroup"')
    expect(sheet).toContain('lang={language?.code}')
    expect(sheet).toContain('saveNewsFilter(next)')
    expect(sheet).toContain('useState<NewsFilter>(loadNewsFilter)')
  })

  it('has "Show N more" for each hazard, and a way back', () => {
    expect(sheet).toContain("t('news.showMore', { count: group.more.length })")
    expect(sheet).toContain("t('news.showLess')")
    expect(sheet).toContain('aria-expanded={open}')
  })

  it('shows the time it was loaded', () => {
    expect(sheet).toContain("t('news.updated', { when: loadedAt })")
  })
})

describe('the states', () => {
  it('says so when it is offline, with the time the headlines were saved', () => {
    expect(sheet).toMatch(/items && loadedAt && !online[\s\S]*?news\.offlineSaved/)
    expect(sheet).toMatch(/!items && !online[\s\S]*?news\.offlineNone/)
  })

  it('says so when a refresh failed but headlines are on hand', () => {
    expect(sheet).toMatch(/items && loadedAt && online && query\.isError[\s\S]*?news\.refreshFailed/)
  })

  it('says "unavailable" with Try again when the load failed and nothing is saved', () => {
    expect(sheet).toContain("t('news.unavailable')")
    expect(sheet).toContain('onClick={() => query.refetch()}')
    expect(sheet).toContain("t('common.tryAgain')")
  })

  it('knows a load has failed by errorUpdatedAt, so the message does not flip to "Loading" on each retry', () => {
    expect(sheet).toContain('const failed = !items && query.errorUpdatedAt > 0')
    expect(sheet).toContain('!failed && query.isPending')
    // and Try again can't be pressed while it is already trying
    expect(sheet).toContain('disabled={query.isFetching}')
  })

  it('says there is nothing when there is nothing, and which kind of nothing', () => {
    expect(sheet).toContain("t('news.empty')")
    expect(sheet).toContain("filter === 'all' ? t('news.emptyReports') : t('news.emptyLanguage')")
  })
})

describe('the footer', () => {
  it('has the two sentences and a link to the emergency numbers, outside the part that depends on the data', () => {
    const footer = sheet.slice(sheet.indexOf('<footer'), sheet.indexOf('</footer>'))
    expect(footer).toContain("t('news.footerAuto')")
    expect(footer).toContain("t('news.footerOfficial')")
    expect(footer).toContain('onClick={onOpenEmergency}')
    expect(footer).toContain("t('emergency.button')")
    // after the end of the conditional block, so it shows while loading, offline, empty and failed too
    const beforeFooter = sheet.slice(0, sheet.indexOf('<footer'))
    const opens = (beforeFooter.match(/\{grouped && \(/g) ?? []).length
    expect(opens).toBe(1)
    expect(beforeFooter.slice(beforeFooter.indexOf('{grouped && (')).trimEnd().endsWith(')}')).toBe(true)
  })

  it('opens the emergency numbers on top of the sheet, and Escape closes only the top one', () => {
    expect(read('components', 'EmergencyPanel.tsx')).toContain('z-[1300]')
    expect(sheet).toContain('z-[1100]')
    expect(sheet).toContain("!document.querySelector('[aria-modal=\"true\"]')")
    expect(read('components', 'EmergencyPanel.tsx')).toContain('aria-modal="true"')
  })
})

describe('how often it asks', () => {
  it('the sheet asks every 5 minutes while open, and the chip and Layers entry every 10', () => {
    expect(sheet).toContain('useNews(true)')
    expect(read('lib', 'useNewsChip.ts')).toContain('useNews(false, enabled)')
  })
})

describe('the words', () => {
  const news = en.news

  it('are as agreed in English', () => {
    expect(news.title).toBe('Disaster news')
    expect(news.chipCount).toBe('News {{count}}')
    expect(news.layersEntryCount).toBe('Disaster news ({{count}})')
    expect(news.notOfficial).toBe('News report, not an official warning')
    expect(news.footerAuto).toBe('Headlines are picked automatically by keywords, so some may be unrelated and some may be missed.')
    expect(news.footerOfficial).toBe('Not an official warning. Follow DMC for official alerts.')
    expect(news.officialFrom).toBe('Official: {{source}}')
    expect(news.empty).toBe('No disaster news in the last 2 days.')
    expect(news.unavailable).toBe('News unavailable right now')
    expect(news.offlineSaved).toBe('Offline: showing headlines saved at {{when}}.')
    expect(news.issuedMaybeExpired).toBe('Issued {{when}} · may no longer be valid')
    expect(news.issuedOlder).toBe('Issued {{when}} · older report')
    expect(news.showMore_other).toBe('Show {{count}} more')
  })

  it('never say "expect" (it would sound like a forecast)', () => {
    expect(JSON.stringify(news)).not.toMatch(/expect/i)
  })

  it('are marked for a native speaker to review in Sinhala and Tamil', () => {
    for (const file of ['si.ts', 'ta.ts']) {
      expect(read('i18n', 'locales', file)).toContain('NEEDS REVIEW BY A NATIVE SPEAKER: the disaster news sheet and its chip part')
    }
  })
})
