import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// The icon is already a full square of dark slate with the shield well inside it, so
// the maskable and Apple icons use it as it is instead of shrinking it onto a white square.
// Run `npm run icons` after changing public/icon.svg.
const background = '#1e293b'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background } },
  },
  images: ['public/icon.svg'],
})
