import { useState } from 'react'
import { photoUrl } from '../lib/photos'

export default function ReportPhoto({ path }: { path: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  const url = photoUrl(path)
  // Fixed height so the popup is the right size before the image arrives
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block h-28 w-full overflow-hidden rounded-lg bg-slate-100"
    >
      <img
        src={url}
        alt="Photo of the hazard"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </a>
  )
}
