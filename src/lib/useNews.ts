import { useQuery } from '@tanstack/react-query'
import { loadNews, newsQueryOptions } from './newsFetch'
import { NEWS_KEY } from './queryKeys'

// The disaster news headlines. The chip and the news sheet share this one query. Pass true while the
// sheet is open, so it asks every 5 minutes instead of every 10.
export function useNews(sheetOpen = false, enabled = true) {
  return useQuery({
    queryKey: [NEWS_KEY],
    queryFn: () => loadNews(),
    enabled,
    ...newsQueryOptions(sheetOpen),
  })
}
