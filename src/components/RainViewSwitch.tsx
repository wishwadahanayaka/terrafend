import { History, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RainView } from '../lib/rainView'
import { useRainViewCounts } from '../lib/useRainViewCounts'

type Props = {
  view: RainView
  onChange: (view: RainView) => void
}

// Past 3 h (measured) or Next 3 h (forecast). The map shows one at a time, so the two never
// mix. The half that isn't showing says how many serious things it holds ("Past 3 h · 2 serious"),
// so nothing important is hidden without a sign.
export default function RainViewSwitch({ view, onChange }: Props) {
  const { t } = useTranslation()
  const counts = useRainViewCounts()

  const options: { value: RainView; label: string; kind: string; Icon: typeof History }[] = [
    { value: 'past', label: t('rainView.past'), kind: t('rainView.pastKind'), Icon: History },
    { value: 'next', label: t('rainView.next'), kind: t('rainView.nextKind'), Icon: Clock },
  ]

  return (
    <div role="radiogroup" aria-label={t('rainView.title')} className="mx-2 mb-1 grid grid-cols-2 gap-1.5">
      {options.map(({ value, label, kind, Icon }) => {
        const selected = view === value
        const hiddenCount = selected ? 0 : counts[value]
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(value)}
            className={`flex min-h-14 flex-col items-center justify-center rounded-lg border-2 px-1.5 py-1 text-center leading-tight ${
              selected ? 'border-sky-600 bg-sky-50 text-sky-800' : 'border-slate-200 text-slate-700 active:bg-slate-100'
            }`}
          >
            <span className="flex items-center gap-1 text-sm font-semibold">
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </span>
            <span className="text-xs">{kind}</span>
            {hiddenCount > 0 && (
              <span className="mt-0.5 rounded-full bg-red-600 px-2 py-px text-[11px] font-semibold text-white">
                {t('rainView.serious', { count: hiddenCount })}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
