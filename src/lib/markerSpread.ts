// Report markers that sit on top of each other can't all be tapped. This moves them apart on
// the screen, at the zoom the map is at. It works on pixel positions (the map's own pixel
// grid at the current zoom), so it knows nothing about Leaflet and is easy to test.

export type Pixel = { id: string; x: number; y: number }

// The markers are 44 px across, so two closer than that overlap
export const OVERLAP_PX = 44
// How far apart spread markers are put, a little more than a marker's width
export const SPACING_PX = 46

// Markers are taken in order. Each one that overlaps the first marker of an existing group
// joins that group, otherwise it starts a new one. The first marker of a group stays exactly
// where it is, and the others go around it in rings: 6 in the first ring, 12 in the second
// and so on (the packing of coins on a table), so a group of ten still stays compact and
// never overlaps. Within a ring the markers are spread evenly, starting from the top.
// Only the markers that move are returned, with their new positions.
export function spreadMarkers(points: Pixel[], overlapPx = OVERLAP_PX, spacingPx = SPACING_PX): Map<string, { x: number; y: number }> {
  const groups: Pixel[][] = []
  for (const p of points) {
    const home = groups.find((g) => Math.hypot(g[0].x - p.x, g[0].y - p.y) < overlapPx)
    if (home) home.push(p)
    else groups.push([p])
  }

  const moved = new Map<string, { x: number; y: number }>()
  for (const [anchor, ...others] of groups) {
    if (others.length === 0) continue
    // By id, so the same marker keeps its place when others come and go in the list
    others.sort((a, b) => a.id.localeCompare(b.id))

    let next = 0
    for (let ring = 1; next < others.length; ring++) {
      const members = others.slice(next, next + 6 * ring)
      members.forEach((m, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / members.length
        moved.set(m.id, {
          x: anchor.x + Math.cos(angle) * ring * spacingPx,
          y: anchor.y + Math.sin(angle) * ring * spacingPx,
        })
      })
      next += members.length
    }
  }
  return moved
}
