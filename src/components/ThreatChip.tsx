import { useLayoutEffect, useRef, useState } from 'react'
import { latLngBounds, type Map as LeafletMap } from 'leaflet'
import { Newspaper } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { fitParts } from '../lib/chipFit'
import { newsAriaLabel, newsPillText } from '../lib/news'
import { newsEnabled } from '../lib/newsFlag'
import type { RainView } from '../lib/rainView'
import { useNewsChip, type NewsEntryState } from '../lib/useNewsChip'
import { useOnline } from '../lib/useOnline'
import { useThreats, type ThreatPart } from '../lib/useThreats'

// The chip is never wider than the screen minus its margins, or this
const MAX_WIDTH_PX = 448
const SIDE_MARGIN_PX = 32
// px-3 on each side
const PADDING_PX = 24

const dot = (color: string) => (
  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
)

// A part stays on one line, and the dot after it moves with it
const partClass = 'inline-flex items-center gap-1 whitespace-nowrap'

// The News part: outlined, so it doesn't read as a threat, with a red dot when an official notice
// came out in the last 24 hours. It is never one of the parts that can go under "+N more".
const newsPillClass =
  'relative inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full border border-slate-500 px-2 py-0.5 text-[13px] font-semibold text-slate-800'

function NewsPillContent({ news }: { news: NewsEntryState }) {
  return (
    <>
      <Newspaper className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {newsPillText(news.count)}
      {news.officialRecent && (
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-red-600" />
      )}
    </>
  )
}

function NewsPill({ news, onClick, alone }: { news: NewsEntryState; onClick: () => void; alone?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={newsAriaLabel(news.count, news.officialRecent)}
      // On its own (no threats) it needs a white background and a shadow to stand out on the map
      className={`${newsPillClass} active:opacity-60 ${alone ? 'bg-white shadow-lg' : ''}`}
    >
      <NewsPillContent news={news} />
    </button>
  )
}

function Parts({ parts, hideLastDot }: { parts: ThreatPart[]; hideLastDot: boolean }) {
  return parts.map((part, i) => (
    <span key={part.text} className={partClass}>
      {dot(part.color)}
      {part.text}
      {(i < parts.length - 1 || !hideLastDot) && (
        <span aria-hidden="true" className="ml-0.5">
          &middot;
        </span>
      )}
    </span>
  ))
}

type Props = {
  map: LeafletMap | null
  // Opens the Layers panel, where the whole list is
  onMore: () => void
  // A tap on a rain part switches the map to the rain it is about (past or next 3 hours)
  onRainView: (view: RainView) => void
  // Opens the disaster news sheet (only used when the news feed is switched on)
  onOpenNews: () => void
}

// One chip for everything serious right now: rivers at Alert or above, blocked or
// restricted road reports, and heavy rain or thunderstorms. It is never more than two
// lines: what doesn't fit becomes "+N more", which opens the Layers panel with the full
// list. Tapping the rest of it zooms the map out to show all of them. When the news feed is on, a
// News part ends it, which is always shown and opens the news sheet.
export default function ThreatChip({ map, onMore, onRainView, onOpenNews }: Props) {
  const { parts, points, state, landslideOnMap } = useThreats()
  const { t } = useTranslation()
  const online = useOnline()
  // Read once: the news feed is on for a person or off, it doesn't change while the app is open
  const [newsOn] = useState(newsEnabled)
  const news = useNewsChip(newsOn)
  const hasNews = news !== null

  // Hidden copy of the parts, of "+N more" and of the News part, only to measure how wide each one is
  const measure = useRef<HTMLDivElement>(null)
  const [screen, setScreen] = useState(() => window.innerWidth)
  const [fits, setFits] = useState(parts.length)
  const key = parts.map((p) => p.text).join('|')
  // The News part's wording and size changes with its number and its dot
  const newsKey = news ? `${newsPillText(news.count)}|${news.officialRecent}` : ''

  useLayoutEffect(() => {
    const onResize = () => setScreen(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useLayoutEffect(() => {
    const host = measure.current
    if (!host || parts.length === 0) return
    const widths = [...host.children].map((el) => el.getBoundingClientRect().width)
    // The last child is the News part when there is one, and the one before it is "+N more"
    const tailWidth = hasNews ? (widths.pop() ?? 0) : 0
    const moreWidth = widths.pop() ?? 0
    const capacity = Math.min(screen - SIDE_MARGIN_PX, MAX_WIDTH_PX) - PADDING_PX
    setFits(fitParts(widths, moreWidth, capacity, tailWidth))
    // key and newsKey stand for the parts and the News part, so this runs when their wording changes
  }, [key, newsKey, hasNews, screen, parts.length])

  function showThreats() {
    if (!map || points.length === 0) return
    map.fitBounds(latLngBounds(points), { paddingTopLeft: [40, 160], paddingBottomRight: [40, 100], maxZoom: 13 })
  }

  if (parts.length > 0) {
    const shown = Math.min(fits, parts.length)
    const hidden = parts.length - shown
    return (
      <div className="relative max-w-[min(calc(100vw-2rem),28rem)] overflow-hidden rounded-2xl bg-white shadow-lg">
        <div
          ref={measure}
          aria-hidden="true"
          className="pointer-events-none invisible absolute left-0 top-0 flex w-max gap-x-1.5 px-3 py-2 text-[13px] font-semibold"
        >
          <Parts parts={parts} hideLastDot={false} />
          <span className={partClass}>{t('chip.more', { count: parts.length })}</span>
          {news && (
            <span className={newsPillClass}>
              <NewsPillContent news={news} />
            </span>
          )}
        </div>
        <div className="flex max-h-[3.75rem] flex-wrap items-center gap-x-1.5 gap-y-0.5 overflow-hidden px-3 py-2 text-left text-[13px] font-semibold text-slate-900">
          {/* Every part zooms to the threats, like tapping the chip always has. A rain part also
              switches the map to its rain view, so the squares it counted are the ones on screen. */}
          {parts.slice(0, shown).map((part, i) => (
            <button
              key={part.text}
              type="button"
              onClick={() => {
                // Level 2 and 3 areas are always drawn, once their outlines have loaded. Until then (or if
                // they couldn't) the Layers panel says what the warning is.
                if (part.landslide && !landslideOnMap) {
                  onMore()
                  return
                }
                if (part.view) onRainView(part.view)
                showThreats()
              }}
              className={`${partClass} text-left active:opacity-60`}
            >
              {dot(part.color)}
              {part.text}
              {(i < shown - 1 || hidden > 0) && (
                <span aria-hidden="true" className="ml-0.5">
                  &middot;
                </span>
              )}
            </button>
          ))}
          {hidden > 0 && (
            <button type="button" onClick={onMore} className={`${partClass} text-sky-700 underline active:opacity-60`}>
              {t('chip.more', { count: hidden })}
            </button>
          )}
          {news && <NewsPill news={news} onClick={onOpenNews} />}
        </div>
      </div>
    )
  }

  const newsAlone = news ? <NewsPill news={news} onClick={onOpenNews} alone /> : null

  // Nothing found. "No active threats" is only said when everything loaded, since a
  // missing source could be hiding one.
  if (state === 'loading') return newsAlone
  // Offline, "no active threats" would be a claim about right now that nothing can back up
  return (
    <div className="flex max-w-[min(calc(100vw-2rem),28rem)] flex-wrap items-center justify-end gap-1.5">
      <p className="rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow">
        {!online
          ? t('offline.noThreats')
          : state === 'clear'
            ? t('chip.clear')
            : t('chip.partial')}
      </p>
      {newsAlone}
    </div>
  )
}
