import { supabase } from './supabase'

let pending: Promise<void> | null = null

// Shared promise so two callers (or React StrictMode's double run in dev)
// can't create two anonymous users at once.
export function ensureAnonymousSession(): Promise<void> {
  pending ??= (async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) return

    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  })().catch((err) => {
    pending = null
    throw err
  })
  return pending
}
