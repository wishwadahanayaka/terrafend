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
}

// The rivers key is the one the old Rivers button used, so people keep their choice
const KEYS: Record<keyof LayerSettings, string> = {
  passableReports: 'terrafend:showPassableReports',
  normalRivers: 'terrafend:showAllRivers',
  mildRain: 'terrafend:showMildRain',
  greenAlerts: 'terrafend:showGreenAlerts',
}

// Storage can be missing or blocked (private windows, strict settings), so it's only ever a bonus
function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function loadLayerSettings(): LayerSettings {
  return {
    passableReports: read(KEYS.passableReports),
    normalRivers: read(KEYS.normalRivers),
    mildRain: read(KEYS.mildRain),
    greenAlerts: read(KEYS.greenAlerts),
  }
}

export function saveLayerSetting(name: keyof LayerSettings, value: boolean) {
  try {
    localStorage.setItem(KEYS[name], value ? '1' : '0')
  } catch {
    // not saved, the choice still works until the page is closed
  }
}
