const test = require('node:test')
const assert = require('node:assert/strict')
const cp = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function base64UrlJson (payload) {
  return Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function fakeJwt (payload) {
  return [
    base64UrlJson({ alg: 'none', typ: 'JWT' }),
    base64UrlJson(payload),
    'sig'
  ].join('.')
}

test('Codex CLI 绑定实例应复用 CODEX_HOME、隔离会话且不切换当前账号', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-cli-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const current = storage.addAccount('codex', {
      id: 'codex-current',
      email: 'current@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-current' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'current@example.com' }),
        refresh_token: 'rt-current'
      }
    })
    const target = storage.addAccount('codex', {
      id: 'codex-target',
      email: 'target@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-target' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'target@example.com' }),
        refresh_token: 'rt-target'
      }
    })
    const another = storage.addAccount('codex', {
      id: 'codex-another',
      email: 'another@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-another' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'another@example.com' }),
        refresh_token: 'rt-another'
      }
    })
    storage.setCurrentId('codex', current.id)

    const first = await codex.prepareCliLaunch(target.id)
    const second = await codex.prepareCliLaunch(target.id)

    assert.equal(first.success, true)
    assert.equal(second.success, true)
    assert.ok(first.env.CODEX_HOME)
    assert.ok(second.env.CODEX_HOME)
    assert.equal(first.env.CODEX_HOME, second.env.CODEX_HOME)
    assert.equal(first.firstBind, true)
    assert.equal(second.firstBind, false)
    assert.equal(storage.getCurrentId('codex'), current.id)

    const auth = JSON.parse(fs.readFileSync(path.join(first.env.CODEX_HOME, 'auth.json'), 'utf8'))
    assert.equal(auth.auth_mode, 'chatgpt')
    assert.equal(auth.tokens.refresh_token, 'rt-target')
    assert.equal(auth.tokens.account_id, 'acc-target')

    const savedTarget = storage.getAccount('codex', target.id)
    assert.equal(savedTarget.codex_cli_instance_dir, first.env.CODEX_HOME)

    const sessionPath = path.join(first.env.CODEX_HOME, 'sessions')
    const archivedPath = path.join(first.env.CODEX_HOME, 'archived_sessions')
    const sessionIndexPath = path.join(first.env.CODEX_HOME, 'session_index.jsonl')
    const historyPath = path.join(first.env.CODEX_HOME, 'history.jsonl')
    assert.equal(fs.lstatSync(sessionPath).isSymbolicLink(), false)
    assert.equal(fs.lstatSync(archivedPath).isSymbolicLink(), false)
    assert.equal(fs.lstatSync(sessionIndexPath).isSymbolicLink(), false)
    assert.equal(fs.existsSync(historyPath), true)

    const third = await codex.prepareCliLaunch(another.id)
    assert.equal(third.success, true)
    assert.notEqual(third.env.CODEX_HOME, first.env.CODEX_HOME)
    assert.notEqual(fs.realpathSync(path.join(third.env.CODEX_HOME, 'sessions')), fs.realpathSync(sessionPath))
    assert.notEqual(fs.realpathSync(path.join(third.env.CODEX_HOME, 'session_index.jsonl')), fs.realpathSync(sessionIndexPath))

    assert.equal(codex.deleteAccount(target.id), true)
    assert.equal(fs.existsSync(first.env.CODEX_HOME), false)
    assert.equal(fs.existsSync(third.env.CODEX_HOME), true)
    assert.equal(codex.deleteAccount(another.id), true)
    assert.equal(fs.existsSync(third.env.CODEX_HOME), false)
    assert.equal(storage.getCurrentId('codex'), current.id)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 绑定实例应清理旧版共享会话软链接', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-cli-migrate-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-migrate',
      email: 'migrate@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-migrate' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'migrate@example.com' }),
        refresh_token: 'rt-migrate'
      }
    })

    const first = await codex.prepareCliLaunch(account.id)
    assert.equal(first.success, true)

    const sharedRoot = path.join(root, 'instances', 'codex-cli', '_shared')
    const sharedSessions = path.join(sharedRoot, 'sessions')
    const sharedIndex = path.join(sharedRoot, 'session_index.jsonl')
    fs.mkdirSync(sharedSessions, { recursive: true })
    fs.mkdirSync(path.dirname(sharedIndex), { recursive: true })
    fs.writeFileSync(sharedIndex, '', 'utf8')

    const instanceSessions = path.join(first.env.CODEX_HOME, 'sessions')
    const instanceIndex = path.join(first.env.CODEX_HOME, 'session_index.jsonl')
    fs.rmSync(instanceSessions, { recursive: true, force: true })
    fs.rmSync(instanceIndex, { force: true })
    fs.symlinkSync(sharedSessions, instanceSessions, process.platform === 'win32' ? 'junction' : undefined)
    fs.symlinkSync(sharedIndex, instanceIndex)

    const second = await codex.prepareCliLaunch(account.id)
    assert.equal(second.success, true)
    assert.equal(second.env.CODEX_HOME, first.env.CODEX_HOME)
    assert.equal(fs.lstatSync(instanceSessions).isSymbolicLink(), false)
    assert.equal(fs.lstatSync(instanceIndex).isSymbolicLink(), false)
    assert.notEqual(fs.realpathSync(instanceSessions), fs.realpathSync(sharedSessions))
    assert.notEqual(fs.realpathSync(instanceIndex), fs.realpathSync(sharedIndex))
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应按实例隔离并按工作区分组', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-cli-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const firstAccount = storage.addAccount('codex', {
      id: 'codex-session-a',
      email: 'session-a@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-session-a' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'session-a@example.com' }),
        refresh_token: 'rt-session-a'
      }
    })
    const secondAccount = storage.addAccount('codex', {
      id: 'codex-session-b',
      email: 'session-b@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-session-b' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'session-b@example.com' }),
        refresh_token: 'rt-session-b'
      }
    })

    const first = await codex.prepareCliLaunch(firstAccount.id)
    const second = await codex.prepareCliLaunch(secondAccount.id)
    assert.equal(first.success, true)
    assert.equal(second.success, true)

    const firstSessionPath = path.join(first.env.CODEX_HOME, 'sessions', '2026', '04', '28', 'rollout-a.jsonl')
    const secondSessionPath = path.join(second.env.CODEX_HOME, 'sessions', '2026', '04', '28', 'rollout-b.jsonl')
    fs.mkdirSync(path.dirname(firstSessionPath), { recursive: true })
    fs.mkdirSync(path.dirname(secondSessionPath), { recursive: true })
    fs.writeFileSync(firstSessionPath, JSON.stringify({ type: 'metadata', cwd: '/work/Aideck', title: 'Aideck 调试' }) + '\n', 'utf8')
    fs.writeFileSync(secondSessionPath, JSON.stringify({ type: 'metadata', cwd: '/work/codex-tools', title: '工具检查' }) + '\n', 'utf8')
    fs.writeFileSync(path.join(first.env.CODEX_HOME, 'session_index.jsonl'), JSON.stringify({
      id: 'session-a',
      title: 'Aideck 首页',
      cwd: '/work/Aideck',
      rollout_path: firstSessionPath,
      updated_at: 1777372800000
    }) + '\n', 'utf8')

    const result = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(result.success, true)
    assert.equal(result.totals.boundAccounts, 2)
    assert.equal(result.totals.sessions, 2)
    assert.equal(result.groups.length, 2)

    const aideckGroup = result.groups.find(group => group.workspaceName === 'Aideck')
    const toolsGroup = result.groups.find(group => group.workspaceName === 'codex-tools')
    assert.ok(aideckGroup)
    assert.ok(toolsGroup)
    assert.equal(aideckGroup.sessions[0].accountId, firstAccount.id)
    assert.equal(aideckGroup.sessions[0].resumeCommand, 'codex resume session-a')
    assert.equal(toolsGroup.sessions[0].accountId, secondAccount.id)
    assert.notEqual(aideckGroup.sessions[0].instanceDir, toolsGroup.sessions[0].instanceDir)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话继续聊天应使用会话所属实例', async (t) => {
  try {
    cp.execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    t.skip('sqlite3 命令不可用')
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-session-resume-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const firstAccount = storage.addAccount('codex', {
      id: 'codex-resume-a',
      email: 'resume-a@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-resume-a' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'resume-a@example.com' }),
        refresh_token: 'rt-resume-a'
      }
    })
    const secondAccount = storage.addAccount('codex', {
      id: 'codex-resume-b',
      email: 'resume-b@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-resume-b' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'resume-b@example.com' }),
        refresh_token: 'rt-resume-b'
      }
    })

    const first = await codex.prepareCliLaunch(firstAccount.id)
    const second = await codex.prepareCliLaunch(secondAccount.id)
    assert.equal(first.success, true)
    assert.equal(second.success, true)

    const workspace = path.join(root, 'shared-workspace')
    fs.mkdirSync(workspace, { recursive: true })
    const firstSessionPath = path.join(first.env.CODEX_HOME, 'sessions', '2026', '04', '28', 'rollout-resume-first.jsonl')
    const secondSessionPath = path.join(second.env.CODEX_HOME, 'sessions', '2026', '04', '28', 'rollout-resume-second.jsonl')
    fs.mkdirSync(path.dirname(firstSessionPath), { recursive: true })
    fs.mkdirSync(path.dirname(secondSessionPath), { recursive: true })
    fs.writeFileSync(firstSessionPath, JSON.stringify({ type: 'metadata', cwd: workspace, title: '同工作区实例 A' }) + '\n', 'utf8')
    fs.writeFileSync(secondSessionPath, JSON.stringify({ type: 'metadata', cwd: workspace, title: '同工作区实例 B' }) + '\n', 'utf8')

    for (const item of [
      { home: first.env.CODEX_HOME, id: 'resume-first', sessionPath: firstSessionPath, title: '同工作区实例 A' },
      { home: second.env.CODEX_HOME, id: 'resume-second', sessionPath: secondSessionPath, title: '同工作区实例 B' }
    ]) {
      cp.execFileSync('sqlite3', [path.join(item.home, 'state_5.sqlite'), [
        'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, updated_at_ms INTEGER, created_at_ms INTEGER, archived INTEGER);',
        `INSERT INTO threads VALUES ('${item.id}', '${item.sessionPath}', '${workspace}', '${item.title}', 1777372800000, 1777372700000, 0);`
      ].join('\n')])
    }

    const result = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(result.success, true)
    assert.equal(result.groups.length, 1)
    assert.equal(result.groups[0].sessions.length, 2)

    const firstResume = codex.prepareCliSessionResume({ sessionId: 'resume-first', sourcePath: firstSessionPath, includeDefaultHome: false })
    const secondResume = codex.prepareCliSessionResume({ sessionId: 'resume-second', sourcePath: secondSessionPath, includeDefaultHome: false })
    assert.equal(firstResume.success, true)
    assert.equal(secondResume.success, true)
    assert.deepEqual(firstResume.args, ['resume', 'resume-first'])
    assert.deepEqual(secondResume.args, ['resume', 'resume-second'])
    assert.equal(firstResume.cwd, workspace)
    assert.equal(secondResume.cwd, workspace)
    assert.equal(firstResume.env.CODEX_HOME, first.env.CODEX_HOME)
    assert.equal(secondResume.env.CODEX_HOME, second.env.CODEX_HOME)
    assert.notEqual(firstResume.env.CODEX_HOME, secondResume.env.CODEX_HOME)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应展示默认 ~/.codex 会话', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-default-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const defaultCodexHome = path.join(root, 'home', '.codex')
    const sessionPath = path.join(defaultCodexHome, 'sessions', '2026', '04', '28', 'rollout-default.jsonl')
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, JSON.stringify({ type: 'metadata', cwd: '/work/default-codex', title: '默认会话' }) + '\n', 'utf8')
    fs.writeFileSync(path.join(defaultCodexHome, 'session_index.jsonl'), JSON.stringify({
      id: 'default-session',
      title: '默认 Codex 会话',
      cwd: '/work/default-codex',
      rollout_path: sessionPath,
      updated_at_ms: 1777372800000
    }) + '\n', 'utf8')
    fs.writeFileSync(path.join(defaultCodexHome, '.codex-global-state.json'), JSON.stringify({
      'project-order': ['/work/default-codex', '/work/empty-project'],
      'electron-saved-workspace-roots': ['/work/default-codex', '/work/empty-project']
    }), 'utf8')

    const result = codex.listCliSessions({ defaultCodexHomeDir: defaultCodexHome })
    assert.equal(result.success, true)
    assert.equal(result.totals.sources, 1)
    assert.equal(result.totals.boundAccounts, 0)
    assert.equal(result.totals.sessions, 1)
    assert.equal(result.totals.groups, 2)
    assert.equal(result.accounts[0].sourceType, 'default')
    assert.equal(result.groups[0].workspaceName, 'default-codex')
    assert.equal(result.groups[0].count, 1)
    assert.equal(result.groups[1].workspaceName, 'empty-project')
    assert.equal(result.groups[1].count, 0)
    assert.equal(result.groups[1].emptyWorkspace, true)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应为账号实例补齐已保存工作区', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-account-workspaces-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-workspace-account',
      email: 'workspace@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'workspace@example.com' }),
        refresh_token: 'rt-workspace'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    fs.writeFileSync(path.join(prepared.env.CODEX_HOME, '.codex-global-state.json'), JSON.stringify({
      'project-order': ['/work/account-empty'],
      'electron-saved-workspace-roots': ['/work/account-empty']
    }), 'utf8')

    const result = codex.listCliSessions({ accountId: account.id, includeDefaultHome: false })
    assert.equal(result.success, true)
    assert.equal(result.totals.sources, 1)
    assert.equal(result.totals.sessions, 0)
    assert.equal(result.totals.groups, 1)
    assert.equal(result.groups[0].workspaceName, 'account-empty')
    assert.equal(result.groups[0].count, 0)
    assert.equal(result.groups[0].emptyWorkspace, true)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应在账号实例缺少项目缓存时使用默认工作区兜底', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-account-workspace-fallback-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-workspace-fallback-account',
      email: 'workspace-fallback@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'workspace-fallback@example.com' }),
        refresh_token: 'rt-workspace-fallback'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const defaultCodexHome = path.join(root, 'home', '.codex')
    fs.mkdirSync(defaultCodexHome, { recursive: true })
    fs.writeFileSync(path.join(defaultCodexHome, '.codex-global-state.json'), JSON.stringify({
      'project-order': ['/work/default-fallback'],
      'electron-saved-workspace-roots': ['/work/default-fallback']
    }), 'utf8')

    const result = codex.listCliSessions({ accountId: account.id, defaultCodexHomeDir: defaultCodexHome })
    assert.equal(result.success, true)
    assert.equal(result.totals.sources, 1)
    assert.equal(result.totals.sessions, 0)
    assert.equal(result.totals.groups, 1)
    assert.equal(result.groups[0].workspaceName, 'default-fallback')
    assert.equal(result.groups[0].emptyWorkspace, true)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话索引缺少 rollout_path 时不应把 session_index 当作会话文件', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-index-fallback-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const defaultCodexHome = path.join(root, 'home', '.codex')
    const indexPath = path.join(defaultCodexHome, 'session_index.jsonl')
    fs.mkdirSync(defaultCodexHome, { recursive: true })
    fs.writeFileSync(indexPath, JSON.stringify({
      id: 'index-only-session',
      title: '索引缺少路径',
      cwd: '/work/index-only',
      updated_at_ms: 1777372800000
    }) + '\n', 'utf8')

    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    const result = codex.listCliSessions({ defaultCodexHomeDir: defaultCodexHome })
    assert.equal(result.success, true)
    assert.equal(result.totals.sessions, 1)
    assert.equal(result.groups[0].sessions[0].sessionId, 'index-only-session')
    assert.equal(result.groups[0].sessions[0].path, '')
    assert.equal(result.groups[0].sessions[0].status, 'broken')
    assert.equal(result.groups[0].sessions[0].statusReason, '缺少会话文件路径')

    const moved = codex.moveCliSessionsToTrash({
      sessionId: 'index-only-session',
      defaultCodexHomeDir: defaultCodexHome
    })
    assert.equal(moved.success, false)
    assert.equal(moved.moved, 0)
    assert.equal(fs.existsSync(indexPath), true)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话索引缺少路径但真实会话文件存在时不应显示重复异常', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-index-file-merge-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const defaultCodexHome = path.join(root, 'home', '.codex')
    const sessionId = '019dd367-e263-79f0-82fa-993216572d86'
    const workspacePath = path.join(root, 'Documents', 'Codex', '2026-04-28', 'new-chat')
    const sessionPath = path.join(defaultCodexHome, 'sessions', '2026', '04', '28', `rollout-2026-04-28T17-24-53-${sessionId}.jsonl`)
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(path.join(defaultCodexHome, 'session_index.jsonl'), JSON.stringify({
      id: sessionId,
      thread_name: '打招呼',
      updated_at: '2026-04-28T09:25:04.450155Z'
    }) + '\n', 'utf8')
    fs.writeFileSync(sessionPath, [
      JSON.stringify({ timestamp: '2026-04-28T09:25:03.941Z', type: 'session_meta', payload: { id: sessionId, cwd: workspacePath } }),
      JSON.stringify({ timestamp: '2026-04-28T09:25:03.944Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }] } })
    ].join('\n') + '\n', 'utf8')

    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    const result = codex.listCliSessions({ defaultCodexHomeDir: defaultCodexHome })
    assert.equal(result.success, true)
    assert.equal(result.totals.sessions, 1)
    assert.equal(result.groups.length, 1)
    assert.equal(result.groups[0].workspaceName, 'new-chat')
    assert.equal(result.groups[0].sessions[0].sessionId, sessionId)
    assert.equal(result.groups[0].sessions[0].path, sessionPath)
    assert.equal(result.groups[0].sessions[0].status, 'unindexed')
    assert.equal(result.groups[0].sessions.some(session => session.status === 'broken'), false)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话扫描不应把保留 JSONL 文件当作会话', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-reserved-jsonl-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const defaultCodexHome = path.join(root, 'home', '.codex')
    const sessionsDir = path.join(defaultCodexHome, 'sessions', '2026', '04', '28')
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(path.join(sessionsDir, 'session_index.jsonl'), JSON.stringify({
      id: 'index-file-inside-sessions',
      cwd: '/work/should-not-show'
    }) + '\n', 'utf8')
    fs.writeFileSync(path.join(sessionsDir, 'history.jsonl'), JSON.stringify({
      id: 'history-file-inside-sessions',
      cwd: '/work/should-not-show'
    }) + '\n', 'utf8')

    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    const result = codex.listCliSessions({ defaultCodexHomeDir: defaultCodexHome })
    assert.equal(result.success, true)
    assert.equal(result.totals.sessions, 0)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 移动回收站时 ID 和路径不一致不应误删真实会话', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-trash-mismatch-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-mismatch-account',
      email: 'mismatch@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'mismatch@example.com' }),
        refresh_token: 'rt-mismatch'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const sessionId = '019dd1d3-bb36-7a83-9033-6cc188563614'
    const sessionPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', `rollout-${sessionId}.jsonl`)
    const reservedPath = path.join(prepared.env.CODEX_HOME, 'session_index.jsonl')
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, JSON.stringify({ type: 'metadata', cwd: '/work/mismatch', title: '真实会话' }) + '\n', 'utf8')
    fs.writeFileSync(reservedPath, JSON.stringify({
      id: sessionId,
      title: '真实会话',
      cwd: '/work/mismatch',
      rollout_path: sessionPath,
      updated_at_ms: 1777372805000
    }) + '\n', 'utf8')

    assert.equal(codex.listCliSessions({ includeDefaultHome: false }).totals.sessions, 1)
    const moved = codex.moveCliSessionsToTrash({
      sessionId,
      sourcePath: reservedPath,
      includeDefaultHome: false
    })
    assert.equal(moved.success, false)
    assert.equal(moved.moved, 0)
    assert.equal(fs.existsSync(sessionPath), true)
    assert.equal(codex.listCliSessionTrash().total, 0)
    assert.equal(codex.listCliSessions({ includeDefaultHome: false }).totals.sessions, 1)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应标记缺少 SQLite 索引的归档文件为未索引', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-archived-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-archived-account',
      email: 'archived@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'archived@example.com' }),
        refresh_token: 'rt-archived'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const sessionPath = path.join(prepared.env.CODEX_HOME, 'archived_sessions', '2026', '04', '28', 'rollout-archived.jsonl')
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, JSON.stringify({ type: 'metadata', cwd: '/work/archived', title: '归档会话' }) + '\n', 'utf8')

    const result = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(result.success, true)
    assert.equal(result.totals.sessions, 1)
    assert.equal(result.groups[0].workspaceName, 'archived')
    assert.equal(result.groups[0].sessions[0].status, 'unindexed')
    assert.equal(result.groups[0].sessions[0].statusLabel, '未索引')
    assert.equal(result.groups[0].sessions[0].archived, true)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应发现未写入账号字段的实例目录', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-discover-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-discovered-account',
      email: 'discovered@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'discovered@example.com' }),
        refresh_token: 'rt-discovered'
      }
    })

    const digest = require('node:crypto').createHash('sha256').update(account.id).digest('hex').slice(0, 16)
    const instanceDir = path.join(root, 'instances', 'codex-cli', 'accounts', digest)
    const sessionPath = path.join(instanceDir, 'sessions', '2026', '04', '28', 'rollout-discovered.jsonl')
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, JSON.stringify({ type: 'metadata', cwd: '/work/discovered', title: '已发现实例' }) + '\n', 'utf8')
    fs.writeFileSync(path.join(instanceDir, 'session_index.jsonl'), JSON.stringify({
      id: 'discovered-session',
      title: '已发现 Codex 会话',
      cwd: '/work/discovered',
      rollout_path: sessionPath,
      updated_at_ms: 1777372801000
    }) + '\n', 'utf8')

    const saved = storage.getAccount('codex', account.id)
    assert.equal(saved.codex_cli_instance_dir, undefined)

    const result = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(result.success, true)
    assert.equal(result.totals.boundAccounts, 1)
    assert.equal(result.totals.sessions, 1)
    assert.equal(result.accounts[0].instanceDir, instanceDir)
    assert.equal(result.groups[0].workspaceName, 'discovered')
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应优先读取 state_5.sqlite threads 索引', async (t) => {
  try {
    cp.execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    t.skip('sqlite3 命令不可用')
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-sqlite-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-sqlite-account',
      email: 'sqlite@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'sqlite@example.com' }),
        refresh_token: 'rt-sqlite'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const sessionPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', 'rollout-sqlite.jsonl')
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, JSON.stringify({ type: 'metadata', cwd: '/work/from-file', title: '文件会话' }) + '\n', 'utf8')
    const dbPath = path.join(prepared.env.CODEX_HOME, 'state_5.sqlite')
    cp.execFileSync('sqlite3', [dbPath, [
      'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, updated_at_ms INTEGER, created_at_ms INTEGER, archived INTEGER);',
      `INSERT INTO threads (id, rollout_path, cwd, title, updated_at_ms, created_at_ms, archived) VALUES ('sqlite-session', '${sessionPath.replace(/'/g, "''")}', '/work/from-sqlite', 'SQLite 会话', 1777372802000, 1777372800000, 1);`
    ].join(' ')], { stdio: ['ignore', 'ignore', 'pipe'] })

    const result = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(result.success, true)
    assert.equal(result.totals.sessions, 1)
    assert.equal(result.groups[0].workspaceName, 'from-sqlite')
    assert.equal(result.groups[0].sessions[0].title, 'SQLite 会话')
    assert.equal(result.groups[0].sessions[0].status, 'archived')
    assert.equal(result.groups[0].sessions[0].statusLabel, '已归档')
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应清理异常索引但保留真实会话文件', async (t) => {
  try {
    cp.execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    t.skip('sqlite3 命令不可用')
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-clean-indexes-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-clean-index-account',
      email: 'clean-index@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'clean-index@example.com' }),
        refresh_token: 'rt-clean-index'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const validId = 'valid-clean-session'
    const missingId = 'missing-clean-session'
    const validPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', 'rollout-valid-clean.jsonl')
    const missingPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', 'rollout-missing-clean.jsonl')
    fs.mkdirSync(path.dirname(validPath), { recursive: true })
    fs.writeFileSync(validPath, JSON.stringify({ type: 'metadata', cwd: '/work/clean', title: '正常会话' }) + '\n', 'utf8')

    const dbPath = path.join(prepared.env.CODEX_HOME, 'state_5.sqlite')
    cp.execFileSync('sqlite3', [dbPath, [
      'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, updated_at_ms INTEGER, created_at_ms INTEGER);',
      `INSERT INTO threads (id, rollout_path, cwd, title, updated_at_ms, created_at_ms) VALUES ('${validId}', '${validPath.replace(/'/g, "''")}', '/work/clean', '正常会话', 1777372802000, 1777372800000);`,
      `INSERT INTO threads (id, rollout_path, cwd, title, updated_at_ms, created_at_ms) VALUES ('${missingId}', '${missingPath.replace(/'/g, "''")}', '/work/clean', '缺失会话', 1777372803000, 1777372800000);`
    ].join(' ')], { stdio: ['ignore', 'ignore', 'pipe'] })

    fs.writeFileSync(path.join(prepared.env.CODEX_HOME, 'session_index.jsonl'), [
      JSON.stringify({ id: validId, title: '正常会话', cwd: '/work/clean', rollout_path: validPath, updated_at_ms: 1777372802000 }),
      JSON.stringify({ id: missingId, title: '缺失会话', cwd: '/work/clean', rollout_path: missingPath, updated_at_ms: 1777372803000 })
    ].join('\n') + '\n', 'utf8')

    const before = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(before.success, true)
    assert.equal(before.totals.sessions, 2)
    assert.equal(before.groups[0].sessions.some(session => session.status === 'broken'), true)

    const cleaned = codex.cleanCliSessionIndexes({ includeDefaultHome: false })
    assert.equal(cleaned.success, true)
    assert.equal(cleaned.sqliteRemoved, 1)
    assert.equal(cleaned.indexRemoved, 1)
    assert.equal(cleaned.removed, 2)
    assert.equal(fs.existsSync(validPath), true)

    const remainingRows = Number(cp.execFileSync('sqlite3', [dbPath, 'SELECT COUNT(*) FROM threads;'], { encoding: 'utf8' }).trim())
    const missingRows = Number(cp.execFileSync('sqlite3', [dbPath, `SELECT COUNT(*) FROM threads WHERE id='${missingId}';`], { encoding: 'utf8' }).trim())
    assert.equal(remainingRows, 1)
    assert.equal(missingRows, 0)

    const indexContent = fs.readFileSync(path.join(prepared.env.CODEX_HOME, 'session_index.jsonl'), 'utf8')
    assert.match(indexContent, new RegExp(validId))
    assert.doesNotMatch(indexContent, new RegExp(missingId))

    const after = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(after.success, true)
    assert.equal(after.totals.sessions, 1)
    assert.equal(after.groups[0].sessions[0].status, 'available')
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应支持取消归档', async (t) => {
  try {
    cp.execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    t.skip('sqlite3 命令不可用')
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-unarchive-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-unarchive-account',
      email: 'unarchive@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'unarchive@example.com' }),
        refresh_token: 'rt-unarchive'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const sessionId = '019dd1d3-bb36-7a83-9033-6cc188563613'
    const archivedPath = path.join(prepared.env.CODEX_HOME, 'archived_sessions', `rollout-2026-04-28T10-49-49-${sessionId}.jsonl`)
    const restoredPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', `rollout-${sessionId}.jsonl`)
    const canonicalRestoredPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', `rollout-2026-04-28T10-49-49-${sessionId}.jsonl`)
    fs.mkdirSync(path.dirname(archivedPath), { recursive: true })
    fs.writeFileSync(archivedPath, JSON.stringify({ type: 'metadata', cwd: '/work/unarchive', title: '已归档会话' }) + '\n', 'utf8')
    fs.writeFileSync(path.join(prepared.env.CODEX_HOME, 'session_index.jsonl'), JSON.stringify({
      id: sessionId,
      title: '已归档会话',
      cwd: '/work/unarchive',
      rollout_path: archivedPath,
      archived: true,
      archived_at: 1777372804,
      updated_at_ms: 1777372804000
    }) + '\n', 'utf8')

    const dbPath = path.join(prepared.env.CODEX_HOME, 'state_5.sqlite')
    cp.execFileSync('sqlite3', [dbPath, [
      'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER, archived_at INTEGER, updated_at_ms INTEGER, created_at_ms INTEGER);',
      `INSERT INTO threads (id, rollout_path, cwd, title, archived, archived_at, updated_at_ms, created_at_ms) VALUES ('${sessionId}', '${archivedPath.replace(/'/g, "''")}', '/work/unarchive', '已归档会话', 1, 1777372804, 1777372804000, 1777372800000);`
    ].join(' ')], { stdio: ['ignore', 'ignore', 'pipe'] })

    const before = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(before.groups[0].sessions[0].status, 'archived')

    const unarchived = codex.unarchiveCliSession({ sessionId, sourcePath: archivedPath, includeDefaultHome: false })
    assert.equal(unarchived.success, true)
    assert.equal(unarchived.moved, true)
    assert.equal(fs.existsSync(archivedPath), false)
    assert.equal(fs.existsSync(restoredPath), false)
    assert.equal(fs.existsSync(canonicalRestoredPath), true)
    assert.equal(Number(cp.execFileSync('sqlite3', [dbPath, `SELECT archived FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim()), 0)
    assert.equal(cp.execFileSync('sqlite3', [dbPath, `SELECT archived_at IS NULL FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim(), '1')
    assert.equal(cp.execFileSync('sqlite3', [dbPath, `SELECT rollout_path FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim(), canonicalRestoredPath)
    assert.match(fs.readFileSync(path.join(prepared.env.CODEX_HOME, 'session_index.jsonl'), 'utf8'), new RegExp(canonicalRestoredPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const after = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(after.groups[0].sessions[0].status, 'available')
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应支持可用会话归档', async (t) => {
  try {
    cp.execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    t.skip('sqlite3 命令不可用')
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-archive-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-archive-account',
      email: 'archive@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'archive@example.com' }),
        refresh_token: 'rt-archive'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const sessionId = '019dd1d3-bb36-7a83-9033-6cc188563614'
    const sessionPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', `rollout-2026-04-28T11-12-13-${sessionId}.jsonl`)
    const archivedPath = path.join(prepared.env.CODEX_HOME, 'archived_sessions', path.basename(sessionPath))
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, JSON.stringify({ type: 'metadata', cwd: '/work/archive', title: '可归档会话' }) + '\n', 'utf8')
    fs.writeFileSync(path.join(prepared.env.CODEX_HOME, 'session_index.jsonl'), JSON.stringify({
      id: sessionId,
      title: '可归档会话',
      cwd: '/work/archive',
      rollout_path: sessionPath,
      archived: false,
      updated_at_ms: 1777372806000
    }) + '\n', 'utf8')

    const dbPath = path.join(prepared.env.CODEX_HOME, 'state_5.sqlite')
    cp.execFileSync('sqlite3', [dbPath, [
      'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER, archived_at INTEGER, archived_at_ms INTEGER, updated_at_ms INTEGER, created_at_ms INTEGER);',
      `INSERT INTO threads (id, rollout_path, cwd, title, archived, archived_at, archived_at_ms, updated_at_ms, created_at_ms) VALUES ('${sessionId}', '${sessionPath.replace(/'/g, "''")}', '/work/archive', '可归档会话', 0, NULL, NULL, 1777372806000, 1777372800000);`
    ].join(' ')], { stdio: ['ignore', 'ignore', 'pipe'] })

    const before = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(before.groups[0].sessions[0].status, 'available')

    const archived = codex.archiveCliSession({ sessionId, sourcePath: sessionPath, includeDefaultHome: false })
    assert.equal(archived.success, true)
    assert.equal(archived.moved, true)
    assert.equal(fs.existsSync(sessionPath), false)
    assert.equal(fs.existsSync(archivedPath), true)
    assert.equal(Number(cp.execFileSync('sqlite3', [dbPath, `SELECT archived FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim()), 1)
    assert.equal(cp.execFileSync('sqlite3', [dbPath, `SELECT archived_at IS NOT NULL FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim(), '1')
    assert.equal(cp.execFileSync('sqlite3', [dbPath, `SELECT rollout_path FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim(), archivedPath)
    assert.match(fs.readFileSync(path.join(prepared.env.CODEX_HOME, 'session_index.jsonl'), 'utf8'), new RegExp(archivedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const after = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(after.groups[0].sessions[0].status, 'archived')
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应按可用状态和更新时间排序', async (t) => {
  try {
    cp.execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    t.skip('sqlite3 命令不可用')
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-sort-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-sort-account',
      email: 'sort@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'sort@example.com' }),
        refresh_token: 'rt-sort'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const entries = [
      { id: 'sort-available-old', title: '可用旧会话', dir: 'sessions', archived: 0, updated: 1777372801000 },
      { id: 'sort-archived-new', title: '已归档新会话', dir: 'archived_sessions', archived: 1, updated: 1777372809000 },
      { id: 'sort-available-new', title: '可用新会话', dir: 'sessions', archived: 0, updated: 1777372805000 }
    ]
    for (const entry of entries) {
      const sessionPath = entry.dir === 'sessions'
        ? path.join(prepared.env.CODEX_HOME, entry.dir, '2026', '04', '28', `rollout-${entry.id}.jsonl`)
        : path.join(prepared.env.CODEX_HOME, entry.dir, `rollout-${entry.id}.jsonl`)
      entry.path = sessionPath
      fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
      fs.writeFileSync(sessionPath, JSON.stringify({ type: 'metadata', cwd: '/work/sort', title: entry.title }) + '\n', 'utf8')
    }

    fs.writeFileSync(path.join(prepared.env.CODEX_HOME, 'session_index.jsonl'), entries.map(entry => JSON.stringify({
      id: entry.id,
      title: entry.title,
      cwd: '/work/sort',
      rollout_path: entry.path,
      archived: Boolean(entry.archived),
      updated_at_ms: entry.updated
    })).join('\n') + '\n', 'utf8')

    const dbPath = path.join(prepared.env.CODEX_HOME, 'state_5.sqlite')
    cp.execFileSync('sqlite3', [dbPath, [
      'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER, updated_at_ms INTEGER, created_at_ms INTEGER);',
      ...entries.map(entry => `INSERT INTO threads (id, rollout_path, cwd, title, archived, updated_at_ms, created_at_ms) VALUES ('${entry.id}', '${entry.path.replace(/'/g, "''")}', '/work/sort', '${entry.title}', ${entry.archived}, ${entry.updated}, 1777372800000);`)
    ].join(' ')], { stdio: ['ignore', 'ignore', 'pipe'] })

    const result = codex.listCliSessions({ includeDefaultHome: false })
    const ids = result.groups[0].sessions.map(session => session.sessionId)
    assert.deepEqual(ids, ['sort-available-new', 'sort-available-old', 'sort-archived-new'])
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应解析 JSONL 标题、摘要和消息详情', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-message-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-message-account',
      email: 'message@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'message@example.com' }),
        refresh_token: 'rt-message'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const sessionPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', 'rollout-019dd1d3-bb36-7a83-9033-6cc188563611.jsonl')
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, [
      JSON.stringify({ timestamp: '2026-04-28T10:59:56.000Z', type: 'session_meta', payload: { id: '019dd1d3-bb36-7a83-9033-6cc188563611', cwd: '/work/Aideck' } }),
      JSON.stringify({ timestamp: '2026-04-28T11:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '现在还会获取远程的消息吗？' }] } }),
      JSON.stringify({ timestamp: '2026-04-28T11:00:05.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '会，还会获取远程消息。' }] } })
    ].join('\n') + '\n', 'utf8')

    const result = codex.listCliSessions({ includeDefaultHome: false })
    const session = result.groups[0].sessions[0]
    assert.equal(session.title, '现在还会获取远程的消息吗？')
    assert.equal(session.summary, '会，还会获取远程消息。')
    assert.equal(session.status, 'unindexed')
    assert.equal(session.resumeCommand, 'codex resume 019dd1d3-bb36-7a83-9033-6cc188563611')

    const messages = codex.loadCliSessionMessages({ sourcePath: sessionPath })
    assert.equal(messages.success, true)
    assert.equal(messages.messages.length, 2)
    assert.equal(messages.messages[0].role, 'user')
    assert.equal(messages.messages[1].content, '会，还会获取远程消息。')

    const imageSessionPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', 'rollout-019dd1d3-bb36-7a83-9033-6cc188563619.jsonl')
    fs.writeFileSync(imageSessionPath, [
      JSON.stringify({
        timestamp: '2026-04-28T11:02:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: '这种对话中含图片的能展示吗？' },
            { type: 'input_text', text: '<image>' },
            { type: 'input_text', text: '</image>' },
            { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=' }
          ]
        }
      })
    ].join('\n') + '\n', 'utf8')
    const imageMessages = codex.loadCliSessionMessages({ sourcePath: imageSessionPath })
    assert.equal(imageMessages.success, true)
    assert.equal(imageMessages.messages.length, 1)
    assert.equal(imageMessages.messages[0].content.includes('<image>'), false)
    assert.equal(imageMessages.messages[0].content.includes('</image>'), false)
    assert.equal(imageMessages.messages[0].content, '这种对话中含图片的能展示吗？')
    assert.deepEqual(imageMessages.messages[0].images, ['data:image/png;base64,iVBORw0KGgo='])
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应支持移动到回收站并恢复索引', async (t) => {
  try {
    cp.execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    t.skip('sqlite3 命令不可用')
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-trash-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-trash-account',
      email: 'trash@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'trash@example.com' }),
        refresh_token: 'rt-trash'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const sessionId = '019dd1d3-bb36-7a83-9033-6cc188563612'
    const sessionPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', `rollout-${sessionId}.jsonl`)
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, [
      JSON.stringify({ timestamp: '2026-04-28T10:59:56.000Z', type: 'session_meta', payload: { id: sessionId, cwd: '/work/trash' } }),
      JSON.stringify({ timestamp: '2026-04-28T11:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '移动到回收站测试' }] } })
    ].join('\n') + '\n', 'utf8')
    fs.writeFileSync(path.join(prepared.env.CODEX_HOME, 'session_index.jsonl'), JSON.stringify({
      id: sessionId,
      title: '回收站会话',
      cwd: '/work/trash',
      rollout_path: sessionPath,
      updated_at_ms: 1777372803000
    }) + '\n', 'utf8')

    const dbPath = path.join(prepared.env.CODEX_HOME, 'state_5.sqlite')
    cp.execFileSync('sqlite3', [dbPath, [
      'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, updated_at_ms INTEGER, created_at_ms INTEGER);',
      `INSERT INTO threads (id, rollout_path, cwd, title, updated_at_ms, created_at_ms) VALUES ('${sessionId}', '${sessionPath.replace(/'/g, "''")}', '/work/trash', '回收站会话', 1777372803000, 1777372800000);`
    ].join(' ')], { stdio: ['ignore', 'ignore', 'pipe'] })

    assert.equal(codex.listCliSessions({ includeDefaultHome: false }).totals.sessions, 1)
    const moved = codex.moveCliSessionsToTrash({ sessionId, sourcePath: sessionPath, includeDefaultHome: false })
    assert.equal(moved.success, true)
    assert.equal(moved.moved, 1)
    assert.equal(fs.existsSync(sessionPath), false)
    assert.equal(codex.listCliSessions({ includeDefaultHome: false }).totals.sessions, 0)
    assert.equal(Number(cp.execFileSync('sqlite3', [dbPath, `SELECT COUNT(*) FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim()), 0)

    const trash = codex.listCliSessionTrash()
    assert.equal(trash.success, true)
    assert.equal(trash.total, 1)
    assert.equal(trash.items[0].sessionId, sessionId)

    const restored = codex.restoreCliSessionFromTrash({ trashId: trash.items[0].trashId })
    assert.equal(restored.success, true)
    assert.equal(fs.existsSync(sessionPath), true)
    assert.equal(codex.listCliSessionTrash().total, 0)
    assert.equal(codex.listCliSessions({ includeDefaultHome: false }).totals.sessions, 1)
    assert.equal(Number(cp.execFileSync('sqlite3', [dbPath, `SELECT COUNT(*) FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim()), 1)
    const indexContent = fs.readFileSync(path.join(prepared.env.CODEX_HOME, 'session_index.jsonl'), 'utf8')
    assert.match(indexContent, new RegExp(sessionId))

    const movedAgain = codex.moveCliSessionsToTrash({ items: [{ sessionId, sourcePath: sessionPath }], includeDefaultHome: false })
    assert.equal(movedAgain.success, true)
    const trashAgain = codex.listCliSessionTrash()
    assert.equal(trashAgain.total, 1)
    const restoredBatch = codex.restoreCliSessionsFromTrash({ trashIds: [trashAgain.items[0].trashId] })
    assert.equal(restoredBatch.success, true)
    assert.equal(restoredBatch.restored, 1)
    assert.equal(fs.existsSync(sessionPath), true)

    const movedForDelete = codex.moveCliSessionsToTrash({ sessionId, sourcePath: sessionPath, includeDefaultHome: false })
    assert.equal(movedForDelete.success, true)
    assert.equal(codex.listCliSessionTrash().total, 1)
    const deleted = codex.deleteCliSessionTrash({ all: true })
    assert.equal(deleted.success, true)
    assert.equal(deleted.deleted, 1)
    assert.equal(codex.listCliSessionTrash().total, 0)
    assert.equal(fs.existsSync(sessionPath), false)
    assert.equal(codex.listCliSessions({ includeDefaultHome: false }).totals.sessions, 0)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应支持复制会话到其他实例并生成独立副本', async (t) => {
  try {
    cp.execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    t.skip('sqlite3 命令不可用')
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-copy-session-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const sourceAccount = storage.addAccount('codex', {
      id: 'codex-copy-source',
      email: 'copy-source@example.com',
      account_id: 'acc-copy-source',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-copy-source' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'copy-source@example.com' }),
        refresh_token: 'rt-copy-source'
      }
    })
    const targetAccount = storage.addAccount('codex', {
      id: 'codex-copy-target',
      email: 'copy-target@example.com',
      account_id: 'acc-copy-target',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-copy-target' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'copy-target@example.com' }),
        refresh_token: 'rt-copy-target'
      }
    })
    const sourcePrepared = await codex.prepareCliLaunch(sourceAccount.id)
    const targetPrepared = await codex.prepareCliLaunch(targetAccount.id)
    assert.equal(sourcePrepared.success, true)
    assert.equal(targetPrepared.success, true)

    const sessionId = '019dd1d3-bb36-7a83-9033-6cc188563620'
    const sessionPath = path.join(sourcePrepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', `rollout-${sessionId}.jsonl`)
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, [
      JSON.stringify({ timestamp: '2026-04-28T12:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: '/work/copy' } }),
      JSON.stringify({ timestamp: '2026-04-28T12:01:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '复制到实例测试' }] } })
    ].join('\n') + '\n', 'utf8')
    fs.writeFileSync(path.join(sourcePrepared.env.CODEX_HOME, 'session_index.jsonl'), JSON.stringify({
      id: sessionId,
      title: '复制源会话',
      cwd: '/work/copy',
      rollout_path: sessionPath,
      updated_at_ms: 1777372860000,
      created_at_ms: 1777372800000
    }) + '\n', 'utf8')

    const sourceDbPath = path.join(sourcePrepared.env.CODEX_HOME, 'state_5.sqlite')
    cp.execFileSync('sqlite3', [sourceDbPath, [
      'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER, updated_at_ms INTEGER, created_at_ms INTEGER);',
      `INSERT INTO threads (id, rollout_path, cwd, title, archived, updated_at_ms, created_at_ms) VALUES ('${sessionId}', '${sessionPath.replace(/'/g, "''")}', '/work/copy', '复制源会话', 0, 1777372860000, 1777372800000);`
    ].join(' ')], { stdio: ['ignore', 'ignore', 'pipe'] })
    const targetDbPath = path.join(targetPrepared.env.CODEX_HOME, 'state_5.sqlite')
    cp.execFileSync('sqlite3', [targetDbPath, 'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER, updated_at_ms INTEGER, created_at_ms INTEGER);'], { stdio: ['ignore', 'ignore', 'pipe'] })

    const copied = codex.copyCliSessionToInstance({
      sessionId,
      sourcePath: sessionPath,
      targetAccountId: targetAccount.id,
      includeDefaultHome: false
    })
    assert.equal(copied.success, true)
    assert.notEqual(copied.sessionId, sessionId)
    assert.equal(copied.originalSessionId, sessionId)
    assert.equal(fs.existsSync(sessionPath), true)
    assert.equal(fs.existsSync(copied.path), true)
    assert.equal(copied.targetInstanceDir, targetPrepared.env.CODEX_HOME)

    const targetFileContent = fs.readFileSync(copied.path, 'utf8')
    assert.match(targetFileContent, new RegExp(copied.sessionId))
    assert.doesNotMatch(targetFileContent, new RegExp(sessionId))

    assert.equal(Number(cp.execFileSync('sqlite3', [sourceDbPath, `SELECT COUNT(*) FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim()), 1)
    assert.equal(Number(cp.execFileSync('sqlite3', [targetDbPath, `SELECT COUNT(*) FROM threads WHERE id='${copied.sessionId}';`], { encoding: 'utf8' }).trim()), 1)
    assert.equal(cp.execFileSync('sqlite3', [targetDbPath, `SELECT rollout_path FROM threads WHERE id='${copied.sessionId}';`], { encoding: 'utf8' }).trim(), copied.path)
    assert.match(fs.readFileSync(path.join(targetPrepared.env.CODEX_HOME, 'session_index.jsonl'), 'utf8'), new RegExp(copied.sessionId))

    const listed = codex.listCliSessions({ includeDefaultHome: false })
    const allSessions = listed.groups.flatMap(group => group.sessions)
    assert.equal(allSessions.some(session => session.sessionId === sessionId && session.accountId === sourceAccount.id), true)
    assert.equal(allSessions.some(session => session.sessionId === copied.sessionId && session.accountId === targetAccount.id), true)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 会话管理应支持移动会话到其他实例', async (t) => {
  try {
    cp.execFileSync('sqlite3', ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {
    t.skip('sqlite3 命令不可用')
    return
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-move-session-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const sourceAccount = storage.addAccount('codex', {
      email: 'move-source@example.com',
      account_id: 'acc-move-source',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-move-source' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'move-source@example.com' }),
        refresh_token: 'rt-move-source'
      }
    })
    const targetAccount = storage.addAccount('codex', {
      email: 'move-target@example.com',
      account_id: 'acc-move-target',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-move-target' } }),
        id_token: fakeJwt({ exp: expiresAt, email: 'move-target@example.com' }),
        refresh_token: 'rt-move-target'
      }
    })
    const sourcePrepared = await codex.prepareCliLaunch(sourceAccount.id)
    const targetPrepared = await codex.prepareCliLaunch(targetAccount.id)
    assert.equal(sourcePrepared.success, true)
    assert.equal(targetPrepared.success, true)

    const sessionId = '019dd1d3-bb36-7a83-9033-6cc188563621'
    const sessionPath = path.join(sourcePrepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', `rollout-${sessionId}.jsonl`)
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, [
      JSON.stringify({ timestamp: '2026-04-28T12:10:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: '/work/move' } }),
      JSON.stringify({ timestamp: '2026-04-28T12:11:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '移动到实例测试' }] } })
    ].join('\n') + '\n', 'utf8')
    fs.writeFileSync(path.join(sourcePrepared.env.CODEX_HOME, 'session_index.jsonl'), JSON.stringify({
      id: sessionId,
      title: '移动源会话',
      cwd: '/work/move',
      rollout_path: sessionPath,
      updated_at_ms: 1777373460000,
      created_at_ms: 1777373400000
    }) + '\n', 'utf8')

    const sourceDbPath = path.join(sourcePrepared.env.CODEX_HOME, 'state_5.sqlite')
    const targetDbPath = path.join(targetPrepared.env.CODEX_HOME, 'state_5.sqlite')
    const createThreadsSql = 'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER, updated_at_ms INTEGER, created_at_ms INTEGER);'
    cp.execFileSync('sqlite3', [sourceDbPath, [
      createThreadsSql,
      `INSERT INTO threads (id, rollout_path, cwd, title, archived, updated_at_ms, created_at_ms) VALUES ('${sessionId}', '${sessionPath.replace(/'/g, "''")}', '/work/move', '移动源会话', 0, 1777373460000, 1777373400000);`
    ].join(' ')], { stdio: ['ignore', 'ignore', 'pipe'] })
    cp.execFileSync('sqlite3', [targetDbPath, createThreadsSql], { stdio: ['ignore', 'ignore', 'pipe'] })

    const moved = codex.moveCliSessionToInstance({
      sessionId,
      sourcePath: sessionPath,
      targetAccountId: targetAccount.id,
      includeDefaultHome: false
    })
    assert.equal(moved.success, true)
    assert.equal(moved.moved, true)
    assert.notEqual(moved.sessionId, sessionId)
    assert.equal(fs.existsSync(sessionPath), false)
    assert.equal(fs.existsSync(moved.path), true)
    assert.equal(Number(cp.execFileSync('sqlite3', [sourceDbPath, `SELECT COUNT(*) FROM threads WHERE id='${sessionId}';`], { encoding: 'utf8' }).trim()), 0)
    assert.equal(Number(cp.execFileSync('sqlite3', [targetDbPath, `SELECT COUNT(*) FROM threads WHERE id='${moved.sessionId}';`], { encoding: 'utf8' }).trim()), 1)
    assert.doesNotMatch(fs.readFileSync(path.join(sourcePrepared.env.CODEX_HOME, 'session_index.jsonl'), 'utf8'), new RegExp(sessionId))
    assert.match(fs.readFileSync(path.join(targetPrepared.env.CODEX_HOME, 'session_index.jsonl'), 'utf8'), new RegExp(moved.sessionId))
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex CLI 回收站永久删除应只清理未引用的 projectless 空工作区', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-trash-workspace-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()

    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const account = storage.addAccount('codex', {
      id: 'codex-trash-workspace-account',
      email: 'trash-workspace@example.com',
      tokens: {
        access_token: fakeJwt({ exp: expiresAt }),
        id_token: fakeJwt({ exp: expiresAt, email: 'trash-workspace@example.com' }),
        refresh_token: 'rt-trash-workspace'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)

    const createSession = (sessionId, workspacePath) => {
      const sessionPath = path.join(prepared.env.CODEX_HOME, 'sessions', '2026', '04', '28', `rollout-${sessionId}.jsonl`)
      fs.mkdirSync(workspacePath, { recursive: true })
      fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
      fs.writeFileSync(sessionPath, [
        JSON.stringify({ timestamp: '2026-04-28T10:59:56.000Z', type: 'session_meta', payload: { id: sessionId, cwd: workspacePath } }),
        JSON.stringify({ timestamp: '2026-04-28T11:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '临时目录清理测试' }] } })
      ].join('\n') + '\n', 'utf8')
      return sessionPath
    }
    const moveAndDelete = (sessionId, sessionPath) => {
      const moved = codex.moveCliSessionsToTrash({ sessionId, sourcePath: sessionPath, includeDefaultHome: false })
      assert.equal(moved.success, true)
      assert.equal(moved.moved, 1)
      const trash = codex.listCliSessionTrash()
      assert.equal(trash.total, 1)
      const deleted = codex.deleteCliSessionTrash({ trashId: trash.items[0].trashId, includeDefaultHome: false })
      assert.equal(deleted.success, true)
      assert.equal(deleted.deleted, 1)
      return deleted.results[0]
    }

    const emptySessionId = '019dd367-e263-79f0-82fa-993216572d87'
    const emptyWorkspacePath = path.join(root, 'Documents', 'Codex', '2026-04-28', 'empty-projectless-chat')
    const emptySessionPath = createSession(emptySessionId, emptyWorkspacePath)

    assert.equal(codex.listCliSessions({ includeDefaultHome: false }).totals.sessions, 1)
    const emptyResult = moveAndDelete(emptySessionId, emptySessionPath)
    assert.equal(emptyResult.workspaceDirRemoved, true)
    assert.equal(fs.existsSync(emptyWorkspacePath), false)

    const nonEmptySessionId = '019dd367-e263-79f0-82fa-993216572d88'
    const nonEmptyWorkspacePath = path.join(root, 'Documents', 'Codex', '2026-04-28', 'non-empty-projectless-chat')
    const nonEmptySessionPath = createSession(nonEmptySessionId, nonEmptyWorkspacePath)
    fs.writeFileSync(path.join(nonEmptyWorkspacePath, 'note.txt'), 'keep me\n', 'utf8')

    const nonEmptyResult = moveAndDelete(nonEmptySessionId, nonEmptySessionPath)
    assert.equal(nonEmptyResult.workspaceDirRemoved, false)
    assert.equal(nonEmptyResult.workspaceDirSkippedReason, 'not_empty')
    assert.equal(fs.existsSync(nonEmptyWorkspacePath), true)

    const sharedWorkspacePath = path.join(root, 'Documents', 'Codex', '2026-04-28', 'shared-projectless-chat')
    const deletedSessionId = '019dd367-e263-79f0-82fa-993216572d89'
    const liveSessionId = '019dd367-e263-79f0-82fa-993216572d90'
    const deletedSessionPath = createSession(deletedSessionId, sharedWorkspacePath)
    createSession(liveSessionId, sharedWorkspacePath)

    const liveReferenceResult = moveAndDelete(deletedSessionId, deletedSessionPath)
    assert.equal(liveReferenceResult.workspaceDirRemoved, false)
    assert.equal(liveReferenceResult.workspaceDirSkippedReason, 'live_session_reference')
    assert.equal(fs.existsSync(sharedWorkspacePath), true)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})
