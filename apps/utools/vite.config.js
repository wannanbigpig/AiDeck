import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import fs from 'node:fs'
import path from 'node:path'

const packageJsonPath = path.resolve(import.meta.dirname, 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const appVersion = String(packageJson.version || '0.0.0')

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800
  }
})
