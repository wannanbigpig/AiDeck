const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.join(__dirname, '..')

test('uTools Vite 构建应注入当前插件版本到公告运行时', async () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'utools', 'package.json'), 'utf8'))
  const viteConfigModule = await import(pathToFileURL(path.join(root, 'apps', 'utools', 'vite.config.js')).href)
  const viteConfig = typeof viteConfigModule.default === 'function'
    ? viteConfigModule.default({ command: 'build', mode: 'production' })
    : viteConfigModule.default

  assert.equal(viteConfig.define.__APP_VERSION__, JSON.stringify(packageJson.version))
})

test('公告运行时版本不应再写死旧版本号', () => {
  const source = fs.readFileSync(path.join(root, 'packages', 'app-shell', 'src', 'runtime', 'useAnnouncements.js'), 'utf8')

  assert.equal(source.includes('__APP_VERSION__'), true)
  assert.equal(source.includes("export const APP_VERSION = '1.0.6'"), false)
})
