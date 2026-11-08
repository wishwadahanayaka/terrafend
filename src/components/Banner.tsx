import { useLayoutEffect, useRef } from 'react'
import { Phone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { bannerExtraPx, setBannerHeight } from '../lib/bannerSpace'

type Props = { onOpenEmergency: () => void }

// z-index has to beat Leaflet's panes and controls, which go up to 1000.
// The whole banner is one big button that opens the emergency numbers: it is always on
// screen, so it is where someone in trouble looks, and it needs no room in the toolbar.
export default function Banner({ onOpenEmergency }: Props) {
  const { t, i18n } = useTranslation()
  const box = useRef<HTMLDivElement>(null)

  // Tells the buttons below how tall the banner is: --banner-bottom is where it ends, and
  // the card padding allows for it too. It changes with the language and the screen width.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const height = el.getBoundingClientRect().height
      setBannerHeight(height)
      document.documentElement.style.setProperty('--banner-bottom', `${Math.round(height)}px`)
      document.documentElement.style.setProperty('--banner-extra', `${bannerExtraPx()}px`)
    }
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [i18n.language])

  return (
    <div ref={box} className="pointer-events-none absolute inset-x-0 top-0 z-[1000] p-2">
      <button
        type="button"
        onClick={onOpenEmergency}
        className="pointer-events-auto mx-auto block w-full max-w-md rounded-lg bg-slate-800/90 px-3 py-2 text-center text-xs text-white shadow active:bg-slate-700"
      >
        <span className="block">{t('banner.notOfficial')}</span>
        <span className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-amber-300">
          <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('emergency.button')}
        </span>
      </button>
    </div>
  )
}
