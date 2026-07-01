const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  captureExistingLegacyDynamicImportChunks,
  getLegacyDynamicImportChunks,
  legacyDynamicImportChunkSeeds,
  readLegacyDynamicImportChunkCache,
  sanitizePluginManifest
} = require('../apps/utools/scripts/postbuild.cjs')

const root = path.join(__dirname, '..')

function listSourceFiles (dirPath) {
  if (!fs.existsSync(dirPath)) return []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(fullPath))
      continue
    }
    if (/\.(js|jsx|cjs|mjs)$/.test(entry.name)) {
      out.push(fullPath)
    }
  }
  return out
}

test('utools preload 不应再保留 preload/preload 历史嵌套目录', () => {
  const legacyDir = path.join(root, 'apps', 'utools', 'public', 'preload', 'preload')
  assert.equal(fs.existsSync(legacyDir), false)
})

test('项目不应再保留 Desktop 宿主源码', () => {
  const desktopDir = path.join(root, 'apps', 'desktop')
  assert.equal(fs.existsSync(desktopDir), false)
})

test('项目不应再保留旧根入口和 preload 转发层', () => {
  const removedPaths = [
    'src',
    'public',
    'index.html',
    'vite.config.js',
    'test_api.js',
    'apps/utools/public/preload/lib'
  ]

  for (const relativePath of removedPaths) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath)
  }
})

test('项目根目录插件清单应默认走生产入口', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'))
  const preload = fs.readFileSync(path.join(root, 'preload/services.js'), 'utf8').trim()

  assert.equal(plugin.main, 'dist/index.html')
  assert.equal(plugin.preload, 'preload/services.js')
  assert.equal(Object.prototype.hasOwnProperty.call(plugin, 'development'), false)
  assert.equal(preload, "module.exports = require('../apps/utools/public/preload/services.js')")
})

test('构建产物 plugin manifest 不应保留 development.main', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'utools', 'public', 'plugin.json'), 'utf8'))
  const sanitized = sanitizePluginManifest(manifest)

  assert.equal(sanitized.main, 'index.html')
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, 'development'), false)
})

test('uTools dev 插件清单应只保留在 apps/utools/public', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'utools', 'public', 'plugin.json'), 'utf8'))

  assert.equal(manifest.main, 'index.html')
  assert.equal(manifest.development.main, 'http://localhost:5173')
})

test('renderer 侧不应再暴露 window.services', () => {
  const utoolsPreload = fs.readFileSync(path.join(root, 'apps/utools/public/preload/services.js'), 'utf8')

  assert.equal(utoolsPreload.includes('window.services = services'), false)
})

test('uTools preload 应暴露 Codex 扩展动作转发', () => {
  const utoolsPreload = fs.readFileSync(path.join(root, 'apps/utools/public/preload/services.js'), 'utf8')

  assert.equal(
    utoolsPreload.includes('resyncAccountInfo: function (id) { return codexService.resyncAccountInfo(id) }'),
    true
  )
  assert.equal(
    utoolsPreload.includes('getResetCredits: function (id) { return codexService.getResetCredits(id) }'),
    true
  )
  assert.equal(
    utoolsPreload.includes('consumeResetCredit: function (id) { return codexService.consumeResetCredit(id) }'),
    true
  )
})

test('历史 page chunk fallback 应合并种子、缓存和已有 dist 产物', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-legacy-chunks-'))
  const tempAssetsDir = path.join(tempDir, 'assets')
  const tempCachePath = path.join(tempDir, 'cache', 'legacy-page-chunks.json')
  fs.mkdirSync(tempAssetsDir, { recursive: true })
  fs.writeFileSync(path.join(tempAssetsDir, 'Gemini-NEW123.js'), 'export default null\n')
  fs.writeFileSync(path.join(tempAssetsDir, 'not-a-page-chunk.js'), 'noop\n')
  fs.mkdirSync(path.dirname(tempCachePath), { recursive: true })
  fs.writeFileSync(tempCachePath, JSON.stringify(['Dashboard-OLDHASH.js', 'invalid-entry.js'], null, 2))

  const captured = captureExistingLegacyDynamicImportChunks({
    assetsDir: tempAssetsDir,
    cachePath: tempCachePath
  })

  assert.equal(legacyDynamicImportChunkSeeds.includes('Codex-B16tADsx.js'), true)
  assert.equal(captured.includes('Gemini-NEW123.js'), true)
  assert.equal(captured.includes('Dashboard-OLDHASH.js'), true)
  assert.equal(captured.includes('invalid-entry.js'), false)

  const cached = readLegacyDynamicImportChunkCache(tempCachePath)
  assert.deepEqual(cached, captured)

  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('构建产物不应生成真实页面级动态 chunk', () => {
  const assetsDir = path.join(root, 'dist', 'assets')
  if (!fs.existsSync(assetsDir)) return
  const files = fs.readdirSync(assetsDir)
  const pageChunkPattern = /^(Antigravity|Codex|Dashboard|Gemini|Settings|RequestLogModal)-.+\.js$/
  const pageChunks = files.filter(file => pageChunkPattern.test(file))

  assert.equal(getLegacyDynamicImportChunks().includes('Codex-B16tADsx.js'), true)
  for (const file of pageChunks) {
    const content = fs.readFileSync(path.join(assetsDir, file), 'utf8')
    assert.equal(content.includes('LegacyDynamicImportFallback'), true, `${file} should be a legacy fallback`)
    assert.equal(content.includes('__aideckLegacyChunk'), true, `${file} should identify legacy fallback chunk`)
  }
})

test('uTools Vite 构建应允许单 bundle 体积阈值', () => {
  const viteConfig = fs.readFileSync(path.join(root, 'apps/utools/vite.config.js'), 'utf8')

  assert.equal(viteConfig.includes('chunkSizeWarningLimit: 800'), true)
})

test('renderer 源码不应再直接访问 window.utools、window.services、dbStorage', () => {
  const sourceRoots = [
    path.join(root, 'apps', 'utools', 'src'),
    path.join(root, 'packages', 'app-shell', 'src')
  ]
  const forbiddenPatterns = [
    'window.utools',
    'window.services',
    'dbStorage'
  ]

  for (const sourceRoot of sourceRoots) {
    const files = listSourceFiles(sourceRoot)
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8')
      for (const pattern of forbiddenPatterns) {
        assert.equal(content.includes(pattern), false, `${filePath} should not include ${pattern}`)
      }
    }
  }
})
