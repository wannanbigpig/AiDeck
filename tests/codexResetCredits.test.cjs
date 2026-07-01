const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-reset-'))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome

const storagePath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'accountStorage.cjs')
const storageImplPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'accountStorage.impl.cjs')
const revisionBusPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'storageRevisionBus.cjs')
const fileUtilsPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'fileUtils.cjs')
const dataRootPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'dataRoot.cjs')
const codexServicePath = path.join(__dirname, '..', 'packages', 'platforms', 'src', 'codexService.cjs')
const codexServiceImplPath = path.join(__dirname, '..', 'packages', 'platforms', 'src', 'codexService.impl.cjs')
const codexHttpClientPath = path.join(__dirname, '..', 'packages', 'platforms', 'src', 'httpClient.cjs')

function buildFakeJwt (payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

function resetStorageDir () {
  fs.rmSync(path.join(tempHome, '.ai_deck'), { recursive: true, force: true })
}

function resetCodexModuleCache () {
  const modulePaths = [
    storagePath,
    storageImplPath,
    revisionBusPath,
    fileUtilsPath,
    dataRootPath,
    codexServicePath,
    codexServiceImplPath,
    codexHttpClientPath
  ]
  for (const modulePath of modulePaths) {
    delete require.cache[require.resolve(modulePath)]
  }
}

function loadCodexContext () {
  resetCodexModuleCache()
  const storage = require(storagePath)
  storage.initStorage()
  const codexService = require(codexServicePath)
  return { storage, codexService }
}

async function withMockCodexHttpClient (mockClient, callback) {
  const resolved = require.resolve(codexHttpClientPath)
  const original = require(resolved)
  require.cache[resolved].exports = mockClient
  try {
    return await callback()
  } finally {
    require.cache[resolved].exports = original
  }
}

test.after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test('getResetCredits 在过期 token 刷新后应持久化新 tokens', { concurrency: false }, async () => {
  resetStorageDir()
  const { storage, codexService } = loadCodexContext()
  const nowSec = Math.floor(Date.now() / 1000)
  const expiredAccessToken = buildFakeJwt({
    exp: nowSec - 3600,
    account_id: 'acc-old'
  })
  const currentIdToken = buildFakeJwt({
    exp: nowSec + 3600,
    account_id: 'acc-old'
  })
  const refreshedAccessToken = buildFakeJwt({
    exp: nowSec + 7200,
    account_id: 'acc-new'
  })
  const refreshedIdToken = buildFakeJwt({
    exp: nowSec + 7200,
    account_id: 'acc-new'
  })
  const account = storage.addAccount('codex', {
    email: 'reset@example.com',
    tokens: {
      access_token: expiredAccessToken,
      id_token: currentIdToken,
      refresh_token: 'refresh-old'
    }
  })

  const seenAuthHeaders = []
  await withMockCodexHttpClient({
    async request (url) {
      assert.equal(url, 'https://auth.openai.com/oauth/token')
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          access_token: refreshedAccessToken,
          id_token: refreshedIdToken,
          refresh_token: 'refresh-new'
        }),
        resHeaders: {}
      }
    },
    async getJSON (url, headers) {
      assert.equal(url, 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits')
      seenAuthHeaders.push(headers.Authorization)
      return {
        ok: true,
        status: 200,
        data: {
          available_count: 1,
          credits: [
            { id: 'credit-1', status: 'available', expires_at: nowSec + 3600 }
          ]
        },
        raw: '{}',
        resHeaders: {}
      }
    },
    async postJSON () {
      throw new Error('unexpected postJSON call')
    },
    async postForm () {
      throw new Error('unexpected postForm call')
    }
  }, async () => {
    const result = await codexService.getResetCredits(account.id)
    assert.equal(result.success, true)
  })

  const saved = storage.getAccount('codex', account.id)
  assert.equal(saved.tokens.access_token, refreshedAccessToken)
  assert.equal(saved.tokens.id_token, refreshedIdToken)
  assert.equal(saved.tokens.refresh_token, 'refresh-new')
  assert.deepEqual(seenAuthHeaders, [`Bearer ${refreshedAccessToken}`])
})

test('consumeResetCredit 在 401 重试后应持久化轮换后的 refresh_token', { concurrency: false }, async () => {
  resetStorageDir()
  const { storage, codexService } = loadCodexContext()
  const nowSec = Math.floor(Date.now() / 1000)
  const currentAccessToken = buildFakeJwt({
    exp: nowSec + 3600,
    account_id: 'acc-old'
  })
  const currentIdToken = buildFakeJwt({
    exp: nowSec + 3600,
    account_id: 'acc-old'
  })
  const refreshedAccessToken = buildFakeJwt({
    exp: nowSec + 7200,
    account_id: 'acc-new'
  })
  const refreshedIdToken = buildFakeJwt({
    exp: nowSec + 7200,
    account_id: 'acc-new'
  })
  const account = storage.addAccount('codex', {
    email: 'consume@example.com',
    tokens: {
      access_token: currentAccessToken,
      id_token: currentIdToken,
      refresh_token: 'refresh-old'
    }
  })

  const consumeAuthHeaders = []
  let consumeRequestCount = 0
  await withMockCodexHttpClient({
    async request (url, options) {
      if (url === 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume') {
        consumeRequestCount += 1
        consumeAuthHeaders.push(options.headers.Authorization)
        if (consumeRequestCount === 1) {
          return {
            ok: false,
            status: 401,
            body: JSON.stringify({ detail: { message: 'expired' } }),
            resHeaders: {}
          }
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ success: true }),
          resHeaders: {}
        }
      }

      assert.equal(url, 'https://auth.openai.com/oauth/token')
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          access_token: refreshedAccessToken,
          id_token: refreshedIdToken,
          refresh_token: 'refresh-new'
        }),
        resHeaders: {}
      }
    },
    async getJSON () {
      throw new Error('unexpected getJSON call')
    },
    async postJSON () {
      throw new Error('unexpected postJSON call')
    },
    async postForm () {
      throw new Error('unexpected postForm call')
    }
  }, async () => {
    const result = await codexService.consumeResetCredit(account.id)
    assert.equal(result.success, true)
  })

  const saved = storage.getAccount('codex', account.id)
  assert.equal(saved.tokens.access_token, refreshedAccessToken)
  assert.equal(saved.tokens.id_token, refreshedIdToken)
  assert.equal(saved.tokens.refresh_token, 'refresh-new')
  assert.deepEqual(consumeAuthHeaders, [
    `Bearer ${currentAccessToken}`,
    `Bearer ${refreshedAccessToken}`
  ])
})
