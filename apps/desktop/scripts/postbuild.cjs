const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'dist-electron')
const mainOutDir = path.join(outDir, 'main')

fs.mkdirSync(mainOutDir, { recursive: true })
fs.copyFileSync(path.join(root, 'src', 'main', 'main.cjs'), path.join(mainOutDir, 'main.cjs'))
fs.copyFileSync(path.join(root, 'src', 'main', 'preload.cjs'), path.join(mainOutDir, 'preload.cjs'))
