import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import electron from 'vite-plugin-electron'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/main.cjs',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron', 'fs', 'path', 'os', 'events', 'util', 'child_process', 'http', 'https', 'crypto', 'zlib', 'net', 'node:fs', 'node:path', 'node:os', 'node:events', 'node:util', 'node:child_process', 'node:http', 'node:https', 'node:crypto', 'node:zlib', 'node:net']
            }
          }
        }
      },
      {
        entry: 'src/main/preload.cjs',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron', 'fs', 'path', 'os', 'events', 'util', 'child_process', 'http', 'https', 'crypto', 'zlib', 'net', 'node:fs', 'node:path', 'node:os', 'node:events', 'node:util', 'node:child_process', 'node:http', 'node:https', 'node:crypto', 'node:zlib', 'node:net']
            }
          }
        }
      }
    ])
  ],
  base: './',
  publicDir: resolve(import.meta.dirname, '../../public'),
  build: {
    outDir: 'dist-electron/renderer'
  },
  resolve: {
    alias: {
      '@desktop-main': resolve(import.meta.dirname, 'src/main')
    }
  }
})
