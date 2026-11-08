import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Banner from './components/Banner'
import HazardMap from './components/HazardMap'
import OfflineBanner from './components/OfflineBanner'

// Registers the service worker and shows the "new version" prompt. Loaded after the
// map, since nothing on the first screen depends on it.
const UpdatePrompt = lazy(() => import('./components/UpdatePrompt'))
// The emergency numbers screen is needed only when someone opens it. The service worker keeps
// this file like all the others, so it opens offline too.
const EmergencyPanel = lazy(() => import('./components/EmergencyPanel'))

export default function App() {
  // Redraws the whole app when the language changes, including text worked out outside React
  useTranslation()
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const openEmergency = () => setEmergencyOpen(true)

  return (
    <div className="flex h-dvh w-full flex-col">
      <OfflineBanner />
      <div className="relative min-h-0 flex-1">
        <HazardMap onOpenEmergency={openEmergency} />
        <Banner onOpenEmergency={openEmergency} />
      </div>
      {emergencyOpen && (
        <Suspense fallback={null}>
          <EmergencyPanel onClose={() => setEmergencyOpen(false)} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <UpdatePrompt />
      </Suspense>
    </div>
  )
}
