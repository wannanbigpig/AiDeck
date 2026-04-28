const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('terminalLauncher 应返回 CLI 检测状态与安装命令', () => {
  const launcher = require(path.join(process.cwd(), 'packages/infra-node/src/terminalLauncher.cjs'))

  const missing = launcher.getCommandStatus('definitely-not-aideck-cli')
  assert.equal(missing.available, false)

  const codex = launcher.getCommandStatus('codex')
  assert.equal(codex.command, 'codex')
  assert.equal(codex.installCommand, 'npm install -g @openai/codex')

  const gemini = launcher.getCommandStatus('gemini')
  assert.equal(gemini.command, 'gemini')
  assert.equal(gemini.installCommand, 'npm install -g @google/gemini-cli')
})

test('terminalLauncher 应至少返回系统默认终端选项', () => {
  const launcher = require(path.join(process.cwd(), 'packages/infra-node/src/terminalLauncher.cjs'))
  const terminals = launcher.getAvailableTerminals()

  assert.equal(Array.isArray(terminals), true)
  assert.deepEqual(terminals[0], { value: 'system', label: '系统默认' })
})

test('terminalLauncher 应列出当前系统可检测到的 macOS 终端', () => {
  if (process.platform !== 'darwin') return
  const launcher = require(path.join(process.cwd(), 'packages/infra-node/src/terminalLauncher.cjs'))
  const terminals = launcher.getAvailableTerminals()
  const values = terminals.map(item => item.value)

  if (fs.existsSync('/System/Applications/Utilities/Terminal.app') || fs.existsSync('/Applications/Utilities/Terminal.app')) {
    assert.ok(values.includes('Terminal'))
  }
  if (fs.existsSync('/Applications/iTerm.app') || fs.existsSync('/Applications/iTerm 2.app')) {
    assert.ok(values.includes('iTerm2'))
  }
})

test('terminalLauncher 应在受限 PATH 下扫描用户 CLI 目录', () => {
  if (process.platform !== 'darwin') return
  const launcher = require(path.join(process.cwd(), 'packages/infra-node/src/terminalLauncher.cjs'))
  const codexPath = path.join(process.env.HOME || '', '.npm-global/bin/codex')
  const geminiPath = path.join(process.env.HOME || '', '.npm-global/bin/gemini')
  if (!fs.existsSync(codexPath) && !fs.existsSync(geminiPath)) return

  const originalPath = process.env.PATH
  process.env.PATH = '/usr/bin:/bin'
  try {
    if (fs.existsSync(codexPath)) {
      const codex = launcher.getCommandStatus('codex')
      assert.equal(codex.available, true)
      assert.equal(codex.path, codexPath)
    }
    if (fs.existsSync(geminiPath)) {
      const gemini = launcher.getCommandStatus('gemini')
      assert.equal(gemini.available, true)
      assert.equal(gemini.path, geminiPath)
    }
  } finally {
    process.env.PATH = originalPath
  }
})

test('terminalLauncher 应构建包含用户 Node 目录的运行环境', () => {
  if (process.platform !== 'darwin') return
  const launcher = require(path.join(process.cwd(), 'packages/infra-node/src/terminalLauncher.cjs'))
  const originalPath = process.env.PATH
  process.env.PATH = '/usr/bin:/bin'
  try {
    const env = launcher.buildRuntimeEnv({ CODEX_HOME: '/tmp/aideck-codex-home' })
    assert.equal(env.CODEX_HOME, '/tmp/aideck-codex-home')
    assert.ok(env.PATH.includes('/usr/bin'))
    assert.ok(env.PATH.includes('/opt/homebrew/bin') || env.PATH.includes('/usr/local/bin'))
    assert.ok(env.PATH.includes(path.join(process.env.HOME || '', '.npm-global/bin')))
  } finally {
    process.env.PATH = originalPath
  }
})

test('terminalLauncher 应为 Windows 补齐常见 Node 和包管理器目录', () => {
  const launcher = require(path.join(process.cwd(), 'packages/infra-node/src/terminalLauncher.cjs'))
  const runtime = {
    platform: 'win32',
    homeDir: 'C:\\Users\\tester',
    env: {
      PATH: 'C:\\Windows\\System32;C:\\Windows',
      APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      ProgramData: 'C:\\ProgramData',
      NVM_HOME: 'C:\\Users\\tester\\AppData\\Roaming\\nvm',
      NVM_SYMLINK: 'C:\\Program Files\\nodejs'
    }
  }
  const dirs = launcher.collectRuntimeSearchDirs(runtime)
  const runtimePath = launcher.buildRuntimePath(runtime)

  assert.ok(dirs.includes('C:\\Windows\\System32'))
  assert.ok(dirs.includes(path.join('C:\\Users\\tester\\AppData\\Roaming', 'npm')))
  assert.ok(dirs.includes(path.join('C:\\Users\\tester\\AppData\\Local', 'Programs', 'nodejs')))
  assert.ok(dirs.includes(path.join('C:\\Program Files', 'nodejs')))
  assert.ok(dirs.includes(path.join('C:\\ProgramData', 'chocolatey', 'bin')))
  assert.ok(dirs.includes(path.join('C:\\Users\\tester', 'scoop', 'shims')))
  assert.ok(dirs.includes(path.join('C:\\Users\\tester', '.volta', 'bin')))
  assert.ok(runtimePath.includes(';'))
})

test('terminalLauncher 应为 Linux 补齐系统和用户 CLI 目录', () => {
  const launcher = require(path.join(process.cwd(), 'packages/infra-node/src/terminalLauncher.cjs'))
  const runtime = {
    platform: 'linux',
    homeDir: '/home/tester',
    env: {
      PATH: '/usr/bin:/bin'
    }
  }
  const dirs = launcher.collectRuntimeSearchDirs(runtime)
  const runtimePath = launcher.buildRuntimePath(runtime)

  assert.ok(dirs.includes('/usr/bin'))
  assert.ok(dirs.includes('/usr/local/bin'))
  assert.ok(dirs.includes('/snap/bin'))
  assert.ok(dirs.includes('/home/tester/.npm-global/bin'))
  assert.ok(dirs.includes('/home/tester/.volta/bin'))
  assert.ok(runtimePath.includes(':'))
})

test('terminalLauncher 应把 Codex 绑定实例环境变量注入启动命令', () => {
  const launcher = require(path.join(process.cwd(), 'packages/infra-node/src/terminalLauncher.cjs'))
  const command = launcher._internal.buildShellCommand({
    commandName: 'codex',
    executableCommand: '/usr/local/bin/codex',
    cwd: '/tmp/aideck workspace',
    env: {
      CODEX_HOME: '/tmp/aideck codex home',
      'bad-name': 'ignored'
    },
    args: ['--model', 'gpt-5.3-codex']
  })

  assert.ok(command.includes('CODEX_HOME='))
  assert.ok(command.includes('/tmp/aideck codex home'))
  assert.ok(command.includes('/usr/local/bin/codex'))
  assert.ok(command.includes('gpt-5.3-codex'))
  assert.equal(command.includes('bad-name'), false)
})
