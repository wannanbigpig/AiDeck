const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-home-'))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome

const fileUtilsPath = path.join(__dirname, '..', 'public', 'preload', 'lib', 'fileUtils.js')
const storagePath = path.join(__dirname, '..', 'public', 'preload', 'lib', 'accountStorage.js')

delete require.cache[require.resolve(fileUtilsPath)]
delete require.cache[require.resolve(storagePath)]

const storage = require(storagePath)

function resetStorageDir () {
  const root = path.join(tempHome, '.ai_deck')
  fs.rmSync(root, { recursive: true, force: true })
}

test.after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test('初始化后应创建 .ai_deck 目录结构', () => {
  resetStorageDir()
  const result = storage.initStorage()
  assert.equal(result.success, true)

  const root = path.join(tempHome, '.ai_deck')
  assert.equal(fs.existsSync(path.join(root, 'meta.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'codex', 'accounts-index.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'gemini', 'accounts-index.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'antigravity', 'accounts-index.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'sync')), true)
})

test('Antigravity 去重应支持邮箱唯一兜底并保留 1 条账号', () => {
  resetStorageDir()
  storage.initStorage()

  const a1 = storage.addAccount('antigravity', {
    email: 'same@example.com',
    token: { refresh_token: 'r1', access_token: 'a1', project_id: 'p1' }
  })
  const a2 = storage.addAccount('antigravity', {
    email: 'same@example.com',
    token: { refresh_token: 'r2', access_token: 'a2', project_id: 'p2' }
  })

  assert.ok(a1 && a1.id)
  assert.ok(a2 && a2.id)
  const accounts = storage.listAccounts('antigravity')
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0].email, 'same@example.com')
})

test('Antigravity ID 在 access_token 轮换时应稳定（refresh_token 不变）', () => {
  resetStorageDir()
  storage.initStorage()

  const first = storage.addAccount('antigravity', {
    email: 'stable@example.com',
    token: { refresh_token: 'stable-refresh', access_token: 'a-old', project_id: 'pid' }
  })
  const second = storage.addAccount('antigravity', {
    email: 'stable@example.com',
    token: { refresh_token: 'stable-refresh', access_token: 'a-new', project_id: 'pid' }
  })

  assert.ok(first && first.id)
  assert.ok(second && second.id)
  assert.equal(first.id, second.id)
})

test('Codex 去重应与 codex-tools 一致：同身份 upsert，不同 organization 分开', () => {
  resetStorageDir()
  storage.initStorage()

  const sameIdentityA = storage.addAccount('codex', {
    email: 'codex@example.com',
    account_id: 'acc-1',
    organization_id: 'org-1',
    tokens: { access_token: 'a1', refresh_token: 'r1' }
  })
  const sameIdentityB = storage.addAccount('codex', {
    email: 'codex@example.com',
    account_id: 'acc-1',
    organization_id: 'org-1',
    tags: ['updated'],
    tokens: { access_token: 'a2', refresh_token: 'r2' }
  })

  assert.ok(sameIdentityA && sameIdentityA.id)
  assert.ok(sameIdentityB && sameIdentityB.id)
  assert.equal(sameIdentityA.id, sameIdentityB.id)
  assert.equal(storage.listAccounts('codex').length, 1)

  storage.addAccount('codex', {
    email: 'codex@example.com',
    account_id: 'acc-1',
    organization_id: 'org-2',
    tokens: { access_token: 'a3', refresh_token: 'r3' }
  })
  assert.equal(storage.listAccounts('codex').length, 2)
})

test('OAuth pending 会话应支持保存/读取/清理', () => {
  resetStorageDir()
  storage.initStorage()

  const payload = {
    sessionId: 'sid-1',
    state: 'state-1',
    verifier: 'verifier-1',
    redirectUri: 'http://localhost:1455/auth/callback',
    authUrl: 'https://example.com/oauth',
    createdAt: Date.now()
  }

  assert.equal(storage.saveOAuthPending('codex', payload), true)
  const loaded = storage.getOAuthPending('codex', 'sid-1')
  assert.equal(loaded.sessionId, 'sid-1')
  assert.equal(storage.clearOAuthPending('codex', 'sid-1'), true)
  assert.equal(storage.getOAuthPending('codex', 'sid-1'), null)
})

test('同步加密应可回环解密、同文异密、篡改失败', () => {
  resetStorageDir()
  storage.initStorage()
  storage.addAccount('codex', {
    email: 'sync@example.com',
    tokens: { refresh_token: 'rt', access_token: 'at' }
  })

  const p1 = storage.buildEncryptedSyncPayload('pass-123')
  const p2 = storage.buildEncryptedSyncPayload('pass-123')
  assert.equal(p1.success, true)
  assert.equal(p2.success, true)
  assert.notEqual(p1.payload.ciphertext, p2.payload.ciphertext)

  const applyOk = storage.applyEncryptedSyncPayload(p1.payload, 'pass-123')
  assert.equal(applyOk.success, true)

  const tampered = JSON.parse(JSON.stringify(p1.payload))
  tampered.ciphertext = tampered.ciphertext.slice(0, -2) + 'AA'
  const applyBad = storage.applyEncryptedSyncPayload(tampered, 'pass-123')
  assert.equal(applyBad.success, false)
})
