import i18n, { type TOptions } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { isLang, saveLanguage, startingLanguage, type Lang } from './languages'
import en, { type Translations } from './locales/en'

// English is built in: it is the language the app starts in and the fallback for any
// missing key. Sinhala and Tamil are separate files that are only downloaded when chosen,
// so they cost nothing for everyone else. The service worker keeps both (every built file
// is precached), so switching works offline too.
const loaders: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Translations }>> = {
  si: () => import('./locales/si'),
  ta: () => import('./locales/ta'),
}

// Runs as soon as this file loads, so text helpers outside React (and the tests) can
// translate straight away. initAsync: false makes it finish before the next line.
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
  react: { useSuspense: false },
})

export default i18n

export const currentLang = (): Lang => (isLang(i18n.language) ? i18n.language : 'en')

// For code that is not a React component. Components use useTranslation(), which also
// redraws them when the language changes.
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, (options ?? {}) as TOptions) as string
}

async function loadBundle(lang: Lang): Promise<void> {
  if (lang === 'en' || i18n.hasResourceBundle(lang, 'translation')) return
  const bundle = (await loaders[lang]()).default
  i18n.addResourceBundle(lang, 'translation', bundle)
}

// Switches the whole app, remembers the choice and tells the browser the page language
// (screen readers and the browser's font choice both use it). If the file can't be
// downloaded (offline and never cached) the current language stays.
export async function setLanguage(lang: Lang, remember = true): Promise<boolean> {
  try {
    await loadBundle(lang)
  } catch {
    return false
  }
  await i18n.changeLanguage(lang)
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  if (remember) saveLanguage(lang)
  return true
}

// Called once before the first screen is drawn, so there is no flash of English
export async function startI18n(): Promise<void> {
  await setLanguage(startingLanguage(), false)
}
