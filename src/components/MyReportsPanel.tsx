import { createElement, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hazardIcon, hazardLabel, SEVERITIES, severityBg, severityLabel, type Severity } from '../lib/hazards'
import { clearMyReport, editMyReport, myReportError } from '../lib/ownReports'
import { canSaveEdit, NOTE_LIMIT, type MyReportRow } from '../lib/myReportsList'
import { MY_REPORTS_KEY, REPORTS_KEY } from '../lib/queryKeys'
import { timeAgo } from '../lib/time'
import { useMyReports } from '../lib/useMyReports'
import { useOnline } from '../lib/useOnline'

type Props = {
  onClose: () => void
  // Tapping a report: the map flies to it
  onShow: (row: MyReportRow) => void
}

export default function MyReportsPanel({ onClose, onShow }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const online = useOnline()
  const query = useMyReports(true)
  // What was just done, said once at the top of the list
  const [done, setDone] = useState<string | null>(null)

  const items = query.data ?? []

  // The map shows the change (or the report going) after the next refresh, so both are asked
  // to reload. The panel's own list reloads too, for the new status and times.
  function refresh() {
    queryClient.invalidateQueries({ queryKey: [REPORTS_KEY] })
    queryClient.invalidateQueries({ queryKey: [MY_REPORTS_KEY] })
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('myReports.title')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between px-4 pb-1 pt-4">
          <h2 className="text-lg font-semibold text-slate-900">{t('myReports.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="mb-3 text-xs leading-snug text-slate-600">{t('myReports.note')}</p>

          {done && (
            <p role="status" className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
              {done}
            </p>
          )}
          {!online && (
            <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('offline.myReports')}
            </p>
          )}

          {query.isPending && online && <p className="py-6 text-center text-sm text-slate-600">{t('myReports.loading')}</p>}

          {query.isError && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {t('myReports.loadError')}
              <button
                type="button"
                onClick={() => query.refetch()}
                className="mt-1 block h-11 text-sm font-medium text-blue-700"
              >
                {t('common.tryAgain')}
              </button>
            </div>
          )}

          {query.isSuccess && items.length === 0 && (
            <p className="rounded-xl bg-slate-100 px-4 py-6 text-center text-sm text-slate-700">{t('myReports.empty')}</p>
          )}

          {items.length > 0 && (
            <ul className="space-y-2">
              {items.map(({ row, active }) => (
                <MyReportItem
                  key={row.id}
                  row={row}
                  active={active}
                  online={online}
                  onShow={onShow}
                  onChanged={(message) => {
                    setDone(message)
                    refresh()
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

type ItemProps = {
  row: MyReportRow
  active: boolean
  online: boolean
  onShow: (row: MyReportRow) => void
  onChanged: (message: string) => void
}

function MyReportItem({ row, active, online, onShow, onChanged }: ItemProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view')
  const [severity, setSeverity] = useState<Severity>(row.severity)
  const [note, setNote] = useState(row.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const type = hazardLabel(row.hazard_type)
  const button = 'h-11 flex-1 rounded-lg border-2 px-2 text-sm font-medium disabled:opacity-50'

  function startEdit() {
    setSeverity(row.severity)
    setNote(row.note ?? '')
    setError(null)
    setMode('edit')
  }

  async function save() {
    setBusy(true)
    setError(null)
    const result = await editMyReport(row.id, severity, note)
    setBusy(false)
    if (result === 'ok') {
      setMode('view')
      onChanged(t('myReports.saved'))
    } else {
      setError(myReportError('edit', result))
      // The report ran out while the form was open: the list reloads and shows it as cleared
      if (result === 'inactive') onChanged('')
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    const result = await clearMyReport(row.id)
    setBusy(false)
    if (result === 'ok') {
      setMode('view')
      onChanged(t('myReports.removed'))
    } else {
      setError(myReportError('clear', result))
      if (result === 'inactive') onChanged('')
    }
  }

  return (
    <li className={`rounded-xl border-2 ${active ? 'border-slate-200' : 'border-slate-100 bg-slate-50'}`}>
      <button
        type="button"
        onClick={() => onShow(row)}
        aria-label={t('myReports.show', { type })}
        className="flex w-full items-start gap-3 rounded-xl p-2 text-left active:bg-slate-100"
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${active ? severityBg(row.severity) : 'bg-slate-400'}`}
        >
          {createElement(hazardIcon(row.hazard_type), { className: 'h-5 w-5', 'aria-hidden': true })}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="text-base font-semibold text-slate-900">{type}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${active ? 'bg-green-100 text-green-900' : 'bg-slate-200 text-slate-700'}`}
            >
              {t(active ? 'myReports.active' : 'myReports.cleared')}
            </span>
          </span>
          <span className="block text-sm text-slate-700">
            {severityLabel(row.severity)} &middot; {t('report.reported', { ago: timeAgo(row.created_at) })}
            {row.confirmations > 0 && <> &middot; {t('report.confirmedBy', { count: row.confirmations })}</>}
          </span>
          {row.note && <span className="mt-1 block break-words text-sm text-slate-600">{row.note}</span>}
        </span>
      </button>

      {active && mode === 'view' && (
        <div className="flex gap-2 px-2 pb-2">
          <button
            type="button"
            onClick={startEdit}
            disabled={!online}
            className={`${button} border-slate-300 text-slate-800 active:bg-slate-100`}
          >
            {t('myReports.edit')}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setMode('confirm')
            }}
            disabled={!online}
            className={`${button} border-slate-300 text-slate-800 active:bg-slate-100`}
          >
            {t('myReports.clear')}
          </button>
        </div>
      )}

      {active && mode === 'confirm' && (
        <div role="alertdialog" aria-label={t('myReports.confirmClear')} className="mx-2 mb-2 rounded-lg bg-red-50 p-3">
          <p className="text-sm font-medium text-red-900">{t('myReports.confirmClear')}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={busy || !online}
              className={`${button} border-red-700 bg-red-700 text-white active:bg-red-800`}
            >
              {busy ? t('myReports.removing') : t('myReports.confirmYes')}
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              disabled={busy}
              className={`${button} border-slate-300 bg-white text-slate-800 active:bg-slate-100`}
            >
              {t('myReports.confirmNo')}
            </button>
          </div>
        </div>
      )}

      {active && mode === 'edit' && (
        <div className="mx-2 mb-2 rounded-lg bg-slate-50 p-3">
          <p className="mb-2 text-sm font-medium text-slate-700">{t('report.canVehicles')}</p>
          <div className="grid grid-cols-3 gap-2">
            {SEVERITIES.map(({ value }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSeverity(value)}
                aria-pressed={severity === value}
                className={`min-h-12 rounded-lg border-2 px-1 text-sm leading-tight ${
                  severity === value
                    ? 'border-blue-600 bg-blue-50 font-medium text-blue-700'
                    : 'border-slate-200 bg-white text-slate-700 active:bg-slate-100'
                }`}
              >
                {severityLabel(value)}
              </button>
            ))}
          </div>

          <label htmlFor={`note-${row.id}`} className="mb-1 mt-3 block text-sm font-medium text-slate-700">
            {t('report.note')}
          </label>
          {/* 16px text stops iOS from zooming the page when the field is focused */}
          <textarea
            id={`note-${row.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_LIMIT}
            rows={3}
            placeholder={t('report.notePlaceholder')}
            className="w-full resize-none rounded-lg border-2 border-slate-200 bg-white p-2 text-base text-slate-900 focus:border-blue-600 focus:outline-none"
          />
          <p className="mt-1 text-right text-xs text-slate-500">
            {note.length}/{NOTE_LIMIT}
          </p>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !online || !canSaveEdit(row, severity, note)}
              className={`${button} border-blue-600 bg-blue-600 text-white active:bg-blue-700 disabled:border-slate-300 disabled:bg-slate-300 disabled:text-slate-500`}
            >
              {busy ? t('myReports.saving') : t('myReports.save')}
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              disabled={busy}
              className={`${button} border-slate-300 bg-white text-slate-800 active:bg-slate-100`}
            >
              {t('myReports.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mx-2 mb-2 rounded-lg bg-red-50 px-2 py-1.5 text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  )
}
