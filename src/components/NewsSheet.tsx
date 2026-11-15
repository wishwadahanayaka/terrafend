import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Phone, ShieldCheck, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Hazard } from '../../supabase/functions/news-refresh/hazards'
import { LANGUAGES } from '../i18n/languages'
import { loadNewsFilter, saveNewsFilter } from '../lib/layerSettings'
import {
  channelName,
  groupNews,
  isPdfLink,
  newsHazardName,
  siteOf,
  sourceName,
  type NewsItem,
  type Story,
} from '../lib/news'
import type { NewsFilter } from '../lib/newsFilter'
import { sriLankaWhen, timeAgo } from '../lib/time'
import { useMinuteClock } from '../lib/useMinuteClock'
import { useNews } from '../lib/useNews'
import { useOnline } from '../lib/useOnline'

type Props = {
  onClose: () => void
  // Opens the emergency numbers screen, which sits on top of this one
  onOpenEmergency: () => void
}

const FILTERS: NewsFilter[] = ['all', 'en', 'si', 'ta']

// Links to the publishers' own pages. They open in a new tab, and "noopener noreferrer" keeps the
// page they open from reaching back into this one.
const linkProps = { target: '_blank', rel: 'noopener noreferrer' } as const

export default function NewsSheet({ onClose, onOpenEmergency }: Props) {
  const { t } = useTranslation()
  const online = useOnline()
  // Asked every 5 minutes instead of 10 while this is open
  const query = useNews(true)
  const now = useMinuteClock()
  const [filter, setFilterState] = useState<NewsFilter>(loadNewsFilter)
  // The hazards whose "Show N more" has been tapped
  const [expanded, setExpanded] = useState<Hazard[]>([])

  const items = query.data
  const grouped = useMemo(() => (items ? groupNews(items, { now, language: filter }) : null), [items, now, filter])

  function setFilter(next: NewsFilter) {
    setFilterState(next)
    saveNewsFilter(next)
  }

  // Escape closes this, but not when the emergency numbers (or another full screen) are on top of it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const loadedAt = query.dataUpdatedAt > 0 ? sriLankaWhen(query.dataUpdatedAt, now) : null
  // Nothing to show and the load has failed. While it tries again the query goes back to "pending",
  // so this looks at whether it has ever failed, or the message would flip to "Loading" and back.
  const failed = !items && query.errorUpdatedAt > 0

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('news.title')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between px-4 pb-1 pt-4">
          <h2 className="text-lg font-semibold text-slate-900">{t('news.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* When these headlines were loaded, or why they may be old */}
          {items && loadedAt && !online && (
            <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('news.offlineSaved', { when: loadedAt })}
            </p>
          )}
          {items && loadedAt && online && query.isError && (
            <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('news.refreshFailed', { when: loadedAt })}
            </p>
          )}
          {items && loadedAt && online && !query.isError && (
            <p className="mb-3 text-xs text-slate-600">{t('news.updated', { when: loadedAt })}</p>
          )}

          {!items && !online && (
            <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('news.offlineNone')}
            </p>
          )}
          {!items && online && !failed && query.isPending && (
            <p role="status" className="py-6 text-center text-sm text-slate-600">
              {t('news.loading')}
            </p>
          )}
          {failed && online && (
            <div role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {t('news.unavailable')}
              <button
                type="button"
                onClick={() => query.refetch()}
                disabled={query.isFetching}
                className="mt-1 block h-11 text-sm font-medium text-blue-700 disabled:opacity-50"
              >
                {t('common.tryAgain')}
              </button>
            </div>
          )}

          {grouped && (
            <>
              {/* Which language the news reports are in. The official notices below are always all shown. */}
              <div role="radiogroup" aria-label={t('news.filterLabel')} className="mb-3 flex gap-1.5">
                {FILTERS.map((option) => {
                  const language = LANGUAGES.find((l) => l.code === option)
                  const selected = filter === option
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      lang={language?.code}
                      onClick={() => setFilter(option)}
                      // The three languages are short (EN, සිං, த), so they get a fixed width and "All"
                      // takes the rest: its Tamil word is the longest and would be clipped in an equal share
                      className={`min-h-11 whitespace-nowrap rounded-lg border px-1.5 text-sm font-semibold ${
                        language ? 'w-12 flex-none' : 'min-w-0 flex-1'
                      } ${selected ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-800 active:bg-slate-100'}`}
                    >
                      <span aria-hidden={language ? 'true' : undefined}>{language ? language.short : t('news.filterAll')}</span>
                      {language && <span className="sr-only">{language.name}</span>}
                    </button>
                  )
                })}
              </div>

              {grouped.official.length === 0 && grouped.groups.length === 0 && filter === 'all' ? (
                <p className="rounded-xl bg-slate-100 px-4 py-6 text-center text-sm text-slate-700">{t('news.empty')}</p>
              ) : (
                <>
                  {grouped.official.length > 0 && (
                    <section aria-label={t('news.officialHeading')} className="mb-4">
                      <ul className="space-y-2">
                        {grouped.official.map((item) => (
                          <OfficialItem key={item.id} item={item} now={now} />
                        ))}
                      </ul>
                    </section>
                  )}

                  <section aria-label={t('news.reportsHeading')}>
                    <h3 className="mb-2 text-sm font-semibold text-slate-900">{t('news.reportsHeading')}</h3>
                    {grouped.groups.length === 0 && (
                      <p className="rounded-xl bg-slate-100 px-4 py-4 text-center text-sm text-slate-700">
                        {filter === 'all' ? t('news.emptyReports') : t('news.emptyLanguage')}
                      </p>
                    )}
                    {grouped.groups.map((group) => {
                      const open = expanded.includes(group.hazard)
                      const stories = open ? [...group.visible, ...group.more] : group.visible
                      return (
                        <div key={group.hazard} className="mb-4">
                          <h4 className="mb-1.5 text-sm font-semibold text-slate-700">{newsHazardName(group.hazard)}</h4>
                          <ul className="space-y-2">
                            {stories.map((story) => (
                              <StoryItem key={story.main.id} story={story} now={now} />
                            ))}
                          </ul>
                          {group.more.length > 0 && (
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() =>
                                setExpanded((current) => (open ? current.filter((h) => h !== group.hazard) : [...current, group.hazard]))
                              }
                              className="mt-1 flex min-h-11 items-center text-sm font-medium text-blue-700 active:opacity-60"
                            >
                              {open ? t('news.showLess') : t('news.showMore', { count: group.more.length })}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </section>
                </>
              )}
            </>
          )}

          <footer className="mt-2 border-t border-slate-200 pt-3 text-xs leading-snug text-slate-600">
            <p>{t('news.footerAuto')}</p>
            <p className="mt-1">{t('news.footerOfficial')}</p>
            <button
              type="button"
              onClick={onOpenEmergency}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-red-300 px-3 text-sm font-semibold text-red-700 active:bg-red-50"
            >
              <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('emergency.button')}
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}

// An official notice: blue border and a shield, who it is from, and when it was issued. The fixed
// channels (a situation report, a Met Department advisory) are named in the person's language; DMC's
// own headlines stay as written.
function OfficialItem({ item, now }: { item: NewsItem; now: number }) {
  const { t } = useTranslation()
  const label = item.channel ? channelName(item.channel) : item.title
  return (
    <li className="rounded-lg border-l-4 border-blue-600 bg-blue-50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-900">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{t('news.officialFrom', { source: sourceName(item.source) })}</span>
      </p>
      <p lang={item.channel ? undefined : item.language} className="mt-1 text-sm font-semibold leading-snug text-slate-900">
        {label}
      </p>
      <p className="mt-0.5 text-xs text-slate-700">{t('news.issued', { when: sriLankaWhen(item.publishedAt, now) })}</p>
      <a
        href={item.url}
        {...linkProps}
        className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-blue-700 underline"
      >
        {isPdfLink(item.url) ? t('news.openNotice') : t('news.readOn', { site: siteOf(item.url) })}
        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="sr-only">{t('news.newTab')}</span>
      </a>
    </li>
  )
}

// One news story: the headline in its own language (a link to the publisher), a label for that
// language, who reported it and how long ago, anyone else who did, and the grey line saying it is
// not an official warning.
function StoryItem({ story, now }: { story: Story; now: number }) {
  const { t } = useTranslation()
  const { main, also } = story
  const language = LANGUAGES.find((l) => l.code === main.language)
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <a
        href={main.url}
        {...linkProps}
        lang={main.language}
        className="text-[15px] font-semibold leading-snug text-slate-900 underline-offset-2 hover:underline"
      >
        {main.title}
        <ExternalLink className="ml-1 inline h-3.5 w-3.5 align-[-1px] text-slate-500" aria-hidden="true" />
        <span className="sr-only">{t('news.newTab')}</span>
      </a>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-600">
        {language && (
          <span className="rounded bg-slate-100 px-1 font-semibold text-slate-700" lang={language.code}>
            <span aria-hidden="true">{language.short}</span>
            <span className="sr-only">{language.name}</span>
          </span>
        )}
        <span>
          {sourceName(main.source)} &middot; {timeAgo(new Date(main.publishedAt).toISOString(), now)}
        </span>
      </p>
      {also.length > 0 && (
        <p className="mt-0.5 text-xs text-slate-600">{t('news.also', { sources: also.map(sourceName).join(', ') })}</p>
      )}
      <p className="mt-1 text-[11px] text-slate-500">{t('news.notOfficial')}</p>
    </li>
  )
}
