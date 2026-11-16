import { describe, expect, it } from 'vitest'
import { landslideView, parseLandslide, type LandslideArea, type LandslideView } from './landslide'
import { fakeLandslideAnswer, type FakeLandslideMode } from './fakeLandslide'
import { statusLine } from './landslideStatus'

// The line under the Landslide warnings switch, in every state it can be in.

const NOW = Date.parse('2026-11-15T10:00:00Z')
const PDF = 'https://www.dmc.gov.lk/images/dmcreports/TEST_fake_landslide_warning.pdf'

const viewOf = (mode: FakeLandslideMode): LandslideView => landslideView(fakeLandslideAnswer(mode, NOW), NOW)
const base = { load: 'success' as const, layerOn: true, notDrawn: null, shapesFailed: false, savedAt: null, stale: false, now: NOW }

describe('the status line', () => {
  it('says it is checking, while nothing has come back yet', () => {
    expect(statusLine({ ...base, load: 'pending', view: null })).toMatchObject({ kind: 'checking', text: 'Checking for landslide warnings…' })
  })

  it('says it is unavailable, when nothing loaded and nothing is saved', () => {
    expect(statusLine({ ...base, load: 'error', view: null })).toMatchObject({ kind: 'unavailable', text: 'Landslide warnings unavailable right now' })
  })

  it('"No active landslide warning" when none is stored, and when the newest one has ended', () => {
    for (const mode of ['none', 'expired'] as const) {
      expect(statusLine({ ...base, view: viewOf(mode) }), mode).toMatchObject({ kind: 'none', text: 'No active landslide warning', pdfUrl: null })
    }
  })

  it('"Active warning: N areas", counting every area the warning names', () => {
    expect(statusLine({ ...base, view: viewOf('mixed') }).text).toBe('Active warning: 11 areas')
    expect(statusLine({ ...base, view: viewOf('level3') }).text).toBe('Active warning: 3 areas')
    // a name that could not be matched is still one of them
    expect(statusLine({ ...base, view: viewOf('unmatched') }).text).toBe('Active warning: 13 areas')
    const one = parseLandslide({
      found: true,
      message_id: 'LEWM-14-11-2026-1600-09',
      update: 9,
      issued_at: '2026-11-15T08:00:00Z',
      valid_from: '2026-11-15T08:00:00Z',
      valid_to: '2026-11-16T08:00:00Z',
      listed_at: '2026-11-15T08:05:00Z',
      pdf_url: PDF,
      parse_ok: true,
      areas: [{ level: 1, district: 'Badulla', name: 'Ella', code: 'LK8136', district_code: 'LK81', shift: 0, added: false, note: null }],
    })!
    expect(statusLine({ ...base, view: landslideView(one, NOW) }).text).toBe('Active warning: 1 area')
  })

  it('"Latest warning couldn\'t be read", with the official PDF to open', () => {
    const line = statusLine({ ...base, view: viewOf('unreadable') })
    expect(line).toMatchObject({ kind: 'unreadable', text: "Latest warning couldn't be read", pdfUrl: PDF })
  })

  it('an unreadable newest warning is said as such, whatever older warning there was', () => {
    // landslide_current() only ever sends the newest, so this is all there is to show
    expect(viewOf('unreadable').kind).toBe('unreadable')
    expect(statusLine({ ...base, view: viewOf('unreadable') }).also).toBeNull()
  })

  it('lists the names that are not on the map as text, with their district and level', () => {
    const line = statusLine({ ...base, view: viewOf('unmatched') })
    expect(line.also).toBe('Also named in the warning (not on the map): Kotmale (Nuwara Eliya, Level 1); Nowhereville (Badulla, Level 2)')
    // none when every name is matched
    expect(statusLine({ ...base, view: viewOf('mixed') }).also).toBeNull()
  })

  it('once the outlines have loaded, a matched name the boundary file lacks is listed too', () => {
    const view = viewOf('mixed')
    if (view.kind !== 'active') throw new Error('not active')
    const lacking: LandslideArea[] = [view.warning.areas[0]]
    const line = statusLine({ ...base, view, notDrawn: lacking })
    expect(line.also).toContain('Aranayake (Kegalle, Level 3)')
    expect(statusLine({ ...base, view, notDrawn: [] }).also).toBeNull()
  })

  it('says the Watch areas are hidden when the switch is off and the warning has some', () => {
    const hint = 'Watch areas are hidden on the map. Switch on to see them.'
    expect(statusLine({ ...base, view: viewOf('level1'), layerOn: false }).offHint).toBe(hint)
    expect(statusLine({ ...base, view: viewOf('mixed'), layerOn: false }).offHint).toBe(hint)
    expect(statusLine({ ...base, view: viewOf('mixed'), layerOn: true }).offHint).toBeNull()
  })

  it('says nothing is hidden when the warning has no Watch areas: Alert and Evacuate always show', () => {
    for (const mode of ['level2', 'level3'] as const) {
      expect(statusLine({ ...base, view: viewOf(mode), layerOn: false }).offHint, mode).toBeNull()
    }
  })

  it('says the areas could not be drawn when the outlines failed and there is something to draw', () => {
    const failed = "The areas couldn't be drawn on the map just now."
    expect(statusLine({ ...base, view: viewOf('level2'), shapesFailed: true }).drawFailed).toBe(failed)
    // Alert and Evacuate are drawn with the switch off too
    expect(statusLine({ ...base, view: viewOf('level3'), shapesFailed: true, layerOn: false }).drawFailed).toBe(failed)
    expect(statusLine({ ...base, view: viewOf('mixed'), shapesFailed: true, layerOn: false }).drawFailed).toBe(failed)
    // a Watch-only warning with the switch off has nothing to draw, so nothing to fail
    expect(statusLine({ ...base, view: viewOf('level1'), shapesFailed: true, layerOn: false }).drawFailed).toBeNull()
    expect(statusLine({ ...base, view: viewOf('level1'), shapesFailed: true, layerOn: true }).drawFailed).toBe(failed)
    expect(statusLine({ ...base, view: viewOf('level2'), shapesFailed: false }).drawFailed).toBeNull()
  })

  it('the count in "Active warning" does not depend on the switch', () => {
    expect(statusLine({ ...base, view: viewOf('mixed'), layerOn: false }).text).toBe('Active warning: 11 areas')
    expect(statusLine({ ...base, view: viewOf('mixed'), layerOn: true }).text).toBe('Active warning: 11 areas')
  })

  it('says when an answer on the phone was saved, if it could not be refreshed', () => {
    const savedAt = Date.parse('2026-11-15T08:45:00Z')
    const line = statusLine({ ...base, view: viewOf('level1'), savedAt, stale: true })
    expect(line.saved).toBe('Saved at 2:15 pm. It could not be refreshed just now.')
    expect(statusLine({ ...base, view: viewOf('level1'), savedAt, stale: false }).saved).toBeNull()
    // "no warning" from the phone's memory is also said to be from the memory
    expect(statusLine({ ...base, view: viewOf('none'), savedAt, stale: true }).saved).not.toBeNull()
  })
})
