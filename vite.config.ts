import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
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
})
