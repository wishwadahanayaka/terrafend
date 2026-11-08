import { t } from '../i18n'

// Sri Lanka has no daylight saving, so its time is always UTC+5:30 and can be worked out by
// hand. That keeps dates and times the same on every phone: the browser's own Sinhala and Tamil
// date data is missing on some devices. Month names and am/pm come from the translation files.
// Digits stay 0-9 in every language, as is usual in Sri Lanka.
const OFFSET_MS = 5.5 * 3_600_000
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function inSriLanka(ms: number) {
  const d = new Date(ms + OFFSET_MS)
  return {
    year: d.getUTCFullYear(),
    month: MONTHS[d.getUTCMonth()],
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  }
}

function describe(ms: number, key: 'Ago' | 'Expires'): string {
  const minutes = Math.round(ms / 60_000)
  const unit = key === 'Ago' ? ['minAgo', 'hourAgo', 'dayAgo'] : ['expiresMin', 'expiresHour', 'expiresDay']
  if (minutes < 60) return t(`time.${unit[0]}`, { count: Math.max(minutes, 1) })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t(`time.${unit[1]}`, { count: hours })
  return t(`time.${unit[2]}`, { count: Math.round(hours / 24) })
}

// Rounded to whole minutes, since a driving estimate isn't more exact than that
export function routeDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return t('time.durationMin', { count: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? t('time.durationHourMin', { hours, minutes: rest }) : t('time.durationHour', { hours })
}

// "2:10 pm", the time of day in Sri Lanka time
export function sriLankaClock(ms: number): string {
  const { hour, minute } = inSriLanka(ms)
  return t('time.clock', {
    hour: hour % 12 === 0 ? 12 : hour % 12,
    minute: String(minute).padStart(2, '0'),
    period: t(hour < 12 ? 'time.am' : 'time.pm'),
  })
}

// "4 Nov", to tell data from another day apart
export function sriLankaDay(ms: number): string {
  const { day, month } = inSriLanka(ms)
  return t('time.dayMonth', { day, month: t(`time.month.${month}`) })
}

// The API sends UTC; people here think in Sri Lanka time wherever their phone is set
export function sriLankaTime(iso: string): string {
  const ms = new Date(iso).getTime()
  const { year, day, month } = inSriLanka(ms)
  const text = t('time.dateTime', { day, month: t(`time.month.${month}`), year, clock: sriLankaClock(ms) })
  return t('time.sriLanka', { time: text })
}

export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  if (ms < 60_000) return t('time.justNow')
  return describe(ms, 'Ago')
}

export function expiresIn(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return t('time.expiringNow')
  return describe(ms, 'Expires')
}
