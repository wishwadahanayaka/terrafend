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
// Same for the "How to help" screen: its words are in the app, only its links need a connection
const HelpPanel = lazy(() => import('./components/HelpPanel'))

export default function App() {
  // Redraws the whole app when the language changes, including text worked out outside React
  useTranslation()
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const openEmergency = () => setEmergencyOpen(true)
  const openHelp = () => setHelpOpen(true)

  return (
    <div className="flex h-dvh w-full flex-col">
      <OfflineBanner />
      <div className="relative min-h-0 flex-1">
        <HazardMap onOpenEmergency={openEmergency} onOpenHelp={openHelp} />
        <Banner onOpenEmergency={openEmergency} />
      </div>
      {emergencyOpen && (
        <Suspense fallback={null}>
          {/* Help can open on top of this screen. Escape then closes only the top one. */}
          <EmergencyPanel
            onClose={() => {
              if (!helpOpen) setEmergencyOpen(false)
            }}
            onOpenHelp={openHelp}
          />
        </Suspense>
      )}
      {helpOpen && (
        <Suspense fallback={null}>
          <HelpPanel onClose={() => setHelpOpen(false)} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <UpdatePrompt />
      </Suspense>
    </div>
  )
}
