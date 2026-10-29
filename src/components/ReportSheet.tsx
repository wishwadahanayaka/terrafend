import { useState } from 'react'
import { X } from 'lucide-react'
import { HAZARD_TYPES, SEVERITIES, type HazardType, type Severity } from '../lib/hazards'
import { NOTE_MAX_LENGTH, submitReport } from '../lib/reports'

type Props = {
  lat: number
  lng: number
  onClose: () => void
  onSent: () => void
}

export default function ReportSheet({ lat, lng, onClose, onSent }: Props) {
  const [hazardType, setHazardType] = useState<HazardType | null>(null)
  const [severity, setSeverity] = useState<Severity | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = hazardType !== null && severity !== null && !sending

  async function submit() {
    if (!hazardType || !severity) return
    setSending(true)
    setError(null)
    const message = await submitReport({ hazardType, severity, note, lat, lng })
    setSending(false)
    if (message) setError(message)
    else onSent()
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/40">
      <div
        role="dialog"
        aria-label="Report a hazard"
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-lg font-semibold text-slate-900">Report a hazard</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Only this middle part scrolls, so Submit stays in reach on short screens */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <p className="mb-2 text-sm font-medium text-slate-700">What is it?</p>
          <div className="grid grid-cols-3 gap-2">
            {HAZARD_TYPES.map(({ value, label, icon: Icon }) => {
              const selected = hazardType === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHazardType(value)}
                  aria-pressed={selected}
                  className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 text-center text-xs leading-tight ${
                    selected
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-700 active:bg-slate-100'
                  }`}
                >
                  <Icon className="h-6 w-6" aria-hidden="true" />
                  {label}
                </button>
              )
            })}
          </div>

          <p className="mb-2 mt-5 text-sm font-medium text-slate-700">Can vehicles get through?</p>
          <div className="grid grid-cols-3 gap-2">
            {SEVERITIES.map(({ value, label }) => {
              const selected = severity === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSeverity(value)}
                  aria-pressed={selected}
                  className={`min-h-14 rounded-xl border-2 px-1 text-sm leading-tight ${
                    selected
                      ? 'border-blue-600 bg-blue-50 font-medium text-blue-700'
                      : 'border-slate-200 text-slate-700 active:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <label htmlFor="report-note" className="mb-2 mt-5 block text-sm font-medium text-slate-700">
            Note (optional)
          </label>
          {/* 16px text stops iOS from zooming the page when the field is focused */}
          <textarea
            id="report-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            placeholder="Anything that helps, like which side of the road"
            className="w-full resize-none rounded-xl border-2 border-slate-200 p-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
          <p className="mt-1 text-right text-xs text-slate-500">
            {note.length}/{NOTE_MAX_LENGTH}
          </p>
        </div>

        <div className="border-t border-slate-200 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {error && (
            <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="h-14 w-full rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
          >
            {sending ? 'Sending...' : 'Submit report'}
          </button>
        </div>
      </div>
    </div>
  )
}
