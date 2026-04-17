const path = require('node:path')
const { builtinModules } = require('node:module')
const esbuild = require('esbuild')

const rootDir = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(rootDir, '../..')
const preloadEntry = path.join(rootDir, 'public', 'preload', 'services.js')
const preloadOutfile = path.join(workspaceRoot, 'dist', 'preload', 'services.js')

const externalModules = Array.from(new Set([
  ...builtinModules,
  ...builtinModules.map((name) => name.replace(/^node:/, '')),
  'electron'
]))

async function buildPreloadBundle () {
  await esbuild.build({
    entryPoints: [preloadEntry],
    outfile: preloadOutfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node18'],
    external: externalModules,
    logLevel: 'info'
  })
}

buildPreloadBundle().catch((error) => {
  console.error('[utools postbuild] failed to bundle preload:', error)
  process.exitCode = 1
})
