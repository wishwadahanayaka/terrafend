import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { ensureAnonymousSession } from './lib/session'

const queryClient = new QueryClient()

// Sign in up front so the first report doesn't have to wait for it
ensureAnonymousSession().catch((err) => console.error('Anonymous sign-in failed:', err))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
