import { useLayoutEffect, useRef, useState } from 'react'
import { latLngBounds, type Map as LeafletMap } from 'leaflet'
import { useOnline } from '../lib/useOnline'
import { useThreats, type ThreatPart } from '../lib/useThreats'

// The chip is never wider than the screen minus its margins, or this
const MAX_WIDTH_PX = 448
const SIDE_MARGIN_PX = 32
// px-3 on each side
const PADDING_PX = 24
// gap-x-1.5
const GAP_PX = 6
const MAX_LINES = 2

// How many parts fit in two lines, with a "+N more" at the end if some have to go.
// Works on the measured widths of each part, so it matches what the browser would wrap.
function fitParts(widths: number[], moreWidth: number, capacity: number): number {
  for (let shown = widths.length; shown >= 1; shown--) {
    const items = widths.slice(0, shown)
    if (shown < widths.length) items.push(moreWidth)
    let lines = 1
    let used = 0
    for (const width of items) {
      if (used === 0) used = width
      else if (used + GAP_PX + width > capacity) {
        lines++
        used = width
      } else used += GAP_PX + width
    }
    if (lines <= MAX_LINES) return shown
  }
  return 1
}

const dot = (color: string) => (
  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
)

// A part stays on one line, and the dot after it moves with it
const partClass = 'inline-flex items-center gap-1 whitespace-nowrap'

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
}

// One chip for everything serious right now: rivers at Alert or above, blocked or
// restricted road reports, and heavy rain or thunderstorms. It is never more than two
// lines: what doesn't fit becomes "+N more", which opens the Layers panel with the full
// list. Tapping the rest of it zooms the map out to show all of them.
export default function ThreatChip({ map, onMore }: Props) {
  const { parts, points, state } = useThreats()
  const online = useOnline()

  // Hidden copy of the parts and of "+N more", only to measure how wide each one is
  const measure = useRef<HTMLDivElement>(null)
  const [screen, setScreen] = useState(() => window.innerWidth)
  const [fits, setFits] = useState(parts.length)
  const key = parts.map((p) => p.text).join('|')

  useLayoutEffect(() => {
    const onResize = () => setScreen(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useLayoutEffect(() => {
    const host = measure.current
    if (!host || parts.length === 0) return
    const widths = [...host.children].map((el) => el.getBoundingClientRect().width)
    const moreWidth = widths.pop() ?? 0
    const capacity = Math.min(screen - SIDE_MARGIN_PX, MAX_WIDTH_PX) - PADDING_PX
    setFits(fitParts(widths, moreWidth, capacity))
    // key stands for the parts, so this runs when their wording changes
  }, [key, screen, parts.length])

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
          <span className={partClass}>+{parts.length} more</span>
        </div>
        <div className="flex max-h-[3.75rem] flex-wrap items-center gap-x-1.5 gap-y-0.5 overflow-hidden px-3 py-2 text-left text-[13px] font-semibold text-slate-900">
          {/* Every part zooms to the threats, like tapping the chip always has */}
          {parts.slice(0, shown).map((part, i) => (
            <button
              key={part.text}
              type="button"
              onClick={showThreats}
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
              +{hidden} more
            </button>
          )}
        </div>
      </div>
    )
  }

  // Nothing found. "No active threats" is only said when everything loaded, since a
  // missing source could be hiding one.
  if (state === 'loading') return null
  // Offline, "no active threats" would be a claim about right now that nothing can back up
  return (
    <p className="rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow">
      {!online
        ? 'No threats in the saved data (offline)'
        : state === 'clear'
          ? 'No active threats'
          : 'No threats found in the data that loaded'}
    </p>
  )
}
