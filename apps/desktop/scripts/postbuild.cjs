const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'dist-electron')
const mainOutDir = path.join(outDir, 'main')

// 确保目录存在
if (!fs.existsSync(mainOutDir)) {
  fs.mkdirSync(mainOutDir, { recursive: true })
}

// 终极修复方案：为打包后的环境创建 infra-node 和 platforms 符号链接
// 报错路径是 require("../../infra-node/src/httpClient.cjs")
// preload.cjs 位于 apps/desktop/dist-electron/main/
// 运行时查找路径为：dist-electron/main/ -> ../../ -> dist-electron/ 同级目录
// 实际上 Electron 在打包后是以 app.asar 运行，路径会变。

// 开发态最快修复方案：将符号链接直接创建在 dist-electron 目录下，并修正 preload 逻辑
const packagesSource = path.resolve(root, '../../packages')
const platformsLink = path.join(outDir, 'platforms')
const infraNodeLink = path.join(outDir, 'infra-node')

// 我们在 dist-electron 下创建链接，这样从 dist-electron/main/ 出来的 ../ 就是 dist-electron/
if (!fs.existsSync(platformsLink)) {
  console.log(`[Postbuild] Creating link: ${platformsLink} -> ${path.join(packagesSource, 'platforms')}`)
  try {
    fs.symlinkSync(path.join(packagesSource, 'platforms'), platformsLink, 'dir')
  } catch (err) {}
}

if (!fs.existsSync(infraNodeLink)) {
  console.log(`[Postbuild] Creating link: ${infraNodeLink} -> ${path.join(packagesSource, 'infra-node')}`)
  try {
    fs.symlinkSync(path.join(packagesSource, 'infra-node'), infraNodeLink, 'dir')
  } catch (err) {}
}

console.log('[Postbuild] Done (Vite handled main and preload builds + Environment Linked)')
