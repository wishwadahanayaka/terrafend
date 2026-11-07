/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import {
  TILE_CACHE_DAYS,
  TILE_CACHE_MAX_ENTRIES,
  TILE_CACHE_NAME,
  TILE_URL_PATTERN,
} from './src/lib/tileCache.ts'

export default defineConfig({
  // Changes with every build. Saved data from an older build is ignored, so a change
  // to the shape of the data can never meet a copy saved in the old shape.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new version waits until the person taps "refresh", so it never swaps in mid-use
      registerType: 'prompt',
      // Off in the dev server, so the ?fake... switches and hot reload behave as usual
      devOptions: { enabled: false },
      includeAssets: ['icon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: 'TerraFend',
        short_name: 'TerraFend',
        description: 'Live hazard map for Sri Lanka: floods, landslides, blocked roads, rain and alerts.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#1e293b',
        background_color: '#1e293b',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Every file the app is built from, including the chunks that load later, so
        // the first open after install has everything it needs without a connection
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',
        // The rain map is asked for on this path, and it is passed on to another site
        navigateFallbackDenylist: [/^\/waterlevels-api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // The map tiles are the only thing the service worker keeps besides the app
        // itself. Supabase (sign-in, reports, votes), the routing function and every data
        // source have no rule here, so they always go straight to the network. The data
        // shown offline is saved by the app itself (see offline.ts), with its time.
        runtimeCaching: [
          {
            urlPattern: TILE_URL_PATTERN,
            handler: 'CacheFirst',
            options: {
              cacheName: TILE_CACHE_NAME,
              expiration: {
                maxEntries: TILE_CACHE_MAX_ENTRIES,
                maxAgeSeconds: TILE_CACHE_DAYS * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
              // Only proper answers: an error page must never be kept as a tile
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    // Always the same address. If 5173 is taken (often by a dev server left running),
    // it stops with an error instead of quietly moving to another port.
    port: 5173,
    strictPort: true,
    proxy: {
      // waterlevels.lk's rain map doesn't allow other websites to read it from the
      // browser, so the app asks for it on its own address and this passes it on.
      // vercel.json does the same thing in production.
      '/waterlevels-api/rain-map': {
        target: 'https://waterlevels.lk',
        changeOrigin: true,
        rewrite: () => '/api/rain-map',
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // The logic under test is plain functions, so no browser is needed
    environment: 'node',
  },
})
