// How the threats chip fits its parts into two lines. It works on the measured widths of each part,
// so it matches what the browser would wrap. Kept out of the component so it can be tested.

// gap-x-1.5
export const GAP_PX = 6
export const MAX_LINES = 2

// How many parts fit in two lines, with a "+N more" at the end if some have to go.
// `tailWidth` is a part that is always shown after the others and is never put under "+N more" (the
// News pill): its room is kept whatever else is dropped. 0 when there is none.
export function fitParts(widths: number[], moreWidth: number, capacity: number, tailWidth = 0): number {
  for (let shown = widths.length; shown >= 1; shown--) {
    const items = widths.slice(0, shown)
    if (shown < widths.length) items.push(moreWidth)
    if (tailWidth > 0) items.push(tailWidth)
    let lines = 1
    let used = 0
    for (const width of items) {
      if (used === 0) used = width
      else if (used + GAP_PX + width > capacity) {
        lines++
        used = width
      } else used += GAP_PX + width
    }
    if (lines <= MAX_LINES) return shown
  }
  return 1
}
