import { t } from '../i18n'
import type { HazardType, Severity } from './hazards'
import { DUPLICATE_RADIUS_M, severityResultFor, type SeverityResult } from './duplicates'
import { rememberMyReport } from './myReports'
import { ensureAnonymousSession } from './session'
import { supabase } from './supabase'

export const NOTE_MAX_LENGTH = 280

export type Vote = 'still_there' | 'gone'

type NewReport = {
  hazardType: HazardType
  severity: Severity
  note: string
  photoPath: string | null
  lat: number
  lng: number
}

// Returns null on success, or a message that is safe to show the user
export async function submitReport(report: NewReport): Promise<string | null> {
  try {
    await ensureAnonymousSession()
  } catch {
    return t('errors.sendReport')
  }

  const { data, error } = await supabase.from('reports').insert({
    hazard_type: report.hazardType,
    severity: report.severity,
    note: report.note.trim() || null,
    photo_path: report.photoPath,
    // PostGIS wants longitude first
    location: `SRID=4326;POINT(${report.lng} ${report.lat})`,
  }).select('id').single()

  if (!error) {
    // So the map keeps showing it even if the Reports layer would hide it (see myReports.ts)
    if (data?.id) rememberMyReport(data.id)
    return null
  }

  // Match on the constraint name and the RLS wording, since the error code
  // alone (42501 / 23514) can mean other things too
  if (error.message.includes('reports_location_in_sri_lanka')) {
    return t('errors.outsideSriLanka')
  }
  if (error.message.includes('row-level security')) {
    return t('errors.tooManyReports')
  }
  return t('errors.sendReport')
}

export type VoteResult = 'ok' | 'already_voted' | 'inactive' | 'failed'

export const VOTE_ERRORS: Record<Exclude<VoteResult, 'ok'>, string> = {
  get already_voted() {
    return t('errors.alreadyVoted')
  },
  get inactive() {
    return t('errors.inactive')
  },
  get failed() {
    return t('errors.sendVote')
  },
}

// user_id fills itself in from the session, so only report_id and vote are sent
export async function submitVote(reportId: string, vote: Vote): Promise<VoteResult> {
  try {
    await ensureAnonymousSession()
  } catch {
    return 'failed'
  }

  const { error } = await supabase.from('report_votes').insert({ report_id: reportId, vote })

  if (!error) return 'ok'
  // 23505 is Postgres' unique violation: one vote per user per report
  if (error.code === '23505') return 'already_voted'
  if (error.message.includes('row-level security')) return 'inactive'
  return 'failed'
}

// An active report of the same type close to where the new one would go
export type SimilarReport = {
  id: string
  hazard_type: HazardType
  severity: Severity
  lat: number
  lng: number
  created_at: string
  expires_at: string
  severity_updated_at?: string | null
  distance_m: number
}

// Nearest first. Runs as the signed-in user, so the read rules apply. Test reports from
// ?fakeNearby= stand in for the database in dev (see fakeNearby.ts).
export async function fetchSimilar(lat: number, lng: number, hazardType: HazardType): Promise<SimilarReport[]> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('fakeNearby')) {
    return (await import('./fakeNearby')).fakeSimilar(lat, lng, hazardType)
  }
  await ensureAnonymousSession()
  const { data, error } = await supabase.rpc('similar_reports_nearby', {
    p_lat: lat,
    p_lng: lng,
    p_hazard_type: hazardType,
    p_radius_m: DUPLICATE_RADIUS_M,
  })
  if (error) throw error
  return data as SimilarReport[]
}

export async function submitSeverity(reportId: string, severity: Severity): Promise<SeverityResult> {
  try {
    await ensureAnonymousSession()
  } catch {
    return 'failed'
  }
  const { error } = await supabase.rpc('update_report_severity', { p_report_id: reportId, p_severity: severity })
  return error ? severityResultFor(error.message) : 'ok'
}

const SEVERITY_ERRORS: Record<Exclude<SeverityResult, 'ok'>, () => string> = {
  already_updated: () => t('errors.alreadyUpdated'),
  needs_still_there: () => t('errors.needsStillThere'),
  too_many: () => t('errors.tooManyUpdates'),
  inactive: () => t('errors.inactive'),
  failed: () => t('errors.sendUpdate'),
}

// A test report from ?fakeNearby= isn't in the database, so there is nothing to send to
const isFake = (reportId: string) => import.meta.env.DEV && reportId.startsWith('fake-')

export type DuplicateOutcome =
  // "gone" means the report ran out or was cleared, so the question should be asked again
  { done: true } | { done: false; message: string; gone: boolean }

// "Yes, it's still there": a "still there" vote on the existing report, nothing new
export async function confirmExisting(reportId: string): Promise<DuplicateOutcome> {
  const result = isFake(reportId) ? 'ok' : await submitVote(reportId, 'still_there')
  if (result === 'ok') return { done: true }
  return { done: false, message: VOTE_ERRORS[result], gone: result === 'inactive' }
}

// "Same one, but it's worse (or better) now": the same vote, then the new severity.
// Someone who already voted "still there" goes straight to the severity. If the vote goes
// through and the severity doesn't, the vote still counts and the message says why.
export async function confirmAndChange(reportId: string, severity: Severity): Promise<DuplicateOutcome> {
  if (isFake(reportId)) return { done: true }

  const vote = await submitVote(reportId, 'still_there')
  if (vote !== 'ok' && vote !== 'already_voted') {
    return { done: false, message: VOTE_ERRORS[vote], gone: vote === 'inactive' }
  }

  const result = await submitSeverity(reportId, severity)
  if (result === 'ok') return { done: true }
  return { done: false, message: SEVERITY_ERRORS[result](), gone: result === 'inactive' }
}
