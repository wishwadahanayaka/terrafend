// When a card opens, Leaflet pans the map until the card sits inside this padded
// area. The padding is sized to the buttons floating over the map, so a card never
// opens underneath them: the banner and the river controls along the top, and the
// column of buttons down the right. Shared by the hazard and river cards.
export const POPUP_PADDING = {
  // x, y in pixels. About 176px of top covers the banner, the Rivers and (i)
  // buttons and the status chip.
  autoPanPaddingTopLeft: [16, 176] as [number, number],
  // About 96px on the right clears the Locate, Report and Route buttons, and the
  // bottom edge clears the collapsed route bar.
  autoPanPaddingBottomRight: [96, 72] as [number, number],
}
