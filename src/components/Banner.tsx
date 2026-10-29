// z-index has to beat Leaflet's panes and controls, which go up to 1000
export default function Banner() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] p-2">
      <p className="mx-auto max-w-md rounded-lg bg-slate-800/90 px-3 py-2 text-center text-xs text-white shadow">
        Not an official warning service. Follow DMC for official alerts.
      </p>
    </div>
  )
}
