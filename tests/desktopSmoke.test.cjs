const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('desktop preload 应注入 hostBridge 且不再暴露 services', () => {
  const preload = read('apps/desktop/src/main/preload.cjs')
  assert.equal(preload.includes("contextBridge.exposeInMainWorld('hostBridge', hostBridge)"), true)
  assert.equal(preload.includes("contextBridge.exposeInMainWorld('services'"), false)
})

test('desktop renderer 应直接挂载 app-shell', () => {
  const rendererEntry = read('apps/desktop/src/renderer/main.jsx')
  assert.equal(rendererEntry.includes("import { App } from '@aideck/app-shell'"), true)
  assert.equal(rendererEntry.includes("import '@aideck/app-shell/styles'"), true)
})

test('desktop preload 应保留 host 能力并让 plugin 能力走 no-op', () => {
  const preload = read('apps/desktop/src/main/preload.cjs')
  const expectedMarkers = [
    'copyText:',
    'showOpenDialog:',
    'showSaveDialog:',
    'readFile:',
    'writeTextFile:',
    'writeImageFile:',
    'showNotification:',
    'showItemInFolder:',
    'const plugin = {',
    'setSubInput: function () {',
    'onEnter: function () {',
    'out: function () {'
  ]

  for (const marker of expectedMarkers) {
    assert.equal(preload.includes(marker), true, marker)
  }
})
