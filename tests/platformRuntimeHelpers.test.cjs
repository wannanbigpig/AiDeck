const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadRuntimeHelper (name) {
  const filePath = path.join(process.cwd(), 'packages/app-shell/src/runtime', name)
  return import(pathToFileURL(filePath).href)
}

async function getFreePort () {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
  })
}

async function isPortAvailable (port) {
  return await new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

function buildFakeJwt (payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

async function waitFor (predicate, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 3000)
  const intervalMs = Number(options.intervalMs || 25)
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const result = await Promise.resolve(predicate())
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error(options.errorMessage || '等待条件满足超时')
}

async function withMockGeminiHttpClient (mockClient, callback) {
  const modulePath = path.join(process.cwd(), 'packages/platforms/src/httpClient.js')
  const resolved = require.resolve(modulePath)
  const original = require(resolved)
  require.cache[resolved].exports = mockClient
  try {
    return await callback()
  } finally {
    require.cache[resolved].exports = original
  }
}

test('shouldEnableStandaloneTokenAutoRefresh 应按自动刷新配额间隔决定是否保留独立 token 轮询', async () => {
  const { shouldEnableStandaloneTokenAutoRefresh } = await loadRuntimeHelper('usePlatformTokenAutoRefresh.js')

  assert.equal(shouldEnableStandaloneTokenAutoRefresh(0), true)
  assert.equal(shouldEnableStandaloneTokenAutoRefresh(10), false)
  assert.equal(shouldEnableStandaloneTokenAutoRefresh(11), true)
})

test('buildSharedAccountBackFields 应仅输出有值的共享字段', async () => {
  const { buildSharedAccountBackFields } = await loadRuntimeHelper('buildSharedAccountBackFields.js')

  const fields = buildSharedAccountBackFields({
    addMethod: 'OAuth 授权',
    loginMethod: '',
    tier: 'PRO',
    addedAt: '2026/04/13 12:00:00',
    statusText: '当前激活',
    statusColor: '#10b981'
  })

  assert.deepEqual(fields, [
    { key: 'add-method', label: '添加方式', text: 'OAuth 授权' },
    { key: 'tier', label: '套餐层级', text: 'PRO' },
    { key: 'added-at', label: '添加时间', text: '2026/04/13 12:00:00' },
    { key: 'status', label: '状态', text: '当前激活', color: '#10b981' }
  ])
})

test('normalizePlatformService 应为旧 service 补齐共享契约 fallback', async () => {
  const { normalizePlatformService } = await loadRuntimeHelper('normalizePlatformService.js')

  const codex = normalizePlatformService('codex', {
    refreshQuota (id) { return { success: true, id, from: 'refreshQuota' } },
    switchAccount (id) { return { success: true, id, stage: 'switch' } }
  })
  assert.deepEqual(codex.refreshQuotaOrUsage('cx-1'), { success: true, id: 'cx-1', from: 'refreshQuota' })
  assert.deepEqual(await codex.activateAccount('cx-1'), {
    success: true,
    error: null,
    warnings: [],
    stage: 'switch',
    changed: true
  })

  const gemini = normalizePlatformService('gemini', {
    refreshToken (id) { return { success: true, id, from: 'refreshToken' } },
    inject (id) { return { success: true, error: null, id } }
  })
  assert.deepEqual(gemini.refreshQuotaOrUsage('gm-1'), { success: true, id: 'gm-1', from: 'refreshToken' })
  assert.deepEqual(await gemini.activateAccount('gm-1'), {
    success: true,
    error: null,
    warnings: [],
    stage: 'inject',
    changed: true
  })
})

test('三平台服务应暴露统一共享契约入口', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const antigravity = require(path.join(process.cwd(), 'packages/platforms/src/antigravityService.impl.cjs'))
  const gemini = require(path.join(process.cwd(), 'packages/platforms/src/geminiService.impl.cjs'))

  for (const svc of [codex, antigravity, gemini]) {
    assert.equal(typeof svc.activateAccount, 'function')
    assert.equal(typeof svc.refreshQuotaOrUsage, 'function')
    assert.equal(typeof svc.refreshToken, 'function')
  }
})

test('Gemini 应按 expiry_date 判断是否需要提前刷新 token', () => {
  const gemini = require(path.join(process.cwd(), 'packages/platforms/src/geminiService.impl.cjs'))

  const now = Date.now()
  assert.equal(gemini.shouldRefreshAccessTokenByExpiry('access-token', now + 5 * 60 * 1000), true)
  assert.equal(gemini.shouldRefreshAccessTokenByExpiry('access-token', now + 20 * 60 * 1000), false)
  assert.equal(gemini.shouldRefreshAccessTokenByExpiry('', now + 20 * 60 * 1000), true)
  assert.equal(gemini.shouldRefreshAccessTokenByExpiry('access-token', 0), false)
})

test('Gemini prepareOAuthSession 应在浏览器回调后自动写入账号', async () => {
  const gemini = require(path.join(process.cwd(), 'packages/platforms/src/geminiService.impl.cjs'))
  const beforeIds = new Set((gemini.list() || []).map(item => item && item.id).filter(Boolean))
  const fakeIdToken = buildFakeJwt({ email: 'auto-oauth@gmail.com', sub: 'gemini-auto-sub' })

  await withMockGeminiHttpClient({
    async postForm () {
      return {
        ok: true,
        data: {
          access_token: 'gemini-auto-access',
          refresh_token: 'gemini-auto-refresh',
          id_token: fakeIdToken,
          token_type: 'Bearer',
          scope: 'openid email profile',
          expires_in: 3600
        }
      }
    },
    async getJSON () {
      return {
        ok: true,
        data: {
          email: 'auto-oauth@gmail.com',
          name: 'Auto OAuth',
          id: 'gemini-auto-sub'
        }
      }
    },
    async postJSON (_url, _headers, payload) {
      if (payload && payload.metadata) {
        return {
          ok: true,
          data: {
            paidTier: { id: 'pro', name: 'Gemini Pro' },
            cloudaicompanionProject: 'projects/test-project'
          }
        }
      }
      return {
        ok: true,
        data: {
          buckets: [
            {
              modelId: 'gemini-2.5-pro',
              tokenType: 'REQUESTS',
              remainingFraction: 0.98,
              remainingAmount: 98,
              resetTime: Date.now() + 3600 * 1000
            }
          ]
        }
      }
    }
  }, async () => {
    const port = await getFreePort()
    const prepared = await gemini.prepareOAuthSession(port)

    assert.equal(prepared.success, true)
    assert.equal(typeof prepared.session.sessionId, 'string')

    const sessionId = prepared.session.sessionId
    const pending = gemini.getPendingOAuthSession(sessionId)
    assert.equal(typeof pending.state, 'string')
    const pendingStatus = await gemini.getOAuthSessionStatus(sessionId)
    assert.equal(pendingStatus.status, 'pending')

    await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/oauth2callback?code=test-code&state=${encodeURIComponent(pending.state)}`, (res) => {
        res.resume()
        res.on('end', resolve)
      })
      req.on('error', reject)
    })

    const completed = await waitFor(async () => {
      const status = await gemini.getOAuthSessionStatus(sessionId)
      if (status.status === 'processing') return null
      return status
    }, { errorMessage: 'Gemini 自动 OAuth 未进入完成状态' })

    assert.equal(completed.success, true)
    assert.equal(completed.status, 'completed')
    assert.match(String(completed.callbackUrl || ''), /code=test-code/)
    assert.equal(typeof completed.accountId, 'string')

    const accounts = gemini.list() || []
    const added = accounts.find(item => item && item.id === completed.accountId)
    assert.ok(added)
    assert.equal(added.email, 'auto-oauth@gmail.com')

    const consumed = await gemini.completeOAuthSession(sessionId, '')
    assert.equal(consumed.success, true)
    assert.equal(consumed.account.id, completed.accountId)

    if (!beforeIds.has(completed.accountId)) {
      gemini.deleteAccount(completed.accountId)
    }
  })
})

test('Gemini prepareOAuthSession 在默认端口被占用时应自动切换可用端口', async () => {
  const gemini = require(path.join(process.cwd(), 'packages/platforms/src/geminiService.impl.cjs'))
  const shouldBlock = await isPortAvailable(1458)
  const blocker = shouldBlock ? net.createServer() : null

  if (blocker) {
    await new Promise((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(1458, '127.0.0.1', resolve)
    })
  }

  const fakeIdToken = buildFakeJwt({ email: 'fallback-port@gmail.com', sub: 'gemini-port-sub' })

  try {
    await withMockGeminiHttpClient({
      async postForm () {
        return {
          ok: true,
          data: {
            access_token: 'gemini-port-access',
            refresh_token: 'gemini-port-refresh',
            id_token: fakeIdToken,
            token_type: 'Bearer',
            scope: 'openid email profile',
            expires_in: 3600
          }
        }
      },
      async getJSON () {
        return {
          ok: true,
          data: {
            email: 'fallback-port@gmail.com',
            name: 'Fallback Port',
            id: 'gemini-port-sub'
          }
        }
      },
      async postJSON (_url, _headers, payload) {
        if (payload && payload.metadata) {
          return {
            ok: true,
            data: {
              paidTier: { id: 'flash', name: 'Gemini Flash' },
              cloudaicompanionProject: 'projects/fallback-port'
            }
          }
        }
        return { ok: true, data: { buckets: [] } }
      }
    }, async () => {
      const prepared = await gemini.prepareOAuthSession()
      assert.equal(prepared.success, true)
      assert.ok(prepared.session)

      const redirect = new URL(prepared.session.redirectUri)
      assert.notEqual(Number(redirect.port), 1458)

      const pending = gemini.getPendingOAuthSession(prepared.session.sessionId)
      assert.equal(typeof pending.state, 'string')

      await new Promise((resolve, reject) => {
        const req = http.get(`${prepared.session.redirectUri}?code=test-code&state=${encodeURIComponent(pending.state)}`, (res) => {
          res.resume()
          res.on('end', resolve)
        })
        req.on('error', reject)
      })

      const completed = await waitFor(async () => {
        const status = await gemini.getOAuthSessionStatus(prepared.session.sessionId)
        if (status.status === 'processing') return null
        return status
      }, { errorMessage: 'Gemini 备用端口 OAuth 未进入完成状态' })

      assert.equal(completed.success, true)
      assert.equal(completed.status, 'completed')

      const consumed = await gemini.completeOAuthSession(prepared.session.sessionId, '')
      assert.equal(consumed.success, true)

      const accountId = String(consumed.account && consumed.account.id ? consumed.account.id : completed.accountId || '').trim()
      if (accountId) {
        gemini.deleteAccount(accountId)
      }
    })
  } finally {
    if (blocker) {
      await new Promise((resolve, reject) => {
        blocker.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
  }
})

test('Codex 连续重新生成授权链接时不应因为旧监听占用 1455 端口而失败', async () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))

  const firstPrepared = await codex.prepareOAuthSession()
  assert.equal(firstPrepared.success, true)
  assert.equal(typeof firstPrepared.session.sessionId, 'string')

  const secondPrepared = await codex.prepareOAuthSession()
  assert.equal(secondPrepared.success, true)
  assert.equal(typeof secondPrepared.session.sessionId, 'string')
  assert.notEqual(secondPrepared.session.sessionId, firstPrepared.session.sessionId)

  const firstStatus = await codex.getOAuthSessionStatus(firstPrepared.session.sessionId)
  assert.equal(firstStatus.success, false)
  assert.equal(firstStatus.status, 'missing')

  codex.cancelOAuthSession(secondPrepared.session.sessionId)
})

test('Antigravity 连续重新生成授权链接时不应因为旧监听占用 1456 端口而失败', async () => {
  const antigravity = require(path.join(process.cwd(), 'packages/platforms/src/antigravityService.impl.cjs'))

  const firstPrepared = await antigravity.prepareOAuthSession()
  assert.equal(firstPrepared.success, true)
  assert.equal(typeof firstPrepared.session.sessionId, 'string')

  const secondPrepared = await antigravity.prepareOAuthSession()
  assert.equal(secondPrepared.success, true)
  assert.equal(typeof secondPrepared.session.sessionId, 'string')
  assert.notEqual(secondPrepared.session.sessionId, firstPrepared.session.sessionId)

  const firstStatus = await antigravity.getOAuthSessionStatus(firstPrepared.session.sessionId)
  assert.equal(firstStatus.success, false)
  assert.equal(firstStatus.status, 'missing')

  antigravity.cancelOAuthSession(secondPrepared.session.sessionId)
})

test('Gemini 连续重新生成授权链接时应清理旧监听和旧会话', async () => {
  const gemini = require(path.join(process.cwd(), 'packages/platforms/src/geminiService.impl.cjs'))

  const firstPrepared = await gemini.prepareOAuthSession()
  assert.equal(firstPrepared.success, true)
  assert.equal(typeof firstPrepared.session.sessionId, 'string')

  const secondPrepared = await gemini.prepareOAuthSession()
  assert.equal(secondPrepared.success, true)
  assert.equal(typeof secondPrepared.session.sessionId, 'string')
  assert.notEqual(secondPrepared.session.sessionId, firstPrepared.session.sessionId)

  const firstStatus = await gemini.getOAuthSessionStatus(firstPrepared.session.sessionId)
  assert.equal(firstStatus.success, false)
  assert.equal(firstStatus.status, 'missing')

  gemini.cancelOAuthSession(secondPrepared.session.sessionId)
})

test('Gemini 恢复旧 pending 会话时，如果回调监听无法重新启动，应判定会话失效', async () => {
  const modulePath = path.join(process.cwd(), 'packages/platforms/src/geminiService.impl.cjs')
  const gemini = require(modulePath)
  const port = await getFreePort()
  const prepared = await gemini.prepareOAuthSession(port)
  assert.equal(prepared.success, true)

  delete require.cache[require.resolve(modulePath)]
  const reloadedGemini = require(modulePath)

  const blocker = net.createServer()
  await new Promise((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(port, '127.0.0.1', resolve)
  })

  try {
    const status = await reloadedGemini.getOAuthSessionStatus(prepared.session.sessionId)
    assert.equal(status.success, false)
    assert.equal(status.status, 'missing')
    assert.match(String(status.error || ''), /回调端口监听失败|监听启动失败/)
  } finally {
    reloadedGemini.cancelOAuthSession(prepared.session.sessionId)
    await new Promise((resolve, reject) => {
      blocker.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
})
