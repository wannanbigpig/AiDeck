const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function readFile (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').trim()
}

function readDesktopPreloadFile () {
  const candidates = [
    'apps/desktop/src/main/preload.js',
    'apps/desktop/src/main/preload.cjs'
  ]

  for (const relativePath of candidates) {
    const fullPath = path.join(root, relativePath)
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8').trim()
    }
  }

  throw new Error('desktop preload file not found')
}

function listSourceFiles (dirPath) {
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

test('preload lib wrapper 应为纯转发文件', () => {
  const expected = new Map([
    ['public/preload/lib/accountStorage.js', "module.exports = require('../../../packages/infra-node/src/accountStorage.cjs')"],
    ['public/preload/lib/antigravityService.js', "module.exports = require('../../../packages/platforms/src/antigravityService.cjs')"],
    ['public/preload/lib/codexService.js', "module.exports = require('../../../packages/platforms/src/codexService.cjs')"],
    ['public/preload/lib/fileUtils.js', "module.exports = require('../../../packages/infra-node/src/fileUtils.cjs')"],
    ['public/preload/lib/geminiService.js', "module.exports = require('../../../packages/platforms/src/geminiService.cjs')"],
    ['public/preload/lib/httpClient.js', "module.exports = require('../../../packages/infra-node/src/httpClient.cjs')"],
    ['public/preload/lib/requestLogStore.js', "module.exports = require('../../../packages/infra-node/src/requestLogStore.cjs')"],
    ['apps/utools/public/preload/lib/accountStorage.js', "module.exports = require('../../../../../packages/infra-node/src/accountStorage.cjs')"],
    ['apps/utools/public/preload/lib/antigravityService.js', "module.exports = require('../../../../../packages/platforms/src/antigravityService.cjs')"],
    ['apps/utools/public/preload/lib/codexService.js', "module.exports = require('../../../../../packages/platforms/src/codexService.cjs')"],
    ['apps/utools/public/preload/lib/fileUtils.js', "module.exports = require('../../../../../packages/infra-node/src/fileUtils.cjs')"],
    ['apps/utools/public/preload/lib/geminiService.js', "module.exports = require('../../../../../packages/platforms/src/geminiService.cjs')"],
    ['apps/utools/public/preload/lib/httpClient.js', "module.exports = require('../../../../../packages/infra-node/src/httpClient.cjs')"],
    ['apps/utools/public/preload/lib/requestLogStore.js', "module.exports = require('../../../../../packages/infra-node/src/requestLogStore.cjs')"]
  ])

  for (const [filePath, expectedLine] of expected.entries()) {
    assert.equal(readFile(filePath), expectedLine, filePath)
  }
})

test('renderer 侧不应再暴露 window.services', () => {
  const desktopPreload = readDesktopPreloadFile()
  const utoolsPreload = readFile('apps/utools/public/preload/services.js')
  const legacyBridgeWrapper = readFile('public/preload/services.js')

  assert.equal(desktopPreload.includes("exposeInMainWorld('services'"), false)
  assert.equal(utoolsPreload.includes('window.services = services'), false)
  assert.equal(legacyBridgeWrapper, "module.exports = require('../../apps/utools/public/preload/services.js')")
})

test('renderer 源码不应再直接访问 window.utools、window.services、dbStorage', () => {
  const sourceRoots = [
    path.join(root, 'src'),
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
