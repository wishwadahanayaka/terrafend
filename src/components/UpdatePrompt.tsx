import { useRegisterSW } from 'virtual:pwa-register/react'
import { useTranslation } from 'react-i18next'

const CHECK_EVERY_MS = 60 * 60_000

// A new version is downloaded in the background and then waits. It only takes over when
// the person taps Refresh, so the page never reloads in the middle of a report or a route.
export default function UpdatePrompt() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // The app can stay open for days on a phone, so look for a new version now and then
      if (registration) {
        setInterval(() => {
          if (navigator.onLine) registration.update().catch(() => {})
        }, CHECK_EVERY_MS)
      }
    },
  })

  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-[1300] mx-auto flex max-w-sm items-center gap-2 rounded-2xl bg-slate-900 p-2 pl-4 text-white shadow-lg"
    >
      <button type="button" onClick={() => updateServiceWorker(true)} className="min-h-11 flex-1 text-left text-sm font-semibold">
        {t('update.available')}
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="min-h-11 rounded-xl px-3 text-sm text-slate-300 active:bg-slate-700"
      >
        {t('update.later')}
      </button>
    </div>
  )
}
