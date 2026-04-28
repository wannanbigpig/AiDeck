const test = require('node:test')
const assert = require('node:assert/strict')
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

test('Codex CLI 绑定实例应复用 CODEX_HOME、共享会话且不切换当前账号', async () => {
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
    assert.equal(fs.lstatSync(sessionPath).isSymbolicLink(), true)
    assert.equal(fs.lstatSync(archivedPath).isSymbolicLink(), true)
    assert.equal(fs.lstatSync(sessionIndexPath).isSymbolicLink(), true)

    const third = await codex.prepareCliLaunch(another.id)
    assert.equal(third.success, true)
    assert.notEqual(third.env.CODEX_HOME, first.env.CODEX_HOME)
    assert.equal(fs.realpathSync(path.join(third.env.CODEX_HOME, 'sessions')), fs.realpathSync(sessionPath))
    assert.equal(fs.realpathSync(path.join(third.env.CODEX_HOME, 'session_index.jsonl')), fs.realpathSync(sessionIndexPath))

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
