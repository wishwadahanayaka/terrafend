import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NEWS_FOR_EVERYONE, newsEnabled, newsEnabledWith } from './newsFlag'

const SRC = join(__dirname, '..')
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8')

function sourceFiles(dir: string): { name: string; code: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [{ name: entry.name, code: readFileSync(full, 'utf8') }] : []
  })
}

describe('who sees the news feed', () => {
  it('is on for everyone now', () => {
    expect(NEWS_FOR_EVERYONE).toBe(true)
    for (const search of ['', '?news=0', '?fakeRouting=1', '?news=1']) expect(newsEnabled(search), search).toBe(true)
  })

  it('goes back to only people with ?news=1 in the address when the setting is false', () => {
    expect(newsEnabledWith(false, '?news=1')).toBe(true)
    expect(newsEnabledWith(false, '?fakeRouting=1&news=1&x=2')).toBe(true)
    expect(newsEnabledWith(false, '')).toBe(false)
    expect(newsEnabledWith(false, '?news=0')).toBe(false)
    expect(newsEnabledWith(false, '?news')).toBe(false)
    expect(newsEnabledWith(false, '?news=true')).toBe(false)
    expect(newsEnabledWith(false, '?fakeNews=all')).toBe(false)
    expect(newsEnabledWith(false, '?notnews=1')).toBe(false)
  })

  it('is a one-line change either way', () => {
    const file = read('lib', 'newsFlag.ts')
    expect(file.split('\n').filter((l) => /^export const NEWS_FOR_EVERYONE = (true|false)$/.test(l))).toHaveLength(1)
    // and the only other place the name is used is where the setting is handed to the rule
    expect(file.match(/NEWS_FOR_EVERYONE/g)?.length).toBe(2)
    expect(file).toContain('newsEnabledWith(NEWS_FOR_EVERYONE, search)')
  })

  it('keeps ?fakeNews= for the dev server only', () => {
    const fetcher = read('lib', 'newsFetch.ts')
    expect(fetcher).toMatch(/import\.meta\.env\.DEV[\s\S]*fakeNews/)
  })

  it('works in the production build: it does not depend on the dev server', () => {
    expect(read('lib', 'newsFlag.ts')).not.toMatch(/import\.meta\.env/)
  })

  it('is decided in one place: no other file reads the news switch from the address', () => {
    for (const { name, code } of sourceFiles(SRC)) {
      if (name === 'newsFlag.ts') continue
      expect(code, name).not.toMatch(/get\(\s*['"]news['"]\s*\)/)
    }
  })

  describe('where it shows', () => {
    const chip = read('components', 'ThreatChip.tsx')
    const layers = read('components', 'LayerControls.tsx')
    const map = read('components', 'HazardMap.tsx')

    it('the chip part is only drawn for people who have it, and only asks for the news then', () => {
      expect(chip).toContain("import { newsEnabled } from '../lib/newsFlag'")
      expect(chip).toMatch(/const \[newsOn\] = useState\(newsEnabled\)/)
      expect(chip).toContain('useNewsChip(newsOn)')
      expect(chip).toMatch(/\{news && <NewsPill/)
    })

    it('the Layers entry is only drawn for people who have it', () => {
      expect(layers).toMatch(/const \[newsOn\] = useState\(newsEnabled\)/)
      expect(layers).toMatch(/\{newsOn && \(\s*<Suspense fallback=\{null\}>\s*<NewsEntry onOpen=\{showNews\} \/>/)
    })

    it('asks for nothing when it is off: the query is disabled, so nothing is requested', () => {
      const hook = read('lib', 'useNewsChip.ts')
      expect(hook).toContain('useNews(false, enabled)')
      expect(read('lib', 'useNews.ts')).toContain('enabled,')
      expect(hook).toMatch(/return enabled \? state : null/)
    })

    it('the news screens and data code load later, so the main download only carries the flag check', () => {
      expect(layers).toContain("const NewsEntry = lazy(() => import('./NewsEntry'))")
      expect(map).toContain("const NewsSheet = lazy(() => import('./NewsSheet'))")
      // nothing imports the news code from the files that load first
      for (const [name, file] of [['LayerControls', layers], ['HazardMap', map]] as const) {
        expect(file, name).not.toMatch(/from '\.\.\/lib\/(news|useNews|newsFetch|fakeNews)'/)
        expect(file, name).not.toMatch(/from '\.\/(NewsSheet|NewsEntry)'/)
      }
      expect(read('lib', 'layerSettings.ts')).not.toMatch(/from '\.\/news'/)
    })

    it('the sheet opens from both entry points through one function in the map', () => {
      expect(map).toContain('onOpenNews={() => setNewsOpen(true)}')
      expect(map).toMatch(/\{newsOpen && \(\s*<Suspense fallback=\{null\}>/)
      expect(layers).toContain('onOpenNews={showNews}')
      expect(chip).toContain('onClick={onOpenNews}')
    })

    it('opening it closes the Layers panel and any open map card first', () => {
      expect(layers).toMatch(/function showNews\(\) \{\s+map\?\.closePopup\(\)\s+setOpen\('none'\)\s+onOpenNews\(\)/)
    })
  })
})
