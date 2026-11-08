import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { bannerExtraPx, setBannerHeight } from '../lib/bannerSpace'

// z-index has to beat Leaflet's panes and controls, which go up to 1000
export default function Banner() {
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
      <p className="mx-auto max-w-md rounded-lg bg-slate-800/90 px-3 py-2 text-center text-xs text-white shadow">
        {t('banner.notOfficial')}
      </p>
    </div>
  )
}
