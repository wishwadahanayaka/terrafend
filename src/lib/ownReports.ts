import { t } from '../i18n'
import type { Severity } from './hazards'
import { forgetMyReport } from './myReports'
import { cleanNote, myReportResultFor, type MyReportResult } from './myReportsList'
import { ensureAnonymousSession } from './session'
import { supabase } from './supabase'

// Test reports from ?fakeMyReports=1 aren't in the database, so they are changed in memory
const isFake = (id: string) => import.meta.env.DEV && id.startsWith('fake-')

async function call(name: 'clear_my_report' | 'edit_my_report', args: Record<string, unknown>): Promise<MyReportResult> {
  try {
    await ensureAnonymousSession()
  } catch {
    return 'failed'
  }
  const { error } = await supabase.rpc(name, args)
  return error ? myReportResultFor(error.message) : 'ok'
}

// Takes the report off the map. The database sets its expiry to now, and the hourly cleanup
// removes the row and photo later. It is forgotten on this phone too.
export async function clearMyReport(id: string): Promise<MyReportResult> {
  let result: MyReportResult
  if (isFake(id)) {
    ;(await import('./fakeMyReports')).fakeClearMyReport(id)
    result = 'ok'
  } else {
    result = await call('clear_my_report', { p_id: id })
  }
  // A report that is already over is off the map too, so it is forgotten in that case as well
  if (result === 'ok' || result === 'inactive') forgetMyReport(id)
  return result
}

export async function editMyReport(id: string, severity: Severity, note: string): Promise<MyReportResult> {
  if (isFake(id)) {
    ;(await import('./fakeMyReports')).fakeEditMyReport(id, severity, note)
    return 'ok'
  }
  return call('edit_my_report', { p_id: id, p_severity: severity, p_note: cleanNote(note) })
}

const ERRORS: Record<'clear' | 'edit', Record<Exclude<MyReportResult, 'ok'>, () => string>> = {
  clear: {
    inactive: () => t('errors.inactive'),
    too_many: () => t('errors.sendClear'),
    failed: () => t('errors.sendClear'),
  },
  edit: {
    inactive: () => t('errors.inactive'),
    too_many: () => t('errors.tooManyEdits'),
    failed: () => t('errors.sendEdit'),
  },
}

export const myReportError = (action: 'clear' | 'edit', result: Exclude<MyReportResult, 'ok'>) =>
  ERRORS[action][result]()
