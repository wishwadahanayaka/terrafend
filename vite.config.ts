/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
