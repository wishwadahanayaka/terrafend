import { useTranslation } from 'react-i18next'
import { useThreats } from '../lib/useThreats'

// The full list behind the threats chip, at the top of the Layers panel. The chip
// only has room for two lines, so this is where nothing gets cut off.
export default function ThreatList() {
  const { t } = useTranslation()
  const { parts } = useThreats()
  if (parts.length === 0) return null
  return (
    <div className="mx-2 mb-1 mt-1 border-b border-slate-200 pb-2">
      <p className="text-sm font-semibold text-slate-900">{t('layers.seriousNow')}</p>
      <ul className="mt-1.5 space-y-1">
        {parts.map((part) => (
          <li key={part.text} className="flex items-center gap-2 text-xs text-slate-800">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: part.color }}
              aria-hidden="true"
            />
            {part.text}
          </li>
        ))}
      </ul>
    </div>
  )
}
