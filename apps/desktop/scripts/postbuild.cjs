const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'dist-electron')
const mainOutDir = path.join(outDir, 'main')

// 确保目录存在（虽然 Vite 应该已经创建了）
if (!fs.existsSync(mainOutDir)) {
  fs.mkdirSync(mainOutDir, { recursive: true })
}

// 注意：不再手动拷贝 main.cjs 和 preload.cjs，因为 vite-plugin-electron 会负责构建并打包依赖。
// 如果手动拷贝源文件，会导致相对路径引用包失败且 Node.js 模块引用可能不兼容。
console.log('[Postbuild] Done (Vite handled main and preload builds)')
