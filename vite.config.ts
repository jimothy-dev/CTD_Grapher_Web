import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served from GitHub Pages at /CTD_Grapher_Web/; the hash router keeps deep
// links working without server rewrites.
export default defineConfig({
  base: '/CTD_Grapher_Web/',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 6000 },
})
