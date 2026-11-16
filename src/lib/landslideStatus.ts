import { areaCount, areasToDraw, hiddenWatchAreas, namesWithLevel, unmatchedAreas, type LandslideArea, type LandslideView } from './landslide'
import type { LandslideStatus as LoadStatus } from './useLandslide'
import { t } from '../i18n'
import { sriLankaWhen } from './time'

// What the one status line under the Landslide warnings switch says, and the lines that may follow it.
// Pure, so every case can be tested.

export type StatusKind = 'checking' | 'unavailable' | 'none' | 'unreadable' | 'active'

export type StatusLine = {
  kind: StatusKind
  // The line itself
  text: string
  // Only for "couldn't be read": the official PDF
  pdfUrl: string | null
  // More lines, only when they apply
  also: string | null
  offHint: string | null
  drawFailed: string | null
  saved: string | null
}

type Input = {
  load: LoadStatus
  view: LandslideView | null
  // The switch, which only adds Level 1 (Watch) areas to the map
  layerOn: boolean
  // Names that could not be put on the map: no match, or no outline in the boundary file. Null until
  // the outlines have loaded.
  notDrawn: LandslideArea[] | null
  // The outlines could not be loaded
  shapesFailed: boolean
  // When the answer on the phone was loaded, and whether it could not be refreshed
  savedAt: number | null
  stale: boolean
  now: number
}

export function statusLine({ load, view, layerOn, notDrawn, shapesFailed, savedAt, stale, now }: Input): StatusLine {
  const base: StatusLine = { kind: 'none', text: '', pdfUrl: null, also: null, offHint: null, drawFailed: null, saved: null }
  if (!view) {
    return load === 'error'
      ? { ...base, kind: 'unavailable', text: t('layers.landslideUnavailable') }
      : { ...base, kind: 'checking', text: t('layers.landslideChecking') }
  }
  // An answer kept on the phone: say when, since it could not be checked just now
  const saved = stale && savedAt !== null ? t('layers.landslideSaved', { when: sriLankaWhen(savedAt, now) }) : null

  if (view.kind === 'none') return { ...base, text: t('layers.landslideNone'), saved }
  if (view.kind === 'unreadable') {
    return { ...base, kind: 'unreadable', text: t('layers.landslideUnreadable'), pdfUrl: view.pdfUrl, saved }
  }

  const warning = view.warning
  // The names that are not on the map, as text. Before the outlines have loaded only the names with no
  // match are known; after, also any whose division the boundary file lacks.
  const missing = notDrawn ?? unmatchedAreas(warning.areas)
  return {
    ...base,
    kind: 'active',
    text: t('layers.landslideActive', { count: areaCount(warning) }),
    also: missing.length > 0 ? t('layers.landslideAlso', { names: namesWithLevel(missing).join('; ') }) : null,
    // Level 2 and 3 always show, so only Level 1 (Watch) is ever kept off the map by the switch
    offHint: hiddenWatchAreas(warning.areas, layerOn).length > 0 ? t('layers.landslideOffHint') : null,
    drawFailed: shapesFailed && areasToDraw(warning.areas, layerOn).length > 0 ? t('layers.landslideDrawFailed') : null,
    saved,
  }
}
