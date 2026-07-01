const path = require('node:path')
const fs = require('node:fs')
const { builtinModules } = require('node:module')
const esbuild = require('esbuild')

const rootDir = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(rootDir, '../..')
const preloadEntry = path.join(rootDir, 'public', 'preload', 'services.js')
const preloadOutfile = path.join(workspaceRoot, 'dist', 'preload', 'services.js')
const announcementSource = path.join(workspaceRoot, 'announcements.json')
const announcementOutfile = path.join(workspaceRoot, 'dist', 'announcements.json')
const pluginManifestOutfile = path.join(workspaceRoot, 'dist', 'plugin.json')
const assetsDir = path.join(workspaceRoot, 'dist', 'assets')
const legacyDynamicImportChunkCachePath = path.join(workspaceRoot, 'node_modules', '.cache', 'aideck', 'utools-legacy-page-chunks.json')

const legacyDynamicImportPageNames = [
  'Antigravity',
  'Codex',
  'Dashboard',
  'Gemini',
  'Settings',
  'RequestLogModal'
]

const legacyDynamicImportChunkSeeds = [
  'Antigravity-CU8MGNKK.js',
  'Antigravity-D9b6Cvvj.js',
  'Antigravity-BNL2dtdo.js',
  'Antigravity-DoocNERM.js',
  'Codex-B16tADsx.js',
  'Codex-BO2lZAkk.js',
  'Codex-B1dWzGfZ.js',
  'Codex-Bq_s-N83.js',
  'Gemini-xon0i-WX.js',
  'Gemini-CS0SOi-e.js',
  'Dashboard-C3RWhfgQ.js',
  'Settings-BoH5AiZQ.js',
  'RequestLogModal-DScMt3Nm.js'
]

const legacyDynamicImportChunkPattern = new RegExp(`^(?:${legacyDynamicImportPageNames.join('|')})-[A-Za-z0-9_-]+\\.js$`)

const externalModules = Array.from(new Set([
  ...builtinModules,
  ...builtinModules.map((name) => name.replace(/^node:/, ''))
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

  if (fs.existsSync(announcementSource)) {
    fs.copyFileSync(announcementSource, announcementOutfile)
  }

  sanitizeDistPluginManifest(pluginManifestOutfile)
  writeLegacyDynamicImportFallbacks()
}

function normalizeLegacyDynamicImportChunkName (value) {
  const chunkName = String(value || '').trim()
  return legacyDynamicImportChunkPattern.test(chunkName) ? chunkName : ''
}

function collectLegacyDynamicImportChunks () {
  const names = new Set()
  for (let i = 0; i < arguments.length; i++) {
    const list = Array.isArray(arguments[i]) ? arguments[i] : [arguments[i]]
    for (const item of list) {
      const normalized = normalizeLegacyDynamicImportChunkName(item)
      if (normalized) names.add(normalized)
    }
  }
  return Array.from(names).sort()
}

function readLegacyDynamicImportChunkCache (cachePath = legacyDynamicImportChunkCachePath) {
  if (!cachePath || !fs.existsSync(cachePath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    return collectLegacyDynamicImportChunks(parsed)
  } catch (error) {
    console.warn('[utools postbuild] failed to read legacy chunk cache:', error && error.message ? error.message : String(error))
    return []
  }
}

function writeLegacyDynamicImportChunkCache (chunkNames, cachePath = legacyDynamicImportChunkCachePath) {
  const normalized = collectLegacyDynamicImportChunks(chunkNames)
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  fs.writeFileSync(cachePath, `${JSON.stringify(normalized, null, 2)}\n`)
  return normalized
}

function listLegacyDynamicImportChunksInDir (targetDir = assetsDir) {
  if (!targetDir || !fs.existsSync(targetDir)) return []
  const files = fs.readdirSync(targetDir)
  return collectLegacyDynamicImportChunks(files)
}

function captureExistingLegacyDynamicImportChunks (options = {}) {
  const cachePath = options.cachePath || legacyDynamicImportChunkCachePath
  const targetDir = options.assetsDir || assetsDir
  const previousCache = readLegacyDynamicImportChunkCache(cachePath)
  const detected = listLegacyDynamicImportChunksInDir(targetDir)
  const merged = collectLegacyDynamicImportChunks(legacyDynamicImportChunkSeeds, previousCache, detected)
  writeLegacyDynamicImportChunkCache(merged, cachePath)
  return merged
}

function getLegacyDynamicImportChunks (options = {}) {
  const cachePath = options.cachePath || legacyDynamicImportChunkCachePath
  const targetDir = options.assetsDir || assetsDir
  return collectLegacyDynamicImportChunks(
    legacyDynamicImportChunkSeeds,
    readLegacyDynamicImportChunkCache(cachePath),
    listLegacyDynamicImportChunksInDir(targetDir)
  )
}

function createLegacyDynamicImportFallbackSource (chunkName) {
  return `const reloadKey = '__aideck_legacy_dynamic_import_reload__'
try {
  if (typeof window !== 'undefined' && window && window.location) {
    const now = Date.now()
    const last = Number(window.sessionStorage && window.sessionStorage.getItem(reloadKey) || 0)
    if (!last || now - last > 1500) {
      if (window.sessionStorage) window.sessionStorage.setItem(reloadKey, String(now))
      window.setTimeout(() => window.location.reload(), 0)
    }
  }
} catch (e) {}
export default function LegacyDynamicImportFallback () {
  return null
}
export const __aideckLegacyChunk = ${JSON.stringify(chunkName)}
`
}

function writeLegacyDynamicImportFallbacks () {
  fs.mkdirSync(assetsDir, { recursive: true })
  for (const chunkName of getLegacyDynamicImportChunks()) {
    const targetPath = path.join(assetsDir, chunkName)
    if (fs.existsSync(targetPath)) continue
    fs.writeFileSync(targetPath, createLegacyDynamicImportFallbackSource(chunkName))
  }
}

function sanitizePluginManifest (manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('plugin manifest 应为对象')
  }

  const next = { ...manifest }
  delete next.development
  return next
}

function sanitizeDistPluginManifest (manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`uTools plugin manifest 不存在: ${manifestPath}`)
  }

  const raw = fs.readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(raw)
  const sanitized = sanitizePluginManifest(manifest)
  fs.writeFileSync(manifestPath, `${JSON.stringify(sanitized, null, 2)}\n`)
}

if (require.main === module) {
  const mode = String(process.argv[2] || '').trim()
  const runner = mode === 'capture-legacy-chunks'
    ? Promise.resolve().then(() => captureExistingLegacyDynamicImportChunks())
    : buildPreloadBundle()
  runner.catch((error) => {
    console.error('[utools postbuild] failed:', error)
    process.exitCode = 1
  })
}

module.exports = {
  buildPreloadBundle,
  captureExistingLegacyDynamicImportChunks,
  collectLegacyDynamicImportChunks,
  createLegacyDynamicImportFallbackSource,
  getLegacyDynamicImportChunks,
  legacyDynamicImportChunkCachePath,
  legacyDynamicImportChunkSeeds,
  listLegacyDynamicImportChunksInDir,
  normalizeLegacyDynamicImportChunkName,
  readLegacyDynamicImportChunkCache,
  writeLegacyDynamicImportFallbacks,
  writeLegacyDynamicImportChunkCache,
  sanitizePluginManifest,
  sanitizeDistPluginManifest
}
