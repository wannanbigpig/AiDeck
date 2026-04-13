import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-electron/renderer'
  },
  resolve: {
    alias: {
      '@desktop-main': resolve(import.meta.dirname, 'src/main')
    }
  }
})
