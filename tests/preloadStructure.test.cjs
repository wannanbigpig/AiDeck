const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

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

test('项目根目录应提供 uTools dev 插件入口', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'))
  const preload = fs.readFileSync(path.join(root, 'preload/services.js'), 'utf8').trim()

  assert.equal(plugin.preload, 'preload/services.js')
  assert.equal(plugin.development.main, 'http://localhost:5173')
  assert.equal(preload, "module.exports = require('../apps/utools/public/preload/services.js')")
})

test('renderer 侧不应再暴露 window.services', () => {
  const utoolsPreload = fs.readFileSync(path.join(root, 'apps/utools/public/preload/services.js'), 'utf8')

  assert.equal(utoolsPreload.includes('window.services = services'), false)
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
