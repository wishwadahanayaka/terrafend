import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import Banner from './components/Banner'
import HazardMap from './components/HazardMap'
import OfflineBanner from './components/OfflineBanner'

// Registers the service worker and shows the "new version" prompt. Loaded after the
// map, since nothing on the first screen depends on it.
const UpdatePrompt = lazy(() => import('./components/UpdatePrompt'))

export default function App() {
  // Redraws the whole app when the language changes, including text worked out outside React
  useTranslation()
  return (
    <div className="flex h-dvh w-full flex-col">
      <OfflineBanner />
      <div className="relative min-h-0 flex-1">
        <HazardMap />
        <Banner />
      </div>
      <Suspense fallback={null}>
        <UpdatePrompt />
      </Suspense>
    </div>
  )
}
