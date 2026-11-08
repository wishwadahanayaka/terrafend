import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Camera, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hazardLabel, HAZARD_TYPES, severityLabel, SEVERITIES, type HazardType, type Severity } from '../lib/hazards'
import { shrinkPhoto, uploadPhoto } from '../lib/photos'
import { NOTE_MAX_LENGTH, submitReport } from '../lib/reports'
import { useOnline } from '../lib/useOnline'
import { useSimilarReports } from '../lib/useSimilarReports'
import DuplicateQuestion, { type Confirmed } from './DuplicateQuestion'

type Props = {
  lat: number
  lng: number
  onClose: () => void
  // A new report went in, or the person confirmed (or updated) one that was already there
  onSent: (what: { kind: 'report'; severity: Severity } | Confirmed) => void
}

export default function ReportSheet({ lat, lng, onClose, onSent }: Props) {
  const [hazardType, setHazardType] = useState<HazardType | null>(null)
  const [severity, setSeverity] = useState<Severity | null>(null)
  const [note, setNote] = useState('')
  const [stage, setStage] = useState<'idle' | 'uploading' | 'sending'>('idle')
  const [error, setError] = useState<string | null>(null)

  const [photo, setPhoto] = useState<{ file: File; previewUrl: string } | null>(null)
  const [preparing, setPreparing] = useState(false)
  // Kept so a retry after a failed send doesn't upload the same photo twice
  const uploadedPath = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const busy = stage !== 'idle'
  const { t } = useTranslation()
  const online = useOnline()

  // An active report of the same type within 100 m. The person has to answer the question
  // before sending a new report. If the lookup fails there is no question and nothing blocks.
  const similar = useSimilarReports(lat, lng, hazardType)
  const match = similar.data?.[0] ?? null
  const checking = hazardType !== null && similar.isPending && similar.fetchStatus === 'fetching'
  // The report this person said is a different one, so it isn't asked about again
  const [differentFrom, setDifferentFrom] = useState<string | null>(null)
  const needsAnswer = match !== null && differentFrom !== match.id
  const canSubmit = hazardType !== null && severity !== null && !busy && !preparing && online && !checking && !needsAnswer

  const question = useRef<HTMLDivElement>(null)
  const matchId = match?.id
  useEffect(() => {
    if (matchId) question.current?.scrollIntoView?.({ block: 'nearest' })
  }, [matchId])

  // Preview URLs hold the image in memory until revoked
  const previewUrl = useRef<string | null>(null)
  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
  }, [])

  function changePhoto(file: File | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = file ? URL.createObjectURL(file) : null
    setPhoto(file && previewUrl.current ? { file, previewUrl: previewUrl.current } : null)
    uploadedPath.current = null
  }

  async function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so choosing the same file again still fires onChange
    if (!file) return

    setError(null)
    setPreparing(true)
    try {
      changePhoto(await shrinkPhoto(file))
    } catch {
      setError(t('errors.usePhoto'))
    }
    setPreparing(false)
  }

  async function submit() {
    if (!hazardType || !severity) return
    setError(null)

    if (photo && !uploadedPath.current) {
      setStage('uploading')
      const result = await uploadPhoto(photo.file)
      if (result.error) {
        setStage('idle')
        setError(result.error)
        return
      }
      uploadedPath.current = result.path
    }

    setStage('sending')
    const message = await submitReport({
      hazardType,
      severity,
      note,
      photoPath: uploadedPath.current,
      lat,
      lng,
    })
    setStage('idle')
    if (message) setError(message)
    else onSent({ kind: 'report', severity })
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/40">
      <div
        role="dialog"
        aria-label={t('report.title')}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-lg font-semibold text-slate-900">{t('report.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Only this middle part scrolls, so Submit stays in reach on short screens */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <p className="mb-2 text-sm font-medium text-slate-700">{t('report.whatIsIt')}</p>
          <div className="grid grid-cols-3 gap-2">
            {HAZARD_TYPES.map(({ value, icon: Icon }) => {
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
                  {hazardLabel(value)}
                </button>
              )
            })}
          </div>

          <div ref={question}>
            {match && differentFrom !== match.id && (
              <DuplicateQuestion
                key={match.id}
                match={match}
                online={online}
                onDifferent={() => setDifferentFrom(match.id)}
                onConfirmed={onSent}
              />
            )}
            {match && differentFrom === match.id && (
              <p className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">
                {t('report.dup.different')}
                <button
                  type="button"
                  onClick={() => setDifferentFrom(null)}
                  className="h-11 shrink-0 px-2 font-medium text-blue-700"
                >
                  {t('route.change')}
                </button>
              </p>
            )}
          </div>

          <p className="mb-2 mt-5 text-sm font-medium text-slate-700">{t('report.canVehicles')}</p>
          <div className="grid grid-cols-3 gap-2">
            {SEVERITIES.map(({ value }) => {
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
                  {severityLabel(value)}
                </button>
              )
            })}
          </div>

          <label htmlFor="report-note" className="mb-2 mt-5 block text-sm font-medium text-slate-700">
            {t('report.note')}
          </label>
          {/* 16px text stops iOS from zooming the page when the field is focused */}
          <textarea
            id="report-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            placeholder={t('report.notePlaceholder')}
            className="w-full resize-none rounded-xl border-2 border-slate-200 p-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
          <p className="mt-1 text-right text-xs text-slate-500">
            {note.length}/{NOTE_MAX_LENGTH}
          </p>

          <p className="mb-2 mt-3 text-sm font-medium text-slate-700">{t('report.photo')}</p>
          {/* No capture attribute, so phones offer both the camera and the gallery */}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={pickPhoto}
            className="hidden"
          />
          {photo ? (
            <div className="flex items-center gap-3">
              <img src={photo.previewUrl} alt={t('report.photoSelected')} className="h-20 w-20 rounded-xl object-cover" />
              <p className="flex-1 text-sm text-slate-600">{Math.round(photo.file.size / 1024)} KB</p>
              <button
                type="button"
                onClick={() => changePhoto(null)}
                disabled={busy}
                aria-label={t('report.removePhoto')}
                className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-slate-300 text-slate-700 active:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={preparing || busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-sm font-medium text-slate-700 active:bg-slate-100 disabled:opacity-50"
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
              {preparing ? t('report.preparing') : t('report.addPhoto')}
            </button>
          )}
        </div>

        <div className="border-t border-slate-200 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {!online && (
            <p role="status" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('offline.report')} {t('offline.keepOpen')}
            </p>
          )}
          {error && (
            <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {online && (checking || needsAnswer) && (
            <p role="status" className="mb-2 text-center text-sm text-slate-600">
              {t(checking ? 'report.dup.checking' : 'report.dup.answerFirst')}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="h-14 w-full rounded-xl bg-blue-600 text-base font-semibold text-white active:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
          >
            {stage === 'uploading' ? t('report.uploading') : stage === 'sending' ? t('report.sending') : t('report.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
