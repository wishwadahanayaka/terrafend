import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { LucideIcon, LucideProps } from 'lucide-react'

// Leaflet markers are plain HTML, so an icon is drawn once into SVG text. This
// avoids react-dom/server, which adds a lot to the download. flushSync can't
// run during a render, so call this when a file loads, never inside a component.
export function iconToSvg(icon: LucideIcon, props: LucideProps): string {
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() => root.render(createElement(icon, { ...props, 'aria-hidden': true })))
  const svg = host.innerHTML
  root.unmount()
  return svg
}
