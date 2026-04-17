import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const desktopDir = path.join(rootDir, 'apps', 'desktop')
const outputDir = path.join(desktopDir, 'dist-packages')

function calculateSha256(filePath) {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

function isPublishableFile(filename) {
  const exts = ['.dmg', '.zip', '.exe', '.AppImage', '.deb', '.rpm', '.blockmap', '.yml', '.yaml']
  return exts.some(ext => filename.endsWith(ext))
}

async function runRelease() {
  console.log('🚀 开始工业级一键构建流程...')

  const dirsToClean = [
    outputDir,
    path.join(desktopDir, 'dist-electron')
  ]

  for (const dir of dirsToClean) {
    if (fs.existsSync(dir)) {
      const realPath = fs.realpathSync(dir)
      console.log(`🧹 正在清理: ${path.relative(rootDir, dir)} (实际路径: ${realPath})...`)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  const env = {
    ...process.env,
    PATH: `${path.join(rootDir, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}`,
    ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
    ELECTRON_BUILDER_SKIP_DEPENDENCIES_INSTALL: 'true',
    USE_HARD_LINKS: 'false'
  }
  delete env.ELECTRON_CUSTOM_DIR

  try {
    console.log('📦 正在构建桌面端产物 (Vite)...')
    const viteBin = path.join(rootDir, 'node_modules', '.bin', 'vite')
    const buildCmd = `${viteBin} build --config vite.config.mjs`
    
    console.log(`🛠️  执行构建: ${buildCmd}`)
    execSync(buildCmd, { stdio: 'inherit', env, cwd: desktopDir })
    
    console.log('📦 正在后置处理构建产物...')
    execSync(`node scripts/postbuild.cjs`, { stdio: 'inherit', env, cwd: desktopDir })
    
    console.log('📦 正在构建多平台产物 (Electron-Builder)...')
    execSync('npx electron-builder build --mac --win --linux', { stdio: 'inherit', env, cwd: desktopDir })

    console.log('\n✅ 核心构建步骤结束。开始生成校验文件...')

    if (!fs.existsSync(outputDir)) {
      throw new Error(`构建输出目录不存在: ${outputDir}`)
    }

    const files = fs.readdirSync(outputDir)
      .filter(f => isPublishableFile(f))
      .sort()

    const checksumLines = []
    for (const file of files) {
      const filePath = path.join(outputDir, file)
      if (fs.statSync(filePath).isDirectory()) continue
      
      console.log(`🔍 正在计算哈希: ${file}`)
      const sha256 = calculateSha256(filePath)
      checksumLines.push(`${sha256}  ${file}`)
    }

    const checksumPath = path.join(outputDir, 'SHA256SUMS.txt')
    fs.writeFileSync(checksumPath, checksumLines.join('\n') + '\n')
    
    console.log('\n-----------------------------------')
    console.log(`✨ 成功！校验文件已生成: ${checksumPath}`)
    console.log(`📁 构建产物位于: ${outputDir}`)
    console.log(`📊 共计校验 ${files.length} 个文件`)
    console.log('-----------------------------------\n')

  } catch (error) {
    console.error('❌ 构建脚本发生严重错误:', error.message)
    process.exit(1)
  }
}

runRelease()
