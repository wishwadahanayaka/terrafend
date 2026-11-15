import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../i18n/locales/en'
import { readFakeRainMap } from './fakeRainMap'

// The screens can't be drawn in these tests, so these read the source for the wiring that matters
// (which view gets which markers, what a tap on the chip does) and check the words.

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8').replace(/\r\n/g, '\n')

type Tree = { [key: string]: string | Tree }
function texts(tree: Tree): string[] {
  return Object.values(tree).flatMap((v) => (typeof v === 'string' ? [v] : texts(v)))
}

describe('the Past / Next view in the screens', () => {
  const map = read('components', 'HazardMap.tsx')

  it('is remembered, and starts from what was saved', () => {
    expect(map).toContain('useState(loadRainView)')
    expect(map).toContain('saveRainView(view)')
  })

  it('draws the squares of the chosen view only', () => {
    expect(map).toMatch(/<RainMapOverlay[^>]*view=\{rainView\}/)
    expect(read('components', 'RainMapOverlay.tsx')).toContain('squaresOf(useRainSquares(), view)')
  })

  it('shows light and moderate gauge badges in the past view only, and heavy ones in both', () => {
    expect(map).toContain("<MeasuredRainMarkers showMild={layers.mildRain && rainView === 'past'} />")
    // Heavy and above is shown whatever showMild says
    expect(read('components', 'MeasuredRainMarkers.tsx')).toContain('data.gauges.filter((g) => g.level || (showMild && g.mild))')
  })

  it('has a map label that flips the view', () => {
    expect(map).toContain('<RainViewLabel')
    expect(read('components', 'RainViewLabel.tsx')).toContain('onChange(otherView(view))')
  })

  it('closes a rain card when the view changes, so a card never outlives its view', () => {
    expect(read('components', 'RainMapOverlay.tsx')).toMatch(/if \(shownView !== view\) \{\s*setShownView\(view\)\s*setSelected\(null\)/)
  })

  it('shows the count of serious items on the half of the switch that is not showing', () => {
    const source = read('components', 'RainViewSwitch.tsx')
    expect(source).toContain('selected ? 0 : counts[value]')
    expect(source).toContain('role="radiogroup"')
    expect(source).toContain('aria-checked={selected}')
  })

  it('puts the switch under the Rain toggle, with the hint while the Rain switch is off', () => {
    const layers = read('components', 'LayerControls.tsx')
    expect(layers).toMatch(/!settings\.mildRain && \(\s*<p[^>]*>\s*\{t\('layers\.rainOffHint'\)\}/)
    expect(layers.indexOf("t('layers.rainOffHint')")).toBeLessThan(layers.indexOf('<RainViewSwitch'))
    expect(layers.indexOf("onChange('mildRain'")).toBeLessThan(layers.indexOf('<RainViewSwitch'))
  })

  it('explains in the legend that measured and forecast rain cover different times', () => {
    const layers = read('components', 'LayerControls.tsx')
    expect(layers).toContain("t('legend.rainTimes')")
    expect(layers).toContain("t('legend.satelliteLight'")
  })

  it('tags every rain card as MEASURED or FORECAST with its time window', () => {
    const overlay = read('components', 'RainMapOverlay.tsx')
    expect(overlay).toContain("t(satellite ? 'rain.mapCard.tagMeasured' : 'rain.mapCard.tagForecast')")
    expect(overlay).toContain('square.windowFrom')
    expect(overlay).toContain('square.windowTo')
  })
})

describe('the threats chip', () => {
  const threats = read('lib', 'useThreats.ts')
  const chip = read('components', 'ThreatChip.tsx')

  it('counts the forecast and the measured rain as separate parts, each with its view', () => {
    expect(threats).toMatch(/chip\.storm[^\n]*view: 'next'/)
    expect(threats).toMatch(/chip\.heavy'[^\n]*view: 'next'/)
    expect(threats).toMatch(/chip\.heavyMeasured[^\n]*view: 'past'/)
    expect(threats).toMatch(/view: 'past',\s*\}\)/)
  })

  it('counts both sets when it works out where to zoom', () => {
    expect(threats).toContain('const areas = [...pastAreas, ...nextAreas]')
  })

  it('switches the map to the part\'s view when a rain part is tapped, then zooms as before', () => {
    expect(chip).toMatch(/if \(part\.view\) onRainView\(part\.view\)\s*showThreats\(\)/)
  })

  it('gets the switch from the Layers controls', () => {
    expect(read('components', 'LayerControls.tsx')).toContain('onRainView={onRainView}')
  })
})

describe('the new English words', () => {
  const groups = ['rain', 'chip', 'legend', 'layers', 'rainView'] as const

  it('never say a forecast is "expected"', () => {
    for (const group of groups) {
      for (const text of texts(en[group] as unknown as Tree)) expect(text, group).not.toMatch(/\bexpect/i)
    }
  })

  it('say "likely" for forecast parts and "measured" for measured ones', () => {
    expect(en.chip.storm_other).toContain('likely')
    expect(en.chip.heavy_other).toContain('likely')
    expect(en.chip.heavyMeasured_other).toContain('measured')
    expect(en.chip.gauge_other).toContain('measured')
  })

  it('name the two views and the two tags', () => {
    expect(en.rainView.past).toBe('Past 3 h')
    expect(en.rainView.pastKind).toBe('measured')
    expect(en.rainView.next).toBe('Next 3 h')
    expect(en.rainView.nextKind).toBe('forecast')
    expect(en.rain.mapCard.tagMeasured).toBe('MEASURED')
    expect(en.rain.mapCard.tagForecast).toBe('FORECAST')
    expect(en.rainView.serious).toBe('{{count}} serious')
  })

  it('tell the person light and moderate rain are hidden while the Rain switch is off', () => {
    expect(en.layers.rainOffHint).toMatch(/light and moderate rain are hidden/i)
    expect(en.layers.rainOffHint).toMatch(/switch rain on/i)
  })

  it('explain that measured and forecast rain cover different times', () => {
    expect(en.legend.rainTimes).toMatch(/past 3 hours/)
    expect(en.legend.rainTimes).toMatch(/next 3 hours/)
    expect(en.legend.rainTimes).toMatch(/won’t always match/)
  })

  it('no longer say a square is the worse of two things', () => {
    expect(en.legend.rainNote).not.toMatch(/worse of two/i)
  })
})

describe('the dev fakes for the light-rain rule', () => {
  afterEach(() => vi.unstubAllGlobals())

  function withSearch(search: string) {
    vi.stubGlobal('window', { location: { search } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  }

  it('sat-lightlone is a lone light satellite cell', () => {
    withSearch('?fakeRainMap=sat-lightlone:galle')
    const [fake] = readFakeRainMap('satellite')
    expect(fake.fake).toMatchObject({ lone: true, mild: 'light', mm: 1 })
    expect(fake.spot).not.toBeNull()
    expect(readFakeRainMap('forecast')).toEqual([])
    expect(readFakeRainMap('gauge')).toEqual([])
  })

  it('gauge-dry is a gauge that measured exactly 0 mm', () => {
    withSearch('?fakeRainMap=gauge-dry:galle')
    const [fake] = readFakeRainMap('gauge')
    expect(fake.fake).toMatchObject({ mm: 0, level: null, mild: null })
  })

  it('refuses the lone fake for the forecast and for gauges, and dry for the satellite and forecast', () => {
    withSearch('?fakeRainMap=lightlone:galle,gauge-lightlone:galle,sat-dry:galle,dry:galle')
    expect(readFakeRainMap('forecast')).toEqual([])
    expect(readFakeRainMap('satellite')).toEqual([])
    expect(readFakeRainMap('gauge')).toEqual([])
  })

  it('still reads the older fakes', () => {
    withSearch('?fakeRainMap=thunder:kandy,sat-heavy:jaffna,gauge-light:galle')
    expect(readFakeRainMap('forecast')).toHaveLength(1)
    expect(readFakeRainMap('satellite')).toHaveLength(1)
    expect(readFakeRainMap('gauge')).toHaveLength(1)
  })
})
