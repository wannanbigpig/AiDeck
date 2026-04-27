import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const outputDir = path.join(rootDir, 'dist')
const checksumPath = path.join(outputDir, 'SHA256SUMS.txt')

function calculateSha256 (filePath) {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

function listFiles (dirPath, prefix = '') {
  if (!fs.existsSync(dirPath)) return []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name)
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFiles(fullPath, relativePath))
      continue
    }
    if (entry.name === 'SHA256SUMS.txt') continue
    out.push(relativePath)
  }
  return out.sort()
}

function runRelease () {
  console.log('开始构建 uTools 插件产物...')

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true })
  }

  execSync('npm run build -w @aideck/utools', {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${path.join(rootDir, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`
    }
  })

  const files = listFiles(outputDir)
  if (files.length === 0) {
    throw new Error(`uTools 构建产物为空: ${outputDir}`)
  }

  const checksumLines = files.map(relativePath => {
    const filePath = path.join(outputDir, relativePath)
    return `${calculateSha256(filePath)}  ${relativePath.split(path.sep).join('/')}`
  })

  fs.writeFileSync(checksumPath, checksumLines.join('\n') + '\n')

  console.log(`uTools 插件产物已生成: ${outputDir}`)
  console.log(`校验文件已生成: ${checksumPath}`)
  console.log(`共计校验 ${files.length} 个文件`)
}

try {
  runRelease()
} catch (error) {
  console.error('发布构建失败:', error && error.message ? error.message : String(error))
  process.exit(1)
}
