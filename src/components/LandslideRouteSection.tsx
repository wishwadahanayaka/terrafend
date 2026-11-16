import { Mountain } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LatLngTuple } from 'leaflet'
import { LEVEL_COLOR } from '../lib/landslide'
import { pointsFor, routeLandslideLines, type PassLine, type RouteLandslide, type RouteLandslideLines } from '../lib/landslideRoute'

type Props = {
  landslide: RouteLandslide
  // The Landslide warnings switch in the Layers panel. It decides whether Watch areas are on the map.
  switchOn: boolean
  // Zooms the map to the areas. `needsWatch` is true when they are Watch areas and the switch is off,
  // so the map turns it on to show them.
  onShow: (points: LatLngTuple[], needsWatch: boolean) => void
}

type Active = Extract<RouteLandslideLines, { kind: 'active' }>

const linkClass = 'text-sm font-medium text-blue-700 underline'

function PdfLink({ url }: { url: string | null }) {
  const { t } = useTranslation()
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {t('landslide.openPdf')}
    </a>
  )
}

// What every line carries: how long the warning is valid, who it is from, the official PDF, and a way to
// see the areas on the map
function Details({ lines, line, switchOn, onShow }: { lines: Active; line: PassLine; switchOn: boolean; onShow: Props['onShow'] }) {
  const { t } = useTranslation()
  const needsWatch = line.level === 1 && !switchOn
  return (
    <>
      <p className="mt-1 text-xs text-slate-700">
        {lines.validUntil} · {lines.source}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4">
        <PdfLink url={lines.pdfUrl} />
        <button
          type="button"
          onClick={() => onShow(pointsFor(line.areas), needsWatch)}
          className="min-h-11 text-sm font-medium text-blue-700 underline"
        >
          {t(needsWatch ? 'route.landslide.showWatch' : 'route.landslide.show')}
        </button>
      </div>
    </>
  )
}

// NBRO's landslide warning against the route, in the same look as the river and global alert items: a
// Level 3 or Level 2 area on the route is an item with an icon in the level's colour, counted in the
// header. A Level 1 (Watch) area is a quiet note and is never counted. Everything is said whatever the
// Layers switch is: it is about the route, not the map.
export default function LandslideRouteSection({ landslide, switchOn, onShow }: Props) {
  const { t } = useTranslation()
  const lines = routeLandslideLines(landslide)
  if (lines.kind === 'none') return null

  if (lines.kind === 'unreadable') {
    return (
      <div className="mt-3">
        <p className="text-sm font-semibold text-slate-900">{t('route.landslide.title')}</p>
        <p className="mt-1 text-sm text-slate-800">{lines.text}</p>
        <div className="mt-1">
          <PdfLink url={lines.pdfUrl} />
        </div>
      </div>
    )
  }

  const { items, watch, unchecked, checking, failed } = lines
  if (items.length === 0 && !watch && !unchecked && !checking && !failed) return null

  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-slate-900">{t('route.landslide.title')}</p>

      {items.length > 0 && (
        <ul className="mt-2 space-y-2">
          {items.map((line) => (
            <li key={line.level} className="flex items-start gap-3 rounded-xl border-2 border-slate-200 px-2 py-2">
              <Mountain className="mt-0.5 h-6 w-6 shrink-0" style={{ color: LEVEL_COLOR[line.level] }} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm text-slate-900">{line.text}</p>
                <Details lines={lines} line={line} switchOn={switchOn} onShow={onShow} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Watch is the lowest step and is issued for many divisions on most rainy days: a quiet note */}
      {watch && (
        <div className="mt-2">
          <p className="text-sm text-slate-800">{watch.text}</p>
          <Details lines={lines} line={watch} switchOn={switchOn} onShow={onShow} />
        </div>
      )}

      {checking && <p className="mt-2 text-sm text-slate-600">{checking}</p>}
      {failed && (
        <div className="mt-2">
          <p className="text-sm text-slate-800">{failed}</p>
          <PdfLink url={lines.pdfUrl} />
        </div>
      )}
      {unchecked && <p className="mt-2 text-sm text-slate-800">{unchecked}</p>}
    </div>
  )
}
