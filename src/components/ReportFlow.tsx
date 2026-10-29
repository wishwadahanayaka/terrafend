import { useEffect, useState } from 'react'
import { MapPin, Plus } from 'lucide-react'
import type { LatLng, Map as LeafletMap } from 'leaflet'
import { useQueryClient } from '@tanstack/react-query'
import { REPORTS_KEY } from '../lib/useReports'
import ReportSheet from './ReportSheet'

export type ReportMode = 'idle' | 'picking' | 'form'

type Props = {
  map: LeafletMap
  userLatLng: LatLng | null
  mode: ReportMode
  onModeChange: (mode: ReportMode) => void
}

const TOAST_MS = 3500

export default function ReportFlow({ map, userLatLng, mode, onModeChange }: Props) {
  const [spot, setSpot] = useState<LatLng | null>(null)
  const [toast, setToast] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(false), TOAST_MS)
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
      {mode === 'idle' && (
        <button
          type="button"
          onClick={startPicking}
          className="absolute bottom-24 right-4 z-[1000] flex h-14 items-center gap-2 rounded-full bg-red-600 px-5 font-semibold text-white shadow-lg active:bg-red-700"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
          Report
        </button>
      )}

      {mode === 'picking' && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-[1000] flex justify-center px-2">
            <p className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-lg">
              Move the map to the hazard
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
              Cancel
            </button>
            <button
              type="button"
              onClick={useThisSpot}
              className="h-14 flex-[2] rounded-xl bg-blue-600 font-semibold text-white active:bg-blue-700"
            >
              Use this spot
            </button>
          </div>
        </>
      )}

      {mode === 'form' && spot && (
        <ReportSheet
          lat={spot.lat}
          lng={spot.lng}
          onClose={() => onModeChange('idle')}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: [REPORTS_KEY] })
            onModeChange('idle')
            setToast(true)
          }}
        />
      )}

      {toast && (
        <p
          role="status"
          className="absolute inset-x-4 bottom-24 z-[1200] mx-auto w-fit rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg"
        >
          Report sent, thanks
        </p>
      )}
    </>
  )
}
