import { Clock, History } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { otherView, type RainView } from '../lib/rainView'
import { fadeWhenCardOpen } from '../lib/useCardOpen'

type Props = {
  view: RainView
  onChange: (view: RainView) => void
  // Tailwind bottom-* class, so it sits level with the locate button on the other side
  bottomClass: string
  cardOpen: boolean
}

// A small label at the bottom left saying which rain the map is showing. Tapping it shows the
// other one. It is down there, not at the top, because the top right is full of buttons and the
// threats chip.
export default function RainViewLabel({ view, onChange, bottomClass, cardOpen }: Props) {
  const { t } = useTranslation()
  const past = view === 'past'
  const Icon = past ? History : Clock

  return (
    <button
      type="button"
      inert={cardOpen}
      onClick={() => onChange(otherView(view))}
      aria-label={`${t(past ? 'rainView.labelPast' : 'rainView.labelNext')}. ${t('rainView.tapToSwitch')}`}
      title={t('rainView.tapToSwitch')}
      className={`absolute left-4 z-[1000] flex min-h-11 max-w-[calc(100%-6.5rem)] items-center gap-2 rounded-full bg-white px-3 py-1 text-left text-xs font-semibold leading-tight text-slate-800 shadow-lg active:bg-slate-100 ${bottomClass} ${fadeWhenCardOpen(cardOpen)}`}
    >
      <Icon className="h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
      {t(past ? 'rainView.labelPast' : 'rainView.labelNext')}
    </button>
  )
}
