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
