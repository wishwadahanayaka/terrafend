import { ChevronRight, Newspaper } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { newsAriaLabel } from '../lib/news'
import { useNewsChip } from '../lib/useNewsChip'

// "Disaster news (4)" at the top of the Layers panel, under the serious items. Its own file so the
// news code is only downloaded when the news feed is switched on (see newsFlag.ts).
export default function NewsEntry({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  const news = useNewsChip(true)
  if (!news) return null
  const label = news.count ? t('news.layersEntryCount', { count: news.count }) : t('news.layersEntry')
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={newsAriaLabel(news.count, news.officialRecent)}
      className="mx-0 mb-1 flex min-h-12 w-full items-center gap-3 rounded-lg border-b border-slate-200 px-2 py-2 text-left active:bg-slate-100"
    >
      <span className="relative text-slate-600">
        <Newspaper className="h-5 w-5" aria-hidden="true" />
        {/* An official notice came out in the last 24 hours */}
        {news.officialRecent && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-white bg-red-600" />
        )}
      </span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{label}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  )
}
