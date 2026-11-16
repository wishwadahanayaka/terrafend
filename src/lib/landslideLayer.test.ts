import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en'
import { sourceOf } from './offline'

// How the landslide layer is wired into the map, the Layers panel and the chip. The components can't be
// drawn here, so these read their source, like newsSheet.test.ts does.

const ROOT = join(__dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')
const layer = read('src', 'components', 'LandslideLayer.tsx')
const controls = read('src', 'components', 'LayerControls.tsx')
const map = read('src', 'components', 'HazardMap.tsx')
const rain = read('src', 'components', 'RainMapOverlay.tsx')
const threats = read('src', 'lib', 'useThreats.ts')
const chip = read('src', 'components', 'ThreatChip.tsx')

describe('the map layer', () => {
  it('sits in a pane below the rain squares, and so below every marker', () => {
    const pane = Number(/<Pane name="landslide-areas" style=\{\{ zIndex: (\d+) \}\}>/.exec(layer)?.[1])
    const rainPanes = [...rain.matchAll(/<Pane name="rain-[a-z]+" style=\{\{ zIndex: (\d+)/g)].map((m) => Number(m[1]))
    expect(rainPanes).toEqual([380, 390])
    expect(pane).toBeLessThan(Math.min(...rainPanes))
    // above the map's tiles (200) and below Leaflet's own markers (600)
    expect(pane).toBeGreaterThan(200)
    expect(pane).toBeLessThan(600)
  })

  it('draws a fill and an outline from the one style function, lowest level first', () => {
    expect(layer).toContain('pathOptions={areaStyle(d.area.level)}')
    expect(layer).toContain('placeAreas(warning.areas, shapes.data)')
  })

  it('opens one card at a time: a single card for the selected area, closing when its area goes', () => {
    expect(layer.match(/<Popup/g)).toHaveLength(1)
    expect(layer).toContain('pane="popupPane"')
    expect(layer).toContain('drawn.find((d) => d.area.code === selected.code)')
    // Leaflet itself closes one card when another opens, and the Layers panel closes when a card opens
    expect(controls).toContain("map.on('popupopen', close)")
  })

  it('has an Emergency link on the card that closes it and opens the emergency numbers screen', () => {
    expect(layer).toMatch(/onOpenEmergency=\{\(\) => \{\s*map\.closePopup\(\)\s*onOpenEmergency\(\)\s*\}\}/)
    expect(layer).toContain("t('landslide.follow')")
    expect(layer).toContain("t('landslide.emergency')")
    expect(map).toContain('onOpenEmergency={onOpenEmergency}')
    expect(en.landslide.emergency).toBe('Emergency: 117')
    expect(en.landslide.follow).toBe('Follow official instructions.')
  })

  it('links the PDF from the card only through the checked link, opening in a new tab', () => {
    expect(layer).toContain('card.pdfUrl &&')
    expect(layer).toMatch(/href=\{card\.pdfUrl\} target="_blank" rel="noopener noreferrer"/)
    expect(layer).not.toMatch(/warning\.pdfUrl/)
  })

  it('has no advice of its own on the card beyond following official instructions', () => {
    const card = layer.slice(layer.indexOf('function LandslideCard'))
    const keys = [...card.matchAll(/t\('(landslide\.[a-zA-Z.]+)'\)/g)].map((m) => m[1]).sort()
    expect(keys).toEqual(['landslide.emergency', 'landslide.follow', 'landslide.openPdf', 'landslide.title'])
  })

  it('credits the boundaries in the map’s corner while the areas are drawn, and takes it away after', () => {
    expect(layer).toContain('map.attributionControl.addAttribution(MAP_ATTRIBUTION)')
    expect(layer).toContain('map.attributionControl.removeAttribution(MAP_ATTRIBUTION)')
    expect(layer).toMatch(/if \(drawn\.length === 0\) return\s+map\.attributionControl/)
  })

  it('is hidden while a spot is being picked for a report, like the other layers', () => {
    expect(map).toContain('hidden={picking}')
    expect(layer).toContain('!hidden && placed ? placed.drawn.filter')
  })

  it('always draws Level 2 and 3 while the warning is valid, and the switch only adds Level 1', () => {
    expect(layer).toContain('placed.drawn.filter((d) => isDrawnLevel(d.area.level, enabled))')
    // the switch is not a condition for drawing anything else
    expect(layer).not.toMatch(/enabled &&/)
    expect(layer).not.toMatch(/if \(!enabled\)/)
  })

  it('asks for the outlines only when there is something to draw: a Level 2 or 3 area, or a Level 1 area with the switch on', () => {
    expect(layer).toContain('const wanted = warning !== null && areasToDraw(warning.areas, enabled).length > 0')
    expect(layer).toContain('useLandslideShapes(wanted)')
  })

  it('shows its small legend only while areas are drawn, with only the levels drawn, bottom left above the rain label', () => {
    expect(map).toMatch(/!picking && panel !== 'open' && landslideLevels\.length > 0 &&/)
    expect(map).toContain('onShown={setLandslideLevels}')
    expect(map).toContain('levels={landslideLevels}')
    expect(layer).toMatch(/onShown\(\[\.\.\.levelsKey\]\.map\(Number\) as Level\[\]\)\s+return \(\) => onShown\(\[\]\)/)
    expect(layer).toContain('[...new Set(drawn.map((d) => d.area.level))].sort((a, b) => b - a)')
    const legend = read('src', 'components', 'LandslideLegend.tsx')
    expect(legend).toContain('{levels.map((level) => (')
    expect(legend).not.toMatch(/\[3, 2, 1\]/)
  })
})

describe('the Layers panel', () => {
  it('describes the switch in the style of the others: what always shows, and what the switch adds', () => {
    expect(en.layers.landslidesHint).toBe('Alert and Evacuate areas always show. Switch on to add Watch areas.')
    expect(en.layers.rainHint).toBe('Heavy rain and thunderstorms always show. Switch on to add light and moderate rain.')
    expect(en.layers.landslideOffHint).toBe('Watch areas are hidden on the map. Switch on to see them.')
    const localeText = (lang: 'si' | 'ta') => readFileSync(join(ROOT, 'src', 'i18n', 'locales', `${lang}.ts`), 'utf8')
    for (const lang of ['si', 'ta'] as const) {
      // the review marker sits just above the landslide texts
      const text = localeText(lang)
      const hint = text.indexOf('landslidesHint:')
      expect(hint, lang).toBeGreaterThan(-1)
      expect(text.slice(Math.max(0, hint - 400), hint), lang).toContain('NEEDS REVIEW BY A NATIVE SPEAKER')
    }
  })

  it('has a real switch in place of "Coming soon"', () => {
    expect(controls).not.toMatch(/ComingSoon|comingSoon/)
    expect(controls).toMatch(/label=\{t\('layers\.landslides'\)\}\s+hint=\{t\('layers\.landslidesHint'\)\}\s+checked=\{settings\.landslides\}\s+onChange=\{\(value\) => onChange\('landslides', value\)\}/)
    expect(controls).toContain('<LandslideStatus layerOn={settings.landslides} />')
    expect(JSON.stringify(en)).not.toContain('Coming soon')
  })

  it('also explains the colours in the (i) panel, with both credits', () => {
    expect(controls).toContain("t('legend.landslideTitle')")
    expect(controls).toContain('{LANDSLIDE_CREDIT}')
    expect(controls).toContain('{BOUNDARY_CREDIT}')
    expect(controls).toContain('BOUNDARY_URL')
  })
})

describe('the threats chip', () => {
  it('counts Level 3 and Level 2 from the shared rule, with the landslide parts first', () => {
    expect(threats).toContain('chipCounts(warning)')
    expect(threats.indexOf("t('chip.landslide3'")).toBeGreaterThan(-1)
    expect(threats.indexOf("t('chip.landslide3'")).toBeLessThan(threats.indexOf("t('chip.landslide2'"))
    expect(threats.indexOf("t('chip.landslide2'")).toBeLessThan(threats.indexOf("t('chip.river'"))
    // never a Level 1 part
    expect(threats).not.toMatch(/chip\.landslide1/)
    expect(en.chip).not.toHaveProperty('landslide1_one')
  })

  it('counts Level 2 and 3 whatever the switch says, and they are drawn whatever it says: so a tap fits the map once they have loaded', () => {
    expect(threats).not.toMatch(/landslides\b.*settings|loadLayerSettings/)
    expect(chip).toContain('part.landslide && !landslideOnMap')
    // the chip no longer needs to know about the switch
    expect(chip).not.toContain('landslidesOn')
    expect(controls).not.toContain('landslidesOn')
  })

  it('waits for the warning before saying "no active threats", but not offline with nothing saved', () => {
    expect(threats).toContain('landslide.status]')
    const hook = read('src', 'lib', 'useLandslide.ts')
    expect(hook).toContain("query.fetchStatus === 'paused' ? 'error' : 'pending'")
  })
})

describe('the phone’s own clock', () => {
  it('works out "valid" from valid_to and never reads the server’s flag', () => {
    for (const file of [join('src', 'lib', 'landslide.ts'), join('src', 'lib', 'useLandslide.ts'), join('src', 'components', 'LandslideLayer.tsx')]) {
      expect(read(file), file).not.toMatch(/raw\.valid\b|\.valid\b(?!To|From|Until)/)
    }
    expect(read('src', 'lib', 'landslide.ts')).toContain('now < answer.validTo')
  })

  it('wakes at the moment the warning ends, as well as every minute', () => {
    const hook = read('src', 'lib', 'useLandslide.ts')
    expect(hook).toContain('useMinuteClock()')
    expect(hook).toContain('msUntilExpiry(answer, Date.now())')
    expect(hook).toContain('setTimeout(() => setWoken(Date.now()), wait + 50)')
  })
})

describe('saved on the phone', () => {
  it('is its own saved source, kept for 24 hours and not counted in the offline banner', () => {
    expect(sourceOf(['landslide'])).toBe('landslide')
    expect(sourceOf(['landslide-shapes'])).toBeNull()
  })
})
