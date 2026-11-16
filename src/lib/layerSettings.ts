import { parseNewsFilter, type NewsFilter } from './newsFilter'
import { parseRainView, type RainView } from './rainView'

// What each Layers toggle adds on top of the serious items, which always show
export type LayerSettings = {
  // Passable reports
  passableReports: boolean
  // River gauges below Alert
  normalRivers: boolean
  // Light and moderate rain
  mildRain: boolean
  // Green global alerts
  greenAlerts: boolean
  // NBRO's landslide warning areas. The only switch that is ON until it is turned off.
  landslides: boolean
}

// The rivers key is the one the old Rivers button used, so people keep their choice
const KEYS: Record<keyof LayerSettings, string> = {
  passableReports: 'terrafend:showPassableReports',
  normalRivers: 'terrafend:showAllRivers',
  mildRain: 'terrafend:showMildRain',
  greenAlerts: 'terrafend:showGreenAlerts',
  landslides: 'terrafend:showLandslides',
}

// What each switch is before the person has chosen: off for the extras, on for the landslide warnings
export const LAYER_DEFAULTS: LayerSettings = {
  passableReports: false,
  normalRivers: false,
  mildRain: false,
  greenAlerts: false,
  landslides: true,
}

// Storage can be missing or blocked (private windows, strict settings), so it's only ever a bonus.
// Only a saved choice counts: anything else (nothing saved, blocked storage) is the default.
function read(name: keyof LayerSettings): boolean {
  try {
    const saved = localStorage.getItem(KEYS[name])
    return saved === '1' ? true : saved === '0' ? false : LAYER_DEFAULTS[name]
  } catch {
    return LAYER_DEFAULTS[name]
  }
}

export function loadLayerSettings(): LayerSettings {
  return {
    passableReports: read('passableReports'),
    normalRivers: read('normalRivers'),
    mildRain: read('mildRain'),
    greenAlerts: read('greenAlerts'),
    landslides: read('landslides'),
  }
}

export function saveLayerSetting(name: keyof LayerSettings, value: boolean) {
  try {
    localStorage.setItem(KEYS[name], value ? '1' : '0')
  } catch {
    // not saved, the choice still works until the page is closed
  }
}

// Past 3 h or Next 3 h. It isn't a yes/no switch, so it is kept apart from the ones above.
export const RAIN_VIEW_KEY = 'terrafend:rainView'

export function loadRainView(): RainView {
  try {
    return parseRainView(localStorage.getItem(RAIN_VIEW_KEY))
  } catch {
    return parseRainView(null)
  }
}

export function saveRainView(view: RainView) {
  try {
    localStorage.setItem(RAIN_VIEW_KEY, view)
  } catch {
    // not saved, the choice still works until the page is closed
  }
}

// The language of news reports the news sheet shows (all, English, Sinhala or Tamil)
export const NEWS_FILTER_KEY = 'terrafend:newsLanguage'

export function loadNewsFilter(): NewsFilter {
  try {
    return parseNewsFilter(localStorage.getItem(NEWS_FILTER_KEY))
  } catch {
    return parseNewsFilter(null)
  }
}

export function saveNewsFilter(filter: NewsFilter) {
  try {
    localStorage.setItem(NEWS_FILTER_KEY, filter)
  } catch {
    // not saved, the choice still works until the page is closed
  }
}
