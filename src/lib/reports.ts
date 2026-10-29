import type { HazardType, Severity } from './hazards'
import { ensureAnonymousSession } from './session'
import { supabase } from './supabase'

export const NOTE_MAX_LENGTH = 280

type NewReport = {
  hazardType: HazardType
  severity: Severity
  note: string
  lat: number
  lng: number
}

// Returns null on success, or a message that is safe to show the user
export async function submitReport(report: NewReport): Promise<string | null> {
  try {
    await ensureAnonymousSession()
  } catch {
    return 'Couldn’t send your report. Please try again.'
  }

  const { error } = await supabase.from('reports').insert({
    hazard_type: report.hazardType,
    severity: report.severity,
    note: report.note.trim() || null,
    // PostGIS wants longitude first
    location: `SRID=4326;POINT(${report.lng} ${report.lat})`,
  })

  if (!error) return null

  // Match on the constraint name and the RLS wording, since the error code
  // alone (42501 / 23514) can mean other things too
  if (error.message.includes('reports_location_in_sri_lanka')) {
    return 'That spot is outside Sri Lanka. Move the pin and try again.'
  }
  if (error.message.includes('row-level security')) {
    return 'You’ve sent too many reports. You can send up to 10 an hour, so please try again later.'
  }
  return 'Couldn’t send your report. Please try again.'
}
