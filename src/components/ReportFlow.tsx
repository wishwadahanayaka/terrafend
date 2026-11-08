import { lazy, Suspense, useEffect, useState } from 'react'
import { MapPin, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LatLng, Map as LeafletMap } from 'leaflet'
import { useQueryClient } from '@tanstack/react-query'
import { hiddenByLayers, severityLabel } from '../lib/hazards'
import { REPORTS_KEY } from '../lib/queryKeys'
import { fadeWhenCardOpen } from '../lib/useCardOpen'

// The form and its photo tools aren't needed until someone taps "Use this spot"
const ReportSheet = lazy(() => import('./ReportSheet'))

export type ReportMode = 'idle' | 'picking' | 'form'

type Props = {
  map: LeafletMap
  userLatLng: LatLng | null
  mode: ReportMode
  onModeChange: (mode: ReportMode) => void
  // False while the route panel is up, which takes the bottom of the screen
  buttonVisible: boolean
  // The button fades out while a map card is open
  cardOpen: boolean
  // Reporting needs a connection. The button greys out and a tap says why.
  offline: boolean
  onOfflineTap: () => void
  // The Reports layer switch, to tell when a new report will be left off the map
  showPassable: boolean
}

const TOAST_MS = 3500
const LONG_TOAST_MS = 7000
const LONG_TOAST_CHARS = 60

export default function ReportFlow({
  map,
  userLatLng,
  mode,
  onModeChange,
  buttonVisible,
  cardOpen,
  offline,
  onOfflineTap,
  showPassable,
}: Props) {
  const { t } = useTranslation()
  const [spot, setSpot] = useState<LatLng | null>(null)
  // The words shown after sending, or null when nothing is showing
  const [toast, setToast] = useState<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!toast) return
    // The longer message about hidden reports needs more time to read
    const id = setTimeout(() => setToast(null), toast.length > LONG_TOAST_CHARS ? LONG_TOAST_MS : TOAST_MS)
    return () => clearTimeout(id)
  }, [toast])

  function startPicking() {
    if (userLatLng) map.setView(userLatLng, Math.max(map.getZoom(), 16))
    onModeChange('picking')
  }

  function useThisSpot() {
    // wrap() keeps longitude within -180..180 if the user panned around the world copy
    setSpot(map.getCenter().wrap())
    onModeChange('form')
  }

  return (
    <>
      {mode === 'idle' && buttonVisible && (
        <button
          type="button"
          onClick={offline ? onOfflineTap : startPicking}
          aria-disabled={offline}
          aria-label={t('report.button')}
          title={t('report.button')}
          inert={cardOpen}
          className={`absolute bottom-24 right-4 z-[1000] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg ${offline ? 'bg-slate-400' : 'bg-red-600 active:bg-red-700'} ${fadeWhenCardOpen(cardOpen)}`}
        >
          <Plus className="h-7 w-7" aria-hidden="true" />
        </button>
      )}

      {mode === 'picking' && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--banner-bottom,56px)+1rem)] z-[1000] flex justify-center px-2">
            <p className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-lg">
              {t('report.pickHint')}
            </p>
          </div>

          {/* The pin's tip sits on the exact centre of the screen, which is where getCenter() points */}
          <MapPin
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] h-12 w-12 -translate-x-1/2 -translate-y-full fill-red-600 text-white drop-shadow-lg"
          />

          <div className="absolute inset-x-0 bottom-0 z-[1000] flex gap-3 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_8px_rgba(0,0,0,0.15)]">
            <button
              type="button"
              onClick={() => onModeChange('idle')}
              className="h-14 flex-1 rounded-xl border-2 border-slate-300 font-semibold text-slate-700 active:bg-slate-100"
            >
              {t('report.cancel')}
            </button>
            <button
              type="button"
              onClick={useThisSpot}
              className="h-14 flex-[2] rounded-xl bg-blue-600 font-semibold text-white active:bg-blue-700"
            >
              {t('report.useSpot')}
            </button>
          </div>
        </>
      )}

      {mode === 'form' && spot && (
        <Suspense fallback={<div className="fixed inset-0 z-[1100] bg-black/40" />}>
          <ReportSheet
            lat={spot.lat}
            lng={spot.lng}
            onClose={() => onModeChange('idle')}
            onSent={(what) => {
              queryClient.invalidateQueries({ queryKey: [REPORTS_KEY] })
              onModeChange('idle')
              setToast(
                what.kind === 'report'
                  ? hiddenByLayers(what.severity, showPassable)
                    ? `${t('report.sent')}. ${t('report.hiddenNote')}`
                    : t('report.sent')
                  : what.kind === 'confirmed'
                    ? t('report.dup.confirmedToast')
                    : t('report.dup.updatedToast', { severity: severityLabel(what.severity) }),
              )
            }}
          />
        </Suspense>
      )}

      {toast && (
        <p
          role="status"
          className="absolute inset-x-4 bottom-24 z-[1200] mx-auto w-fit max-w-sm rounded-2xl bg-slate-900 px-5 py-3 text-center text-sm font-medium text-white shadow-lg"
        >
          {toast}
        </p>
      )}
    </>
  )
}
