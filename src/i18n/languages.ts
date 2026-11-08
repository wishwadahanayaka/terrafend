export type Lang = 'en' | 'si' | 'ta'

export const LANGUAGES: { code: Lang; short: string; name: string }[] = [
  { code: 'en', short: 'EN', name: 'English' },
  { code: 'si', short: 'සිං', name: 'සිංහල' },
  { code: 'ta', short: 'த', name: 'தமிழ்' },
]

export const isLang = (value: unknown): value is Lang => LANGUAGES.some((l) => l.code === value)

// The first visit only looks at the language the person put first. Sinhala (si, si-LK) or
// Tamil (ta, ta-LK, ta-IN) gives that language. English, anything else, or an empty list
// gives English.
export function pickFirstLanguage(languages: readonly string[] | undefined | null): Lang {
  const first = languages?.[0]
  if (typeof first !== 'string') return 'en'
  const base = first.trim().toLowerCase().split(/[-_]/)[0]
  if (base === 'si' || base === 'sin') return 'si'
  if (base === 'ta' || base === 'tam') return 'ta'
  return 'en'
}

const STORAGE_KEY = 'terrafend:language'

// localStorage can throw (private windows, blocked site data), so both are wrapped
export function readSavedLanguage(): Lang | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return isLang(saved) ? saved : null
  } catch {
    return null
  }
}

export function saveLanguage(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // The choice just won't be remembered
  }
}

// What to start in: the saved choice, otherwise what the device prefers
export function startingLanguage(): Lang {
  return readSavedLanguage() ?? pickFirstLanguage(typeof navigator === 'undefined' ? [] : navigator.languages)
}
