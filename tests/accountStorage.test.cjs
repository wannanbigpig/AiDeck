const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-home-'))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome

const storagePath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'accountStorage.cjs')
const revisionBusPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'storageRevisionBus.cjs')
const packageFileUtilsPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'fileUtils.cjs')

delete require.cache[require.resolve(storagePath)]
delete require.cache[require.resolve(revisionBusPath)]
delete require.cache[require.resolve(packageFileUtilsPath)]

const storage = require(storagePath)
const revisionBus = require(revisionBusPath)
const fileUtils = require(packageFileUtilsPath)

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
  assert.equal(fs.existsSync(path.join(root, 'meta', 'meta.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'meta', 'revision.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'accounts', 'codex', 'accounts-index.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'accounts', 'gemini', 'accounts-index.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'accounts', 'antigravity', 'accounts-index.json')), true)
  assert.equal(fs.existsSync(path.join(root, 'settings', 'hosts')), true)
  assert.equal(fs.existsSync(path.join(root, 'logs')), true)
  assert.equal(fs.existsSync(path.join(root, 'sync')), true)
  assert.equal(fs.existsSync(path.join(root, 'cache')), true)
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

test('同步快照应包含并恢复共享设置', () => {
  resetStorageDir()
  storage.initStorage()
  const sharedSettingsStore = require(path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'sharedSettingsStore.cjs'))

  sharedSettingsStore.writeValue('aideck_global_settings', {
    autoImportLocalAccounts: false,
    requestLogEnabled: true
  })

  const exported = storage.buildEncryptedSyncPayload('sync-pass')
  assert.equal(exported.success, true)

  sharedSettingsStore.writeValue('aideck_global_settings', {
    autoImportLocalAccounts: true,
    requestLogEnabled: false
  })

  const applied = storage.applyEncryptedSyncPayload(exported.payload, 'sync-pass')
  assert.equal(applied.success, true)

  const restored = sharedSettingsStore.readValue('aideck_global_settings', null)
  assert.equal(restored.autoImportLocalAccounts, false)
  assert.equal(restored.requestLogEnabled, true)
})

test('写入账号后 revision 应递增并可被订阅读到', async () => {
  resetStorageDir()
  storage.initStorage()
  const before = revisionBus.getRevision()

  const event = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('revision 订阅未收到事件'))
    }, 2000)

    const unsubscribe = revisionBus.subscribe((payload) => {
      clearTimeout(timeout)
      unsubscribe()
      resolve(payload)
    })

    storage.addAccount('codex', {
      email: 'revision@example.com',
      tokens: { access_token: 'at-1', refresh_token: 'rt-1' }
    })
  })

  const after = revisionBus.getRevision()
  assert.ok(after > before)
  assert.ok(event.revision >= after)
})

test('addAccounts 批量写入应只触发一次 revision', () => {
  resetStorageDir()
  storage.initStorage()
  const before = revisionBus.getRevision()

  const count = storage.addAccounts('codex', [
    {
      email: 'batch-a@example.com',
      account_id: 'acc-batch-a',
      organization_id: 'org-batch',
      tokens: { access_token: 'at-a', refresh_token: 'rt-a' }
    },
    {
      email: 'batch-b@example.com',
      account_id: 'acc-batch-b',
      organization_id: 'org-batch',
      tokens: { access_token: 'at-b', refresh_token: 'rt-b' }
    }
  ])

  const after = revisionBus.getRevision()
  assert.equal(count, 2)
  assert.equal(after, before + 1)
  assert.equal(storage.listAccounts('codex').length, 2)
})

test('revision 变化后应触发列表缓存失效并读取到外部写入的新账号', () => {
  resetStorageDir()
  storage.initStorage()

  const first = storage.addAccount('codex', {
    email: 'cache-a@example.com',
    account_id: 'acc-a',
    organization_id: 'org-a',
    tokens: { access_token: 'at-a', refresh_token: 'rt-a' }
  })
  assert.ok(first && first.id)
  assert.equal(storage.listAccounts('codex').length, 1)

  const root = storage.getDataRootDir()
  const accountFile = path.join(root, 'accounts', 'codex', 'accounts', 'codex_external.json')
  const indexFile = path.join(root, 'accounts', 'codex', 'accounts-index.json')
  const externalAccount = {
    id: 'codex_external',
    email: 'cache-b@example.com',
    account_id: 'acc-b',
    organization_id: 'org-b',
    tokens: { access_token: 'at-b', refresh_token: 'rt-b' },
    created_at: Date.now(),
    updated_at: Date.now(),
    last_used: 0
  }

  fileUtils.writeJsonFile(accountFile, externalAccount)
  fileUtils.writeJsonFile(indexFile, {
    schema_version: 1,
    updated_at: Date.now(),
    accounts: [
      {
        id: first.id,
        email: 'cache-a@example.com'
      },
      {
        id: externalAccount.id,
        email: externalAccount.email
      }
    ]
  })
  revisionBus.touchRevision('external-write', { platform: 'codex' })

  const accounts = storage.listAccounts('codex')
  assert.equal(accounts.length, 2)
  assert.equal(accounts.some((account) => account.email === externalAccount.email), true)
})
