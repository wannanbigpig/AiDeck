const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const codexService = require(path.join(__dirname, '..', 'packages', 'platforms', 'src', 'codexService.cjs'))
const geminiService = require(path.join(__dirname, '..', 'packages', 'platforms', 'src', 'geminiService.cjs'))
const antigravityService = require(path.join(__dirname, '..', 'packages', 'platforms', 'src', 'antigravityService.cjs'))

test('Codex / OpenCode 默认候选路径按平台返回首选项', () => {
  const macRuntime = { platform: 'darwin', homeDir: '/Users/tester', env: {} }
  const winRuntime = {
    platform: 'win32',
    homeDir: 'C:\\Users\\tester',
    env: {
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)'
    }
  }
  const linuxRuntime = { platform: 'linux', homeDir: '/home/tester', env: {} }

  assert.equal(codexService.getCodexAppPathCandidates(macRuntime)[0], '/Applications/Codex.app')
  assert.equal(codexService.getOpenCodeAppPathCandidates(macRuntime)[0], '/Applications/OpenCode.app')

  assert.equal(
    codexService.getCodexAppPathCandidates(winRuntime)[0],
    path.join('C:\\Users\\tester\\AppData\\Local', 'Programs', 'Codex', 'Codex.exe')
  )
  assert.equal(
    codexService.getOpenCodeAppPathCandidates(winRuntime)[0],
    path.join('C:\\Users\\tester\\AppData\\Local', 'Programs', 'OpenCode', 'OpenCode.exe')
  )

  assert.equal(codexService.getCodexAppPathCandidates(linuxRuntime)[0], '/usr/bin/codex')
  assert.equal(codexService.getOpenCodeAppPathCandidates(linuxRuntime)[0], '/usr/bin/opencode')

  assert.equal(codexService.getDefaultCodexAppPath(winRuntime), codexService.getCodexAppPathCandidates(winRuntime)[0])
  assert.equal(codexService.getDefaultOpenCodeAppPath(linuxRuntime), codexService.getOpenCodeAppPathCandidates(linuxRuntime)[0])
})

test('Codex / Gemini 配置目录候选应覆盖多系统路径', () => {
  const winRuntime = {
    platform: 'win32',
    homeDir: 'C:\\Users\\tester',
    env: {
      APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local'
    }
  }
  const linuxRuntime = {
    platform: 'linux',
    homeDir: '/home/tester',
    env: {
      XDG_CONFIG_HOME: '/home/tester/.config-xdg'
    }
  }

  assert.deepEqual(codexService.getConfigDirCandidates(winRuntime), [
    path.join('C:\\Users\\tester', '.codex'),
    path.join('C:\\Users\\tester\\AppData\\Roaming', 'Codex'),
    path.join('C:\\Users\\tester\\AppData\\Roaming', '.codex'),
    path.join('C:\\Users\\tester\\AppData\\Local', 'Codex'),
    path.join('C:\\Users\\tester\\AppData\\Local', '.codex')
  ])

  assert.deepEqual(geminiService.getConfigDirCandidates(winRuntime), [
    path.join('C:\\Users\\tester', '.gemini'),
    path.join('C:\\Users\\tester\\AppData\\Roaming', 'Gemini'),
    path.join('C:\\Users\\tester\\AppData\\Roaming', '.gemini'),
    path.join('C:\\Users\\tester\\AppData\\Local', 'Gemini'),
    path.join('C:\\Users\\tester\\AppData\\Local', '.gemini')
  ])

  assert.deepEqual(codexService.getConfigDirCandidates(linuxRuntime), [
    '/home/tester/.codex',
    '/home/tester/.config-xdg/codex',
    '/home/tester/.config-xdg/.codex',
    '/home/tester/.config/codex',
    '/home/tester/.config/.codex'
  ])

  assert.deepEqual(geminiService.getConfigDirCandidates(linuxRuntime), [
    '/home/tester/.gemini',
    '/home/tester/.config-xdg/gemini',
    '/home/tester/.config-xdg/.gemini',
    '/home/tester/.config/gemini',
    '/home/tester/.config/.gemini'
  ])
})

test('Antigravity 本地状态路径与 watcher 目标应保持一致', () => {
  const winRuntime = {
    platform: 'win32',
    homeDir: 'C:\\Users\\tester',
    env: {
      APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local'
    }
  }

  const stateDbCandidates = antigravityService.getStateDbPathCandidates(winRuntime)
  assert.deepEqual(stateDbCandidates, [
    path.join('C:\\Users\\tester\\AppData\\Roaming', 'Antigravity', 'User', 'globalStorage', 'state.vscdb')
  ])

  const watchTargets = antigravityService.getLocalStateWatchTargets(winRuntime)
  assert.deepEqual(watchTargets.dirPaths, stateDbCandidates.map(item => path.dirname(item)))
  assert.deepEqual(watchTargets.fileNames, ['state.vscdb'])
  assert.equal(watchTargets.watchWholeDir, true)

  const localStatePaths = antigravityService.getLocalStatePaths(winRuntime)
  assert.equal(
    localStatePaths.storagePath,
    path.join('C:\\Users\\tester\\AppData\\Roaming', 'Antigravity', 'User', 'globalStorage', 'storage.json')
  )
  assert.equal(
    localStatePaths.machineIdPath,
    path.join('C:\\Users\\tester\\AppData\\Roaming', 'Antigravity', 'machineid')
  )
  assert.equal(localStatePaths.stateDbPath, stateDbCandidates[0])
})

test('Codex / Gemini watcher 目标应直接复用配置目录候选', () => {
  const linuxRuntime = {
    platform: 'linux',
    homeDir: '/home/tester',
    env: {
      XDG_CONFIG_HOME: '/home/tester/.config-xdg'
    }
  }

  const codexTargets = codexService.getLocalStateWatchTargets(linuxRuntime)
  assert.deepEqual(codexTargets.dirPaths, codexService.getConfigDirCandidates(linuxRuntime))
  assert.deepEqual(codexTargets.fileNames, ['auth.json'])

  const geminiTargets = geminiService.getLocalStateWatchTargets(linuxRuntime)
  assert.deepEqual(geminiTargets.dirPaths, geminiService.getConfigDirCandidates(linuxRuntime))
  assert.deepEqual(geminiTargets.fileNames, ['oauth_creds.json', 'google_accounts.json'])
})
