import { useTranslation } from 'react-i18next'
import { LANDSLIDE_CREDIT, type Level } from '../lib/landslide'
import { fadeWhenCardOpen } from '../lib/useCardOpen'
import LevelSwatch from './LevelSwatch'

type Props = {
  // Only the levels that are drawn right now, highest first
  levels: Level[]
  // Tailwind bottom-* class, so it sits just above the rain label (written in full for Tailwind)
  bottomClass: string
  cardOpen: boolean
}

// The small key to the landslide areas, bottom left, shown only while they are drawn
export default function LandslideLegend({ levels, bottomClass, cardOpen }: Props) {
  const { t } = useTranslation()
  return (
    <div
      inert={cardOpen}
      className={`absolute left-4 z-[1000] max-w-[calc(100%-6.5rem)] rounded-xl bg-white/95 px-3 py-2 text-[11px] leading-tight text-slate-800 shadow-lg ${bottomClass} ${fadeWhenCardOpen(cardOpen)}`}
    >
      <p className="font-semibold">{t('landslide.legendTitle')}</p>
      <ul className="mt-1 space-y-1">
        {levels.map((level) => (
          <li key={level} className="flex items-center gap-1.5">
            <LevelSwatch level={level} />
            <span>{t(`landslide.level.${level}`)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] text-slate-500">{LANDSLIDE_CREDIT}</p>
    </div>
  )
}
