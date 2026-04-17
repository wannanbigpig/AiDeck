import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import electron from 'vite-plugin-electron'

export default defineConfig({
  plugins: [
    electron([
      {
        entry: 'src/main/main.cjs',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            minify: false,
            rollupOptions: {
              external: ['electron', 'fs', 'path', 'os', 'events', 'util', 'child_process', 'http', 'https', 'crypto', 'zlib', 'net', 'node:fs', 'node:path', 'node:os', 'node:events', 'node:util', 'node:child_process', 'node:http', 'node:https', 'node:crypto', 'node:zlib', 'node:net'],
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs'
              }
            }
          }
        }
      },
      {
        entry: 'src/main/preload.js',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            minify: false,
            rollupOptions: {
              // 关键：显式定义 external 为函数，确保只有原生模块被外部化
              // 任何包含 "packages" 的路径都强制返回 false (即不外部化，必须打包)
              external(id) {
                const builtinModules = ['electron', 'fs', 'path', 'os', 'events', 'util', 'child_process', 'http', 'https', 'crypto', 'zlib', 'net', 'node:fs', 'node:path', 'node:os', 'node:events', 'node:util', 'node:child_process', 'node:http', 'node:https', 'node:crypto', 'node:zlib', 'node:net']
                if (builtinModules.includes(id) || id.startsWith('node:')) {
                  return true
                }
                // 强制打包所有相对路径引用的本地包
                if (id.includes('packages') || id.startsWith('..')) {
                  return false
                }
                return false
              },
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs',
                inlineDynamicImports: true
              }
            }
          }
        }
      }
    ]),
    react()
  ],
  base: './',
  publicDir: resolve(import.meta.dirname, '../../public'),
  resolve: {
    alias: {
      '@desktop-main': resolve(import.meta.dirname, 'src/main'),
      // 增加别名，统一路径解析
      '@aideck/packages': resolve(import.meta.dirname, '../../packages')
    }
  },
  build: {
    outDir: 'dist-electron/renderer'
  }
})
