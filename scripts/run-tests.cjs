const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const rootDir = path.resolve(__dirname, '..')
const testsDir = path.join(rootDir, 'tests')

function collectTestFiles (dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.test.cjs')) {
      files.push(fullPath)
    }
  }
  return files
}

const files = collectTestFiles(testsDir).sort()
const help = spawnSync(process.execPath, ['--help'], { encoding: 'utf8' })
const supportsForceExit = String(help.stdout || '').includes('--test-force-exit')
const args = ['--test']
if (supportsForceExit) args.push('--test-force-exit')
args.push('--test-concurrency=1', ...files)

const result = spawnSync(process.execPath, args, {
  cwd: rootDir,
  stdio: 'inherit'
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status == null ? 1 : result.status)
