import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider, type Persister } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import './index.css'
import App from './App.tsx'
import { startI18n } from './i18n'
import { dropOldQueries, SAVED_MAX_AGE_MS, shouldSaveQuery } from './lib/offline'

const queryClient = new QueryClient()

// The library starts out thinking it is online. A page opened without a connection
// (from the saved app) must know at once, so its requests wait instead of failing.
onlineManager.setOnline(navigator.onLine)

// The dev switches (?fakeRiver=, ?fakeRainMap=, ...) change the data after it is loaded,
// so with any of them on, only the island forecast is saved and restored, in a file of its own
// (the normal one is left alone). It is safe because the fake rain is put on top of the forecast
// when it is drawn, so reloads while testing reuse it instead of asking Open-Meteo every time.
// Everything else stays unsaved, so test data never turns up later in a normal session.
const usingFakes = import.meta.env.DEV && [...new URLSearchParams(location.search).keys()].some((k) => k.startsWith('fake'))

// Where the last loaded data is kept on the phone. Null if the browser won't allow it
// (some private windows), in which case the app just works without saved data.
function makePersister(): Persister | null {
  // ?fakeForecastCache= tests how the forecast is loaded, so saved data would only hide it
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('fakeForecastCache')) return null
  try {
    const saver = createSyncStoragePersister({
      storage: window.localStorage,
      key: usingFakes ? 'terrafend:saved-data-dev' : 'terrafend:saved-data',
    })
    return {
      persistClient: saver.persistClient,
      removeClient: saver.removeClient,
      restoreClient: async () => {
        const saved = await saver.restoreClient()
        return saved && dropOldQueries(saved, Date.now(), usingFakes)
      },
    }
  } catch {
    return null
  }
}
const persister = makePersister()

// Sign in up front so the first report doesn't have to wait for it. Loaded
// separately so the map can appear before the Supabase code has arrived.
// Offline there is nothing to sign in to. It happens when the connection returns.
function signIn() {
  import('./lib/session')
    .then((m) => m.ensureAnonymousSession())
    .catch((err) => console.error('Anonymous sign-in failed:', err))
}
if (navigator.onLine) signIn()
else window.addEventListener('online', signIn, { once: true })

const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

// The chosen language is loaded before the first screen is drawn, so nothing flashes in English.
// If it can't be loaded (offline, never cached) English is used.
await startI18n().catch(() => {})

createRoot(document.getElementById('root')!).render(
  persister ? (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: SAVED_MAX_AGE_MS,
        buster: __BUILD_ID__,
        dehydrateOptions: { shouldDehydrateQuery: (query) => shouldSaveQuery(query.queryKey, query.state, usingFakes) },
      }}
    >
      {app}
    </PersistQueryClientProvider>
  ) : (
    <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>
  ),
)
