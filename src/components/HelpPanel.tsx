import { useEffect } from 'react'
import { ExternalLink, ShieldAlert, WifiOff, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  domainOf,
  HELP_LAST_CHECKED,
  HELP_ORGANISATIONS,
  safeLinks,
  type HelpLink,
  type HelpOrganisation,
} from '../lib/helpOrganisations'
import { dayMonthYear } from '../lib/time'
import { useOnline } from '../lib/useOnline'

type Props = { onClose: () => void }

// A link out to the organisation's own website. It opens in a new tab and says where it goes.
function LinkButton({ link, name }: { link: HelpLink; name: string }) {
  const { t } = useTranslation()
  const action = t(`help.${link.kind}`)
  const domain = domainOf(link.url)
  const look =
    link.kind === 'volunteer'
      ? 'border-2 border-blue-600 bg-white text-blue-700 active:bg-blue-50'
      : 'border-2 border-blue-600 bg-blue-600 text-white active:bg-blue-700'

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('help.linkLabel', { action, name, domain })}
      className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-2 ${look}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold leading-tight">{action}</span>
        <span className={`mt-0.5 block text-sm leading-tight ${link.kind === 'volunteer' ? 'text-blue-700' : 'text-blue-100'}`}>
          {domain}
        </span>
      </span>
      <ExternalLink className="h-5 w-5 shrink-0" aria-hidden="true" />
    </a>
  )
}

function Organisation({ org }: { org: HelpOrganisation }) {
  const { t } = useTranslation()
  const name = t(org.nameKey)

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <h3 className="text-lg font-bold leading-tight text-slate-900">{name}</h3>
      <p className="mt-1 text-base leading-snug text-slate-800">{t(org.whatKey)}</p>
      {org.noteKey && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-snug text-amber-900">{t(org.noteKey)}</p>
      )}
      <div className="mt-3 space-y-2">
        {safeLinks(org).map((link) => (
          <LinkButton key={link.kind} link={link} name={name} />
        ))}
      </div>
    </section>
  )
}

// All the words are in the app itself, so this opens offline. Only the links need a connection.
export default function HelpPanel({ onClose }: Props) {
  const { t } = useTranslation()
  const online = useOnline()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Above the emergency numbers screen (z 1300), since it can be opened from there
  return (
    <div role="dialog" aria-modal="true" aria-label={t('help.title')} className="fixed inset-0 z-[1400] overflow-y-auto bg-white">
      <div className="mx-auto flex min-h-full max-w-md flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b border-slate-200 bg-white px-4 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <h2 className="text-xl font-bold text-slate-900">{t('help.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-700 active:bg-slate-100"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* Always shown, whatever else is on the screen */}
        <div className="mt-3 flex gap-3 rounded-xl border-2 border-red-300 bg-red-50 px-3 py-3 text-red-900">
          <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
          <p className="text-base font-semibold leading-snug">{t('help.safety')}</p>
        </div>

        {!online && (
          <p role="status" className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm leading-snug text-amber-900">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('help.offline')}
          </p>
        )}

        <div className="mt-4 space-y-4">
          {HELP_ORGANISATIONS.map((org) => (
            <Organisation key={org.id} org={org} />
          ))}
        </div>

        <p className="mt-6 text-sm text-slate-600">{t('help.lastChecked', { date: dayMonthYear(HELP_LAST_CHECKED) })}</p>
      </div>
    </div>
  )
}
