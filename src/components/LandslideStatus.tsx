import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { placeAreas } from '../lib/landslideShapes'
import { statusLine } from '../lib/landslideStatus'
import { useLandslide, useLandslideShapes } from '../lib/useLandslide'
import { useMinuteClock } from '../lib/useMinuteClock'

const note = 'mx-2 mb-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700'

// The line under the Landslide warnings switch in the Layers panel: whether there is an active
// warning, how many areas it names, or that the newest one couldn't be read (with the official PDF).
// More lines follow only when they apply: names that aren't on the map, a saved answer, and so on.
export default function LandslideStatus({ layerOn }: { layerOn: boolean }) {
  const { t } = useTranslation()
  const { view, status, savedAt, stale } = useLandslide()
  // Only reads what the map layer has loaded: the outlines are never asked for from here
  const shapes = useLandslideShapes(false)
  const now = useMinuteClock()

  const warning = view?.kind === 'active' ? view.warning : null
  const notDrawn = useMemo(() => (warning && shapes.data ? placeAreas(warning.areas, shapes.data).notDrawn : null), [warning, shapes.data])
  const line = statusLine({ load: status, view, layerOn, notDrawn, shapesFailed: shapes.isError, savedAt, stale, now })

  const warm = line.kind === 'active' || line.kind === 'unreadable'
  return (
    <>
      <p role="status" className={`mx-2 mb-1 rounded-lg px-3 py-2 text-xs ${warm ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>
        <span className={line.kind === 'active' ? 'font-semibold' : ''}>{line.text}</span>
        {line.pdfUrl && (
          <>
            {' '}
            <a href={line.pdfUrl} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-medium text-blue-700 underline">
              {t('landslide.openPdf')}
            </a>
          </>
        )}
      </p>
      {line.also && <p className={note}>{line.also}</p>}
      {line.offHint && <p className={note}>{line.offHint}</p>}
      {line.drawFailed && <p className={note}>{line.drawFailed}</p>}
      {line.saved && <p className={note}>{line.saved}</p>}
    </>
  )
}
