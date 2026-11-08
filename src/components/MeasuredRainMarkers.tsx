import { CloudRain } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Marker, Popup } from 'react-leaflet'
import { divIcon, type DivIcon } from 'leaflet'
import { t } from '../i18n'
import { iconToSvg } from '../lib/iconHtml'
import { POPUP_PADDING } from '../lib/popupPadding'
import { MILD_COLOR, MILD_LABEL, RAIN_COLOR, RAIN_LABEL } from '../lib/rainForecast'
import { gaugeWhen, GAUGE_RAIN_CREDIT, measuredText, type GaugeRain } from '../lib/rainMeasured'
import { gaugeName } from '../lib/riverGauges'
import { sriLankaTime, timeAgo } from '../lib/time'
import { usePopupFit } from '../lib/usePopupFit'
import { useMeasuredRain } from '../lib/useMeasuredRain'

type Key = keyof typeof RAIN_COLOR | keyof typeof MILD_COLOR

const COLORS: Record<Key, string> = { ...RAIN_COLOR, ...MILD_COLOR }

const colorOf = (gauge: GaugeRain) => COLORS[keyOf(gauge)]
const labelOf = (gauge: GaugeRain) => (gauge.level ? RAIN_LABEL[gauge.level] : MILD_LABEL[gauge.mild ?? 'light'])
const keyOf = (gauge: GaugeRain): Key => gauge.level ?? gauge.mild ?? 'light'

// A small rounded badge with a rain cloud, drawn up and to the right of the gauge so it
// doesn't cover the river drop. The pale light-rain blue gets a dark icon to stay readable.
// Drawn once when the file loads, since icons can't be made during a render.
const icons = new Map<Key, DivIcon>()
const cloud = iconToSvg(CloudRain, { size: 18, strokeWidth: 2.25 })
for (const key of Object.keys(COLORS) as Key[]) {
  const ink = key === 'light' ? '#0f172a' : '#ffffff'
  icons.set(
    key,
    divIcon({
      html: `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:9px;border:2px solid #fff;background:${COLORS[key]};color:${ink};box-shadow:0 2px 6px rgba(0,0,0,0.4)">${cloud}</div>`,
      className: '',
      iconSize: [30, 30],
      // The gauge's spot is to the lower left of the badge
      iconAnchor: [-16, 34],
      popupAnchor: [31, -38],
    }),
  )
}

type Props = {
  // Heavy rain and above always shows. This adds light and moderate rain.
  showMild: boolean
}

// Rain a gauge measured, as a badge beside it. Under the hazard reports, like the
// river drops. If the measured rain can't be loaded there are simply no badges.
export default function MeasuredRainMarkers({ showMild }: Props) {
  useTranslation() // redraws the marker names when the language changes
  const { data, status } = useMeasuredRain()
  const popupFit = usePopupFit()

  if (status !== 'success') return null
  const shown = data.gauges.filter((g) => g.level || (showMild && g.mild))

  return (
    <>
      {shown.map((gauge) => (
        <Marker
          key={gauge.id}
          position={[gauge.lat, gauge.lng]}
          icon={icons.get(keyOf(gauge))}
          alt={t('rain.gaugeCard.alt', { label: labelOf(gauge), when: gaugeWhen(gauge), station: gauge.station })}
          eventHandlers={popupFit}
          zIndexOffset={-800}
        >
          <Popup minWidth={230} {...POPUP_PADDING}>
            <GaugeRainCard gauge={gauge} />
          </Popup>
        </Marker>
      ))}
    </>
  )
}

// Uses divs, not <p>, because Leaflet's popup CSS adds margins to paragraphs
function GaugeRainCard({ gauge }: { gauge: GaugeRain }) {
  const { t } = useTranslation()
  const iso = new Date(gauge.at).toISOString()
  return (
    <div>
      <div className="flex items-center gap-2">
        <CloudRain className="h-5 w-5 shrink-0" style={{ color: colorOf(gauge) }} aria-hidden="true" />
        <span className="text-base font-semibold text-slate-900">
          {t('rain.gaugeCard.title', { label: labelOf(gauge), when: gaugeWhen(gauge) })}
        </span>
      </div>
      <div className="mt-1 text-sm text-slate-800">
        {gauge.river ? gaugeName(gauge) : gauge.station}
      </div>
      <div className="mt-2 text-sm text-slate-800">{t('rain.gaugeCard.measured', { text: measuredText(gauge) })}</div>
      <div className="mt-1 text-xs text-slate-600">
        {t('common.reading', { time: sriLankaTime(iso), ago: timeAgo(iso) })}
      </div>
      <div className="mt-2 text-[11px] leading-tight text-slate-500">{GAUGE_RAIN_CREDIT}</div>
    </div>
  )
}
