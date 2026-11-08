import { useEffect, useState } from 'react'
import { Phone, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EMERGENCY_LAST_CHECKED, emergencyNumbers, telHref, type EmergencyNumber } from '../lib/emergencyNumbers'
import { dayMonthYear } from '../lib/time'

type Props = { onClose: () => void }

// One big tap-to-call button. A tap opens the phone's dialler (or its "Call?" prompt) with the
// number filled in, and nothing is dialled until the person confirms there.
function CallButton({ item, size }: { item: EmergencyNumber; size: 'main' | 'short' | 'landline' }) {
  const { t } = useTranslation()
  const name = t(item.nameKey)
  const look =
    size === 'main'
      ? 'min-h-28 bg-red-600 text-white active:bg-red-700'
      : 'min-h-20 border-2 border-slate-300 bg-white text-slate-900 active:bg-slate-100'
  const number = size === 'main' ? 'text-6xl' : size === 'short' ? 'text-4xl' : 'text-2xl'

  return (
    <a
      href={telHref(item.number)}
      aria-label={t('emergency.call', { name, number: item.display })}
      className={`flex w-full items-center gap-4 rounded-2xl px-4 py-3 ${look}`}
    >
      <Phone className={size === 'main' ? 'h-9 w-9 shrink-0' : 'h-7 w-7 shrink-0'} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className={`block font-bold leading-none tabular-nums ${number}`}>{item.display}</span>
        <span className={`mt-1 block text-base leading-snug ${size === 'main' ? 'text-white' : 'text-slate-700'}`}>{name}</span>
      </span>
    </a>
  )
}

// Needs no network: the numbers are in the app itself, and this screen is kept for offline use
// along with the rest of the app's files.
export default function EmergencyPanel({ onClose }: Props) {
  const { t } = useTranslation()
  // Read once, so the dev fake switch can't change the list while it is open
  const [numbers] = useState(emergencyNumbers)
  const [main, ...rest] = numbers
  const shortCodes = rest.filter((n) => n.group === 'short')
  const landlines = numbers.filter((n) => n.group === 'landline')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" aria-label={t('emergency.title')} className="fixed inset-0 z-[1300] overflow-y-auto bg-white">
      <div className="mx-auto flex min-h-full max-w-md flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {/* Stays at the top while the list scrolls. The solid white keeps the numbers from showing
            through, and the top padding (for a phone's notch) is part of it so it is covered too. */}
        <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b border-slate-200 bg-white px-4 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <h2 className="text-xl font-bold text-slate-900">{t('emergency.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-700 active:bg-slate-100"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 rounded-xl bg-red-50 px-3 py-3 text-lg font-semibold leading-snug text-red-900">
          {t('emergency.inDanger')}
        </p>

        <div className="mt-4 space-y-3">
          <CallButton item={main} size="main" />
          {shortCodes.map((n) => (
            <CallButton key={n.id} item={n} size="short" />
          ))}
        </div>
        <p className="mt-3 text-sm leading-snug text-slate-700">{t('emergency.shortNote')}</p>

        <h3 className="mt-6 text-base font-semibold text-slate-900">{t('emergency.landlines')}</h3>
        <div className="mt-2 space-y-3">
          {landlines.map((n) => (
            <CallButton key={n.id} item={n} size="landline" />
          ))}
        </div>

        <p className="mt-6 text-sm text-slate-600">
          {t('emergency.lastChecked', { date: dayMonthYear(EMERGENCY_LAST_CHECKED) })}
        </p>
      </div>
    </div>
  )
}
