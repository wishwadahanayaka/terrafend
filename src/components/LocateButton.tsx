import { useEffect, useState } from 'react'
import { Circle, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import type { LatLng } from 'leaflet'

type Position = { latlng: LatLng; accuracy: number }

// Codes come from the browser: 1 denied, 2 unavailable, 3 timeout
const ERROR_MESSAGES: Record<number, string> = {
  1: 'Location permission was denied. Allow it in your browser settings.',
  2: 'Your device couldn’t find its location. On a laptop, check that Windows location services are on.',
  3: 'Finding your location took too long. Try again.',
}
const ERROR_SHOW_MS = 6000
const LOCATE_TIMEOUT_MS = 15000

type Props = {
  onLocated: (latlng: LatLng) => void
  // Lifts the button clear of the bottom bar while picking a hazard spot
  raised: boolean
}

export default function LocateButton({ onLocated, raised }: Props) {
  const map = useMap()
  const [position, setPosition] = useState<Position | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), ERROR_SHOW_MS)
    return () => clearTimeout(id)
  }, [error])

  useMapEvents({
    locationfound(e) {
      setPosition({ latlng: e.latlng, accuracy: e.accuracy })
      onLocated(e.latlng)
      setError(null)
      setLoading(false)
    },
    locationerror(e) {
      setError(ERROR_MESSAGES[e.code] ?? ERROR_MESSAGES[2])
      setLoading(false)
    },
  })

  function locate() {
    setLoading(true)
    setError(null)
    map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS })
  }

  return (
    <>
      {position && (
        <>
          <Circle
            center={position.latlng}
            radius={position.accuracy}
            pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.1 }}
          />
          <CircleMarker
            center={position.latlng}
            radius={8}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
          />
        </>
      )}

      {/* Error sits to the left of the button so it doesn't cover the Report button above */}
      <div
        className={`absolute right-4 z-[1000] flex items-center gap-2 ${raised ? 'bottom-28' : 'bottom-6'}`}
      >
        {error && (
          <p className="max-w-[65vw] rounded-lg bg-red-600 px-3 py-2 text-xs text-white shadow">{error}</p>
        )}
        <button
          type="button"
          onClick={locate}
          disabled={loading}
          aria-label="Show my location"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-blue-600 shadow-lg active:bg-slate-100 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" fill="currentColor" />
            <circle cx="12" cy="12" r="7" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </>
  )
}
