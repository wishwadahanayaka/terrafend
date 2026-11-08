import { bannerExtraPx } from './bannerSpace'

// When a card opens, Leaflet pans the map until the card sits inside this padded
// area. The padding is sized to the buttons floating over the map, so a card never
// opens underneath them: the banner and the river controls along the top, and the
// column of buttons down the right. Shared by the hazard and river cards.
export const POPUP_PADDING = {
  // x, y in pixels. About 208px of top covers the banner, the Layers and (i)
  // buttons and the threats chip, which can wrap to three lines on a phone.
  // Read when a card opens (it is a getter), so a taller banner in Sinhala or Tamil is allowed for.
  get autoPanPaddingTopLeft(): [number, number] {
    return [16, 208 + bannerExtraPx()]
  },
  // About 96px on the right clears the Locate, Report and Route buttons, and the
  // bottom edge clears the collapsed route bar.
  autoPanPaddingBottomRight: [96, 72] as [number, number],
  // A card taller than the room between the controls at the top and the bottom edge scrolls
  // inside itself, instead of sliding under the buttons. Longer Sinhala and Tamil text makes
  // that happen more often. About 70px of the room goes on the card's own padding and its tip.
  get maxHeight(): number {
    return Math.max(160, window.innerHeight - (208 + bannerExtraPx()) - 72 - 70)
  },
}

const SIDE_PADDING = POPUP_PADDING.autoPanPaddingTopLeft[0] + POPUP_PADDING.autoPanPaddingBottomRight[0]

// Leaflet puts 20px on the left and 24px on the right of the card's content
const CONTENT_MARGIN = 44

// Widest the text part of a card may be. On a phone it shrinks so the whole card
// (text plus its margins) fits between the left padding and the right buttons.
// Never below 160px, so very narrow screens still get readable text.
export function popupContentMax(screenWidth: number): number {
  return Math.max(160, Math.min(300, screenWidth - SIDE_PADDING - CONTENT_MARGIN))
}

// The whole card, as it ends up on screen
export function popupTotalWidth(screenWidth: number): number {
  return popupContentMax(screenWidth) + CONTENT_MARGIN
}

// How far a card's edge should stay from the screen edge, when working out how much
// sea margin the map needs. The check that opens a card allows a bit less (8px).
export const POPUP_EDGE_GAP = 16
