import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient()

// Sign in up front so the first report doesn't have to wait for it. Loaded
// separately so the map can appear before the Supabase code has arrived.
import('./lib/session')
  .then((m) => m.ensureAnonymousSession())
  .catch((err) => console.error('Anonymous sign-in failed:', err))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
