import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'
import { ensureAnonymousSession } from './lib/session'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Temporary connection test, remove once the app really loads reports.
// Runs here instead of in a component so it only fires once.
async function testConnection() {
  try {
    await ensureAnonymousSession()
    const { data, error } = await supabase.rpc('reports_in_view', {
      min_lng: 79.4,
      min_lat: 5.7,
      max_lng: 82.1,
      max_lat: 10.0,
    })
    if (error) throw error
    console.log(`Supabase connected. Reports in Sri Lanka: ${data.length}`)
  } catch (err) {
    console.error('Supabase connection test failed:', err)
  }
}

testConnection()
