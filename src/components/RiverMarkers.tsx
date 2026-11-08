import { Droplet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Marker, Popup } from 'react-leaflet'
import { divIcon, type DivIcon } from 'leaflet'
import { t } from '../i18n'
import { iconToSvg } from '../lib/iconHtml'
import { POPUP_PADDING } from '../lib/popupPadding'
import {
  CROSSING_LABEL,
  formatFt,
  gaugeName,
  isAlertOrAbove,
  riverNote,
  RIVER_CREDIT,
  STEP_COLOR,
  STEP_LABEL,
  stepTextColor,
  type RiverGauge,
  type RiverStep,
} from '../lib/riverGauges'
import { sriLankaTime, timeAgo } from '../lib/time'
import { usePopupFit } from '../lib/usePopupFit'
import { useRiverGauges } from '../lib/useRiverGauges'

// A small filled drop, so gauges can't be mistaken for the round hazard markers
const STEPS: RiverStep[] = ['normal', 'alert', 'minor', 'major', 'none', 'stale']
const dropIcons = new Map<RiverStep, DivIcon>()
for (const step of STEPS) {
  const svg = iconToSvg(Droplet, { size: 30, strokeWidth: 2, fill: STEP_COLOR[step], stroke: '#ffffff' })
  const fade = step === 'stale' ? 'opacity:0.75;' : ''
  dropIcons.set(
    step,
    divIcon({
      html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));${fade}">${svg}</div>`,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 30],
      popupAnchor: [0, -28],
    }),
  )
}

// Gauges at Alert or above always show. The rest only show when the user asks for them.
export default function RiverMarkers({ showAll }: { showAll: boolean }) {
  useTranslation() // redraws the marker names when the language changes
  const { data, status } = useRiverGauges()
  const popupFit = usePopupFit()

  // After a failed refresh the old readings are hidden too, rather than shown as if current
  if (status !== 'success') return null

  const shown = data.filter((gauge) => showAll || isAlertOrAbove(gauge.step))

  return (
    <>
      {shown.map((gauge) => (
        <Marker
          key={gauge.id}
          position={[gauge.lat, gauge.lng]}
          icon={dropIcons.get(gauge.step)}
          alt={t('river.alt', { name: gaugeName(gauge), step: STEP_LABEL[gauge.step] })}
          eventHandlers={popupFit}
          // Hazard reports matter more, so they sit on top where the two overlap
          zIndexOffset={-1000}
        >
          <Popup minWidth={230} {...POPUP_PADDING}>
            <RiverCard gauge={gauge} />
          </Popup>
        </Marker>
      ))}
    </>
  )
}

// Uses divs, not <p>, because Leaflet's popup CSS adds margins to paragraphs
function RiverCard({ gauge }: { gauge: RiverGauge }) {
  const { t } = useTranslation()
  const { step, level, marks, forecast } = gauge

  return (
    <div>
      <div className="text-base font-semibold text-slate-900">
        {gaugeName(gauge)}
      </div>

      <span
        className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
        style={{ backgroundColor: STEP_COLOR[step], color: stepTextColor(step) }}
      >
        {STEP_LABEL[step]}
      </span>
      {gauge.note && <span className="ml-2 text-xs text-slate-600">{riverNote(gauge.note)}</span>}

      {step === 'none' && (
        <div className="mt-2 text-sm text-slate-700">{t('river.noFloodLevels')}</div>
      )}
      {step === 'stale' && <div className="mt-2 text-sm text-slate-700">{t('river.notReporting')}</div>}

      {step !== 'stale' && (
        <div className="mt-2 text-sm text-slate-800">
          {level === null ? t('river.levelNone') : t('river.level', { level: formatFt(level) })}
        </div>
      )}

      {marks && (
        <div className="mt-1 text-xs text-slate-600">
          {t('river.marks', { alert: formatFt(marks.alert), minor: formatFt(marks.minor), major: formatFt(marks.major) })}
        </div>
      )}

      {gauge.observedAt && (
        <div className="mt-1 text-xs text-slate-600">
          {t('common.reading', { time: sriLankaTime(gauge.observedAt), ago: timeAgo(gauge.observedAt) })}
        </div>
      )}

      {forecast && (
        <div className="mt-2 rounded-lg bg-slate-100 px-2 py-1.5 text-xs text-slate-700">
          <span className="font-medium">{t('river.nextHour')}</span>{' '}
          {forecast.lowFt !== null && forecast.highFt !== null
            ? t('river.nextHourRange', {
                level: formatFt(forecast.levelFt),
                low: forecast.lowFt.toFixed(2),
                high: forecast.highFt.toFixed(2),
              })
            : t('river.nextHourAbout', { level: formatFt(forecast.levelFt) })}
          {forecast.direction && <div className="mt-0.5">{t(`river.${forecast.direction}`)}</div>}
          {forecast.crossing && <div className="mt-0.5">{t('river.mayReach', { mark: CROSSING_LABEL[forecast.crossing] })}</div>}
          <div className="mt-0.5 italic">{t('river.forecastNote')}</div>
        </div>
      )}

      {gauge.url && (
        <a
          href={gauge.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-sm font-medium text-blue-700 underline"
        >
          {t('river.more')}
        </a>
      )}
      <div className="mt-2 text-[11px] leading-tight text-slate-500">{RIVER_CREDIT}</div>
    </div>
  )
}
