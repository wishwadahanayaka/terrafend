// The disclaimer banner is two lines in English and often three in Sinhala and Tamil (and
// four on a very narrow phone). The buttons under it, and the space cards keep clear at the
// top of the screen, move down by however much taller it is than the usual two lines.

// Height of the banner with its padding in English on a phone: 8px, two lines, 16px of padding
export const USUAL_BANNER_PX = 56

let extra = 0

export const bannerExtraPx = () => extra

export function setBannerHeight(px: number): void {
  extra = Math.max(0, Math.round(px - USUAL_BANNER_PX))
}
