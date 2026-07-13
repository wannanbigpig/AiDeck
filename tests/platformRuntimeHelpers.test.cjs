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
  const modulePath = path.join(process.cwd(), 'packages/platforms/src/httpClient.cjs')
  const resolved = require.resolve(modulePath)
  const original = require(resolved)
  require.cache[resolved].exports = mockClient
  try {
    return await callback()
  } finally {
    require.cache[resolved].exports = original
  }
}

async function withMockCodexHttpClient (mockClient, callback) {
  const modulePath = path.join(process.cwd(), 'packages/platforms/src/httpClient.cjs')
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

test('normalizeRefreshIntervalMinutes 应支持 1-60 分钟细粒度并保留关闭态', async () => {
  const refreshUtils = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/utils/refreshInterval.js')).href)

  assert.equal(refreshUtils.normalizeRefreshIntervalMinutes(0, 10), 0)
  assert.equal(refreshUtils.normalizeRefreshIntervalMinutes(1, 10), 1)
  assert.equal(refreshUtils.normalizeRefreshIntervalMinutes(2.6, 10), 3)
  assert.equal(refreshUtils.normalizeRefreshIntervalMinutes(61, 10), 60)
  assert.equal(refreshUtils.normalizeRefreshIntervalMinutes('17', 10), 17)
  assert.equal(refreshUtils.normalizeRefreshIntervalMinutes('bad', 10), 10)
  assert.equal(refreshUtils.normalizeRefreshIntervalMinutes(undefined, 0), 0)
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

test('normalizeCodexAdvancedSettings 应清理旧触发模型配置并保留优先切同邮箱开关', async () => {
  const codexUtils = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/utils/codex.js')).href)
  const normalized = codexUtils.normalizeCodexAdvancedSettings({
    codexCliPath: ' /tmp/custom-codex ',
    codexCliInstanceMode: 'default',
    autoSwitch: true,
    autoSwitchModelGroup: 'codex',
    autoSwitchPreferSameEmail: false,
    showCodeReviewQuota: true
  })

  assert.equal(normalized.codexCliPath, '/tmp/custom-codex')
  assert.equal(normalized.codexCliInstanceMode, 'default')
  assert.equal(normalized.autoSwitch, true)
  assert.equal(normalized.autoSwitchPreferSameEmail, false)
  assert.equal(normalized.hourlyQuotaControlEnabled, false)
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'autoSwitchModelGroup'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'showCodeReviewQuota'), false)

  const fallback = codexUtils.normalizeCodexAdvancedSettings({ codexCliInstanceMode: 'bad-value' })
  assert.equal(fallback.codexCliInstanceMode, 'bound')
  assert.equal(codexUtils.shouldUseCodexHourlyQuota(fallback), false)
  assert.equal(codexUtils.shouldUseCodexHourlyQuota({ hourlyQuotaControlEnabled: true }), true)
})

test('resolveCodexAccountRoleDisplay 应格式化团队账号角色', async () => {
  const codexUtils = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/utils/codex.js')).href)

  assert.equal(codexUtils.resolveCodexAccountRoleDisplay({ account_user_role: 'account-owner' }), '所有者')
  assert.equal(codexUtils.resolveCodexAccountRoleDisplay({ account_user_role: 'member' }), '成员')
  assert.equal(codexUtils.resolveCodexAccountRoleDisplay({ account_user_role: 'custom-role' }), 'custom-role')
  assert.equal(codexUtils.resolveCodexAccountRoleDisplay({}), '')
})

test('resolveCodexCurrentAccount 在重复 ID 时只选择最近激活账号', async () => {
  const { resolveCodexCurrentAccount } = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/utils/codex.js')).href)
  const team = { id: 'shared-id', plan_type: 'team', last_used: 100 }
  const plus = { id: 'shared-id', plan_type: 'plus', last_used: 200 }

  assert.equal(resolveCodexCurrentAccount([team, plus], 'shared-id'), plus)
  assert.equal(resolveCodexCurrentAccount([team, plus], 'missing-id'), null)
})

test('Codex 自动切号候选应跳过失效账号并按健康分排序', async () => {
  const { rankCodexAutoSwitchCandidates } = await loadRuntimeHelper('autoSwitchCandidates.js')
  const nowMs = Date.UTC(2026, 4, 11, 8, 0, 0)
  const current = { id: 'current', email: 'user@example.com' }

  const ranked = rankCodexAutoSwitchCandidates({
    nowMs,
    current,
    settings: { autoSwitchPreferSameEmail: true },
    hitHourly: true,
    hitWeekly: false,
    hourlyThreshold: 20,
    weeklyThreshold: 20,
    accounts: [
      {
        id: 'invalid-best-quota',
        email: 'user@example.com',
        invalid: true,
        quota: { hourly_percentage: 99, weekly_percentage: 99, updated_at: nowMs }
      },
      {
        id: 'stale-same-email',
        email: 'user@example.com',
        quota: { hourly_percentage: 92, weekly_percentage: 92, updated_at: nowMs - 30 * 60 * 60 * 1000 }
      },
      {
        id: 'fresh-different-email',
        email: 'other@example.com',
        quota: {
          hourly_percentage: 82,
          weekly_percentage: 82,
          updated_at: nowMs,
          additional_rate_limits: [
            { hourly_percentage: 80, weekly_percentage: 80 }
          ]
        }
      }
    ]
  })

  assert.deepEqual(ranked.map(item => item.account.id), [
    'fresh-different-email',
    'stale-same-email'
  ])
})

test('Antigravity 自动切号候选应按触发分组和账号健康度排序', async () => {
  const { rankAntigravityAutoSwitchCandidates } = await loadRuntimeHelper('autoSwitchCandidates.js')
  const nowMs = Date.UTC(2026, 4, 11, 8, 0, 0)
  const current = { id: 'current' }
  const quotaMaps = {
    fresh: { claude: 40, gemini_pro: 35 },
    stale: { claude: 80, gemini_pro: 80 },
    invalid: { claude: 95, gemini_pro: 95 }
  }

  const ranked = rankAntigravityAutoSwitchCandidates({
    nowMs,
    current,
    watchGroups: ['claude', 'gemini_pro'],
    triggeredGroups: ['claude'],
    threshold: 20,
    getQuotaPercentageMap: account => quotaMaps[account.id] || {},
    resolveCandidateScore: (map, groups) => Math.max(...groups.map(group => Number(map[group])).filter(Number.isFinite)),
    accounts: [
      { id: 'invalid', invalid: true, quota: { updated_at: nowMs } },
      { id: 'stale', quota: { updated_at: nowMs - 30 * 60 * 60 * 1000 } },
      { id: 'fresh', quota: { updated_at: nowMs } }
    ]
  })

  assert.deepEqual(ranked.map(item => item.account.id), ['fresh', 'stale'])
})

test('formatImportSummary 应展示导入新增和合并摘要', async () => {
  const { formatImportSummary, summarizeImportDetails } = await loadRuntimeHelper('importSummary.js')
  const details = [
    { action: 'added', reason: 'new_identity' },
    { action: 'merged', reason: 'same_refresh_token' },
    { action: 'merged', reason: 'same_refresh_token' }
  ]

  assert.deepEqual(summarizeImportDetails(details, 0), {
    total: 3,
    counts: {
      added: 1,
      merged: 2,
      skipped: 0,
      invalid: 0
    },
    reasons: ['new_identity', 'same_refresh_token'],
    hasDetails: true
  })
  assert.equal(formatImportSummary(details, 0), '导入完成：新增 1，合并 2（新身份、同 refresh_token）')
  assert.equal(formatImportSummary([], 2), '成功导入 2 个账号')
})

test('Codex 配额解析应忽略代码审查额度并保留额外模型与积分', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const parsed = codex._internal.parseCodexQuota({
    plan_type: 'pro',
    rate_limit: {
      primary_window: {
        used_percent: 54,
        limit_window_seconds: 18000,
        reset_at: 1777289063
      },
      secondary_window: {
        used_percent: 11,
        limit_window_seconds: 604800,
        reset_at: 1777875863
      }
    },
    code_review_rate_limit: {
      primary_window: {
        used_percent: 99,
        limit_window_seconds: 18000,
        reset_at: 1777290000
      }
    },
    additional_rate_limits: [
      {
        limit_name: 'GPT-5.3-Codex-Spark',
        metered_feature: 'codex_bengalfox',
        rate_limit: {
          primary_window: {
            used_percent: 0,
            limit_window_seconds: 18000,
            reset_at: 1777299448
          },
          secondary_window: {
            used_percent: 0,
            limit_window_seconds: 604800,
            reset_at: 1777886248
          }
        }
      }
    ],
    credits: {
      has_credits: false,
      unlimited: false,
      overage_limit_reached: false,
      balance: '0',
      approx_local_messages: [0, 0],
      approx_cloud_messages: [0, 0]
    }
  })

  assert.equal(parsed.hourly_percentage, 46)
  assert.equal(parsed.weekly_percentage, 89)
  assert.equal(parsed.schema_version, codex._internal.CODEX_QUOTA_SCHEMA_VERSION)
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'code_review_percentage'), false)
  assert.equal(parsed.additional_rate_limits.length, 1)
  assert.equal(parsed.additional_rate_limits[0].limit_name, 'GPT-5.3-Codex-Spark')
  assert.equal(parsed.additional_rate_limits[0].hourly_percentage, 100)
  assert.equal(parsed.additional_rate_limits[0].weekly_percentage, 100)
  assert.deepEqual(parsed.credits, {
    has_credits: false,
    unlimited: false,
    overage_limit_reached: false,
    balance: '0',
    approx_local_messages: [0, 0],
    approx_cloud_messages: [0, 0]
  })
})

test('Codex plan_type 提取应兼容账号记录和套餐对象', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))

  assert.equal(codex._internal.extractCodexPlanType({
    accounts: [
      {
        id: '3894ffd7-0578-45b8-b116-9436b994192e',
        account_user_id: 'user-0vmjXOapR2JnnkTbnutcHGpf__3894ffd7-0578-45b8-b116-9436b994192e',
        structure: 'personal',
        plan_type: 'plus',
        name: null,
        profile_picture_url: null
      }
    ],
    default_account_id: '3894ffd7-0578-45b8-b116-9436b994192e',
    account_ordering: ['3894ffd7-0578-45b8-b116-9436b994192e']
  }, {}), 'plus')

  assert.equal(codex._internal.extractCodexPlanType({
    accounts: [
      { id: 'acc-free', plan_type: 'free' },
      { id: 'acc-plus', subscription: { plan_type: 'plus' } }
    ]
  }, { accountId: 'acc-plus' }), 'plus')

  assert.equal(codex._internal.extractCodexPlanType({
    account: {
      id: 'acc-team',
      current_plan: { slug: 'team' }
    }
  }, { accountId: 'acc-team' }), 'team')

  assert.equal(codex._internal.extractCodexPlanType({
    accounts: [
      {
        id: 'acc-shared',
        organization_id: 'org-plus',
        plan_type: 'plus'
      },
      {
        id: 'acc-shared',
        organization_id: 'org-team',
        plan_type: 'team'
      }
    ],
    default_account_id: 'acc-shared',
    account_ordering: ['acc-shared']
  }, {
    accountId: 'acc-shared',
    organizationId: 'org-team'
  }), 'team')
})

test('Codex 重置次数快照应取最近到期时间，并忽略已使用次数', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const nowSec = Math.floor(Date.now() / 1000)
  const parsed = codex._internal.parseCodexResetCreditsSnapshot({
    available_count: 2,
    credits: [
      {
        id: 'credit-used-late',
        expires_at: nowSec + 7 * 24 * 3600,
        redeemed_at: nowSec - 60
      },
      {
        id: 'credit-early',
        expires_at: nowSec + 2 * 24 * 3600
      },
      {
        id: 'credit-late',
        expires_at: nowSec + 5 * 24 * 3600
      }
    ]
  })

  assert.equal(parsed.available_count, 2)
  assert.equal(parsed.credits[0].status, 'redeemed')
  assert.equal(parsed.credits[1].status, 'available')
  assert.equal(parsed.credits[2].status, 'available')
  assert.equal(parsed.next_expires_at, nowSec + 2 * 24 * 3600)
})

test('Codex accounts/check 账号信息应补全本地账号字段', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))

  assert.deepEqual(codex._internal.parseAccountProfileFromCheckResponse({
    accounts: [
      {
        id: 'acc-plus',
        account_user_id: 'user-abc__acc-plus',
        account_user_role: 'account-owner',
        structure: 'personal',
        plan_type: 'plus',
        name: null,
        profile_picture_url: 'https://example.com/avatar.png',
        is_zdr: false,
        is_openai_internal: false
      }
    ],
    default_account_id: 'acc-plus',
    account_ordering: ['acc-plus']
  }, {}), {
    userId: 'user-abc__acc-plus',
    accountId: 'acc-plus',
    organizationId: '',
    accountName: '',
    accountStructure: 'personal',
    accountUserRole: 'account-owner',
    profilePictureUrl: 'https://example.com/avatar.png',
    isZdr: false,
    isOpenaiInternal: false
  })
})

test('Codex accounts/check 在同 account_id 不同 organization_id 时应优先匹配 workspace', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))

  assert.deepEqual(codex._internal.parseAccountProfileFromCheckResponse({
    accounts: [
      {
        id: 'acc-shared',
        organization_id: 'org-plus',
        account_user_id: 'user-plus__acc-shared',
        account_user_role: 'member',
        structure: 'personal',
        plan_type: 'plus',
        name: 'Personal Workspace'
      },
      {
        id: 'acc-shared',
        organization_id: 'org-team',
        account_user_id: 'user-team__acc-shared',
        account_user_role: 'account-owner',
        structure: 'team',
        plan_type: 'team',
        name: 'Team Workspace'
      }
    ],
    default_account_id: 'acc-shared',
    account_ordering: ['acc-shared']
  }, {
    accountId: 'acc-shared',
    organizationId: 'org-team'
  }), {
    userId: 'user-team__acc-shared',
    accountId: 'acc-shared',
    organizationId: 'org-team',
    accountName: 'Team Workspace',
    accountStructure: 'team',
    accountUserRole: 'account-owner',
    profilePictureUrl: '',
    isZdr: null,
    isOpenaiInternal: null
  })
})

test('Codex profile 拉取在同 account_id 不同 organization_id 时不应串错套餐', async () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const accessToken = buildFakeJwt({
    sub: 'auth0|shared-user',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acc-shared',
      chatgpt_organization_id: 'org-team',
      chatgpt_plan_type: 'plus',
      organizations: [
        { id: 'org-plus', title: 'Personal Workspace' },
        { id: 'org-team', title: 'Team Workspace' }
      ]
    }
  })

  await withMockCodexHttpClient({
    async getJSON (url) {
      if (!url.includes('/wham/accounts/check')) return { ok: false, data: null }
      return {
        ok: true,
        data: {
          plan_type: 'plus',
          accounts: [
            {
              id: 'acc-shared',
              organization_id: 'org-plus',
              structure: 'personal',
              plan_type: 'plus',
              name: 'Personal Workspace'
            },
            {
              id: 'acc-shared',
              organization_id: 'org-team',
              structure: 'team',
              plan_type: 'team',
              name: 'Team Workspace'
            }
          ],
          default_account_id: 'acc-shared',
          account_ordering: ['acc-shared']
        }
      }
    }
  }, async () => {
    const profile = await codex._internal.fetchCodexProfile(accessToken, '')
    assert.equal(profile.planType, 'team')
    assert.equal(profile.organizationId, 'org-team')
    assert.equal(profile.accountStructure, 'team')
    assert.equal(profile.accountName, 'Team Workspace')
    assert.equal(profile.workspace, 'Team Workspace')
  })
})

test('Codex 订阅状态应按 organization_id 读取 workspace entitlement 到期时间', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const snapshot = codex._internal.parseCodexSubscriptionStatus({
    accounts: [
      {
        account: { id: 'acc-shared', organization_id: 'org-plus', plan_type: 'plus' },
        entitlement: { subscription_plan: 'plus', expires_at: '2026-08-01T00:00:00Z' }
      },
      {
        account: { id: 'acc-shared', organization_id: 'org-team', plan_type: 'team' },
        entitlement: { subscription_plan: 'team', expires_at: '2026-09-15T00:00:00Z' }
      }
    ]
  }, { accountId: 'acc-shared', organizationId: 'org-team' })

  assert.deepEqual(snapshot, {
    accountId: 'acc-shared',
    planType: 'team',
    subscriptionActiveUntil: '2026-09-15T00:00:00Z'
  })
})

test('Codex 订阅状态应按真实 account_id 区分无 organization_id 的 Plus 与 Team', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const payload = {
    accounts: {
      'acc-team': {
        account: { account_id: 'acc-team', organization_id: 'org-team', name: 'leixiaoan', structure: 'workspace', plan_type: 'team' },
        entitlement: { subscription_plan: 'chatgptteamplan', expires_at: '2026-07-17T16:03:08Z' }
      },
      'acc-personal': {
        account: { account_id: 'acc-personal', organization_id: null, name: null, structure: 'personal', plan_type: 'plus' },
        entitlement: { subscription_plan: 'chatgptplusplan', expires_at: '2026-08-04T15:21:25Z' }
      },
      default: {
        account: { account_id: 'acc-personal', organization_id: null, name: null, structure: 'personal', plan_type: 'plus' },
        entitlement: { subscription_plan: 'chatgptplusplan', expires_at: '2026-08-04T15:21:25Z' }
      }
    },
    account_ordering: ['acc-team', 'acc-personal']
  }

  assert.deepEqual(codex._internal.parseCodexSubscriptionStatus(payload, { accountId: 'acc-personal' }), {
    accountId: 'acc-personal',
    planType: 'chatgptplusplan',
    subscriptionActiveUntil: '2026-08-04T15:21:25Z'
  })
  assert.deepEqual(codex._internal.parseCodexSubscriptionStatus(payload, { accountId: 'acc-team' }), {
    accountId: 'acc-team',
    planType: 'chatgptteamplan',
    subscriptionActiveUntil: '2026-07-17T16:03:08Z'
  })
})

test('Codex profile 应以 workspace 订阅接口到期时间覆盖 JWT claim', async () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const accessToken = buildFakeJwt({
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acc-shared',
      chatgpt_organization_id: 'org-team',
      chatgpt_subscription_active_until: '2026-08-01T00:00:00Z'
    }
  })

  await withMockCodexHttpClient({
    async getJSON (url) {
      if (url.includes('/accounts/check/v4-2023-04-27')) {
        return {
          ok: true,
          data: {
            accounts: [{
              account: { id: 'acc-shared', organization_id: 'org-team', plan_type: 'team' },
              entitlement: { subscription_plan: 'team', expires_at: '2026-09-15T00:00:00Z' }
            }]
          }
        }
      }
      return { ok: false, data: null }
    }
  }, async () => {
    const profile = await codex._internal.fetchCodexProfile(accessToken, '')
    assert.equal(profile.planType, 'team')
    assert.equal(profile.subscriptionActiveUntil, '2026-09-15T00:00:00Z')
  })
})

test('Codex profile 应按 account_id 从真实多 workspace 响应读取 Plus 到期时间', async () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const accessToken = buildFakeJwt({
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acc-personal',
      chatgpt_plan_type: 'plus',
      chatgpt_subscription_active_until: '2026-07-17T16:03:08Z'
    }
  })

  await withMockCodexHttpClient({
    async getJSON (url) {
      if (url.includes('/wham/accounts/check')) {
        return {
          ok: true,
          data: {
            accounts: [
              { id: 'acc-personal', structure: 'personal', plan_type: 'plus', name: null },
              { id: 'acc-team', structure: 'workspace', plan_type: 'team', name: 'leixiaoan' }
            ]
          }
        }
      }
      if (url.includes('/accounts/check/v4-2023-04-27')) {
        return {
          ok: true,
          data: {
            accounts: {
              'acc-team': {
                account: { account_id: 'acc-team', structure: 'workspace', plan_type: 'team' },
                entitlement: { subscription_plan: 'chatgptteamplan', expires_at: '2026-07-17T16:03:08Z' }
              },
              'acc-personal': {
                account: { account_id: 'acc-personal', structure: 'personal', plan_type: 'plus' },
                entitlement: { subscription_plan: 'chatgptplusplan', expires_at: '2026-08-04T15:21:25Z' }
              }
            },
            account_ordering: ['acc-team', 'acc-personal']
          }
        }
      }
      return { ok: false, data: null }
    }
  }, async () => {
    const profile = await codex._internal.fetchCodexProfile(accessToken, '')
    assert.equal(profile.accountId, 'acc-personal')
    assert.equal(profile.planType, 'chatgptplusplan')
    assert.equal(profile.subscriptionActiveUntil, '2026-08-04T15:21:25Z')
  })
})

test('Codex 订阅接口被 Node challenge 拦截时应用 fetch 重试并更新到期时间', async () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const accessToken = buildFakeJwt({
    'https://api.openai.com/auth': { chatgpt_account_id: 'acc-personal', chatgpt_plan_type: 'plus' }
  })
  const subscriptionPayload = {
    accounts: {
      'acc-personal': {
        account: { account_id: 'acc-personal', organization_id: null, structure: 'personal', plan_type: 'plus' },
        entitlement: { subscription_plan: 'chatgptplusplan', expires_at: '2026-08-04T15:21:25Z' }
      }
    }
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(subscriptionPayload), { status: 200 })
  try {
    await withMockCodexHttpClient({
      async getJSON (url) {
        if (url.includes('/wham/accounts/check')) {
          return { ok: true, data: { accounts: [{ id: 'acc-personal', structure: 'personal', plan_type: 'plus' }] } }
        }
        return { ok: false, status: 403, data: null }
      }
    }, async () => {
      const profile = await codex._internal.fetchCodexProfile(accessToken, '')
      assert.equal(profile.planType, 'chatgptplusplan')
      assert.equal(profile.subscriptionActiveUntil, '2026-08-04T15:21:25Z')
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Codex profile patch 应保留显式 false 布尔字段', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))

  assert.deepEqual(codex._internal.buildCodexProfilePatch({
    accountUserRole: 'member',
    profilePictureUrl: 'https://example.com/profile.png',
    isZdr: false,
    isOpenaiInternal: false
  }), {
    account_user_role: 'member',
    profile_picture_url: 'https://example.com/profile.png',
    is_zdr: false,
    is_openai_internal: false
  })
})

test('Codex JWT profile namespace 应用于提取邮箱', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const accessToken = buildFakeJwt({
    sub: 'auth0|abc',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acc-plus',
      chatgpt_account_user_id: 'user-abc__acc-plus',
      chatgpt_plan_type: 'plus'
    },
    'https://api.openai.com/profile': {
      email: 'user@example.com',
      email_verified: true
    }
  })

  assert.deepEqual(codex._internal.extractCodexJwtProfile({
    access_token: accessToken
  }), {
    email: 'user@example.com',
    emailVerified: true
  })
})

test('Codex JSON 导入不应再自动转换 ChatGPT session 响应格式', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const raw = {
    user: {
      id: 'user-abc',
      email: 'user@example.com'
    },
    expires: '2026-08-09T06:23:18.688Z',
    account: {
      id: 'acc-plus',
      planType: 'plus',
      structure: 'personal'
    },
    accessToken: 'access.jwt.token',
    authProvider: 'openai'
  }
  const normalized = codex._internal.normalizeCodexJsonImportRecord(raw)

  assert.equal(normalized, raw)
  assert.equal(normalized.access_token, undefined)
  assert.equal(normalized.id_token, undefined)
})

test('Codex 本地账号匹配应兼容 access_token 导入的账号', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const accessToken = buildFakeJwt({
    sub: 'user-session-1',
    'https://api.openai.com/auth': {
      chatgpt_user_id: 'user-session-1',
      chatgpt_account_id: 'account-session-1'
    },
    'https://api.openai.com/profile': {
      email: 'session@example.com'
    }
  })

  const matched = codex._internal.findCodexAccountByLocalTokens([
    {
      id: 'imported-from-session',
      email: 'session@example.com',
      user_id: 'user-session-1',
      account_id: 'account-session-1',
      tokens: {
        access_token: 'different-session-token',
        refresh_token: ''
      }
    }
  ], {
    access_token: accessToken,
    refresh_token: ''
  })

  assert.equal(matched.id, 'imported-from-session')
})

test('Codex 本地账号匹配在同 account_id 不同 organization_id 时应优先匹配 workspace', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const accessToken = buildFakeJwt({
    sub: 'auth0|shared-user',
    'https://api.openai.com/auth': {
      chatgpt_user_id: 'auth0|shared-user',
      chatgpt_account_id: 'acc-shared',
      chatgpt_organization_id: 'org-team'
    },
    email: 'shared@example.com'
  })

  const matched = codex._internal.findCodexAccountByLocalTokens([
    {
      id: 'plus-workspace',
      email: 'shared@example.com',
      user_id: 'auth0|shared-user',
      account_id: 'acc-shared',
      organization_id: 'org-plus',
      tokens: {
        access_token: 'stale-plus-token',
        refresh_token: ''
      }
    },
    {
      id: 'team-workspace',
      email: 'shared@example.com',
      user_id: 'auth0|shared-user',
      account_id: 'acc-shared',
      organization_id: 'org-team',
      tokens: {
        access_token: 'stale-team-token',
        refresh_token: ''
      }
    }
  ], {
    access_token: accessToken,
    refresh_token: ''
  })

  assert.equal(matched.id, 'team-workspace')
})

test('Codex 订阅到期时间应从 token claim 提取', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const timestampMs = Date.UTC(2026, 1, 2, 3, 4, 0)
  const idToken = buildFakeJwt({
    'https://api.openai.com/auth': {
      chatgpt_subscription_active_until: { value: String(timestampMs) }
    }
  })

  assert.equal(codex._internal.extractCodexSubscriptionActiveUntilFromTokens({
    id_token: idToken,
    access_token: ''
  }), String(timestampMs))
})

test('resolveCodexSubscriptionDisplay 应展示账号字段并兼容 id_token 订阅到期字段', async () => {
  const codexUtils = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/utils/codex.js')).href)
  const timestampMs = Date.UTC(2026, 1, 2, 3, 4, 0)
  const expectedDate = new Date(timestampMs)
  const originalNow = Date.now
  Date.now = () => timestampMs - 5 * 24 * 60 * 60 * 1000
  const expectedText = `${expectedDate.getFullYear()}-${String(expectedDate.getMonth() + 1).padStart(2, '0')}-${String(expectedDate.getDate()).padStart(2, '0')} ${String(expectedDate.getHours()).padStart(2, '0')}:${String(expectedDate.getMinutes()).padStart(2, '0')}（5 天）`

  try {
    assert.equal(codexUtils.resolveCodexSubscriptionDisplay({
      subscription_active_until: String(timestampMs)
    }).text, expectedText)

    const token = buildFakeJwt({
      'https://api.openai.com/auth': {
        chatgpt_subscription_active_until: { value: String(timestampMs) }
      }
    })
    assert.equal(codexUtils.resolveCodexSubscriptionDisplay({
      tokens: { id_token: token }
    }).text, expectedText)
    assert.equal(codexUtils.resolveCodexSubscriptionDisplay({}).text, '未知')
  } finally {
    Date.now = originalNow
  }
})

test('resolveCodexSubscriptionDisplay 应按订阅剩余天数返回颜色', async () => {
  const codexUtils = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/utils/codex.js')).href)
  const originalNow = Date.now
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  Date.now = () => now
  try {
    assert.equal(codexUtils.resolveCodexSubscriptionDisplay({
      subscription_active_until: String(now + 3 * 24 * 60 * 60 * 1000)
    }).color, '#ef4444')
    assert.equal(codexUtils.resolveCodexSubscriptionDisplay({
      subscription_active_until: String(now + 10 * 24 * 60 * 60 * 1000)
    }).color, '#f59e0b')
    assert.equal(codexUtils.resolveCodexSubscriptionDisplay({
      subscription_active_until: String(now + 11 * 24 * 60 * 60 * 1000)
    }).color, 'var(--accent-green)')
  } finally {
    Date.now = originalNow
  }
})

test('三平台预警设置归一化应补齐默认值并限制阈值范围', async () => {
  const antigravityUtils = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/utils/antigravity.js')).href)
  const codexUtils = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/utils/codex.js')).href)
  const geminiUtils = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/utils/gemini.js')).href)

  const antigravity = antigravityUtils.normalizeAntigravityAdvancedSettings({
    quotaWarningEnabled: true,
    quotaWarningClaudeThreshold: 99,
    quotaWarningGeminiProThreshold: -3
  })
  assert.equal(antigravity.quotaWarningEnabled, true)
  assert.equal(antigravity.quotaWarningClaudeThreshold, 30)
  assert.equal(antigravity.quotaWarningGeminiProThreshold, 0)
  assert.equal(antigravity.quotaWarningGeminiFlashThreshold, 10)

  const codex = codexUtils.normalizeCodexAdvancedSettings({
    quotaWarningEnabled: true,
    quotaWarningHourlyThreshold: 42,
    quotaWarningWeeklyThreshold: -1
  })
  assert.equal(codex.quotaWarningEnabled, true)
  assert.equal(codex.quotaWarningHourlyThreshold, 30)
  assert.equal(codex.quotaWarningWeeklyThreshold, 0)

  const gemini = geminiUtils.normalizeGeminiAdvancedSettings({
    autoRefreshMinutes: 61,
    quotaWarningEnabled: true,
    quotaWarningProThreshold: 31,
    quotaWarningFlashThreshold: -2
  })
  assert.equal(gemini.autoRefreshMinutes, 60)
  assert.equal(gemini.quotaWarningEnabled, true)
  assert.equal(gemini.quotaWarningProThreshold, 30)
  assert.equal(gemini.quotaWarningFlashThreshold, 0)
})

test('evaluateQuotaWarningPlatform 应按账号与阈值做去重并在恢复后重新触发', async () => {
  const warningHelpers = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/runtime/useQuotaWarningNotifications.js')).href)

  const first = warningHelpers.evaluateQuotaWarningPlatform({
    platform: 'codex',
    account: {
      id: 'cx-1',
      email: 'one@example.com',
      quota: {
        hourly_percentage: 4,
        weekly_percentage: 12
      }
    },
    settings: {
      quotaWarningEnabled: true,
      hourlyQuotaControlEnabled: true,
      quotaWarningHourlyThreshold: 10,
      quotaWarningWeeklyThreshold: 10
    },
    previousState: {},
    skipNotify: false
  })

  assert.equal(first.notification.title, 'Codex 配额预警')
  assert.match(first.notification.message, /5小时配额 4%/)

  const repeated = warningHelpers.evaluateQuotaWarningPlatform({
    platform: 'codex',
    account: {
      id: 'cx-1',
      email: 'one@example.com',
      quota: {
        hourly_percentage: 3,
        weekly_percentage: 12
      }
    },
    settings: {
      quotaWarningEnabled: true,
      hourlyQuotaControlEnabled: true,
      quotaWarningHourlyThreshold: 10,
      quotaWarningWeeklyThreshold: 10
    },
    previousState: first.nextState,
    skipNotify: false
  })

  assert.equal(repeated.notification, null)

  const recovered = warningHelpers.evaluateQuotaWarningPlatform({
    platform: 'codex',
    account: {
      id: 'cx-1',
      email: 'one@example.com',
      quota: {
        hourly_percentage: 18,
        weekly_percentage: 12
      }
    },
    settings: {
      quotaWarningEnabled: true,
      hourlyQuotaControlEnabled: true,
      quotaWarningHourlyThreshold: 10,
      quotaWarningWeeklyThreshold: 10
    },
    previousState: repeated.nextState,
    skipNotify: false
  })

  assert.equal(recovered.notification, null)
  assert.equal(recovered.nextState.hourly.active, false)

  const retriggered = warningHelpers.evaluateQuotaWarningPlatform({
    platform: 'codex',
    account: {
      id: 'cx-1',
      email: 'one@example.com',
      quota: {
        hourly_percentage: 6,
        weekly_percentage: 12
      }
    },
    settings: {
      quotaWarningEnabled: true,
      hourlyQuotaControlEnabled: true,
      quotaWarningHourlyThreshold: 10,
      quotaWarningWeeklyThreshold: 10
    },
    previousState: recovered.nextState,
    skipNotify: false
  })

  assert.ok(retriggered.notification)

  const switchedAccount = warningHelpers.evaluateQuotaWarningPlatform({
    platform: 'codex',
    account: {
      id: 'cx-2',
      email: 'two@example.com',
      quota: {
        hourly_percentage: 5,
        weekly_percentage: 9
      }
    },
    settings: {
      quotaWarningEnabled: true,
      hourlyQuotaControlEnabled: true,
      quotaWarningHourlyThreshold: 10,
      quotaWarningWeeklyThreshold: 10
    },
    previousState: retriggered.nextState,
    skipNotify: false
  })

  assert.ok(switchedAccount.notification)
  assert.match(switchedAccount.notification.message, /two@example.com/)
  assert.match(switchedAccount.notification.message, /5小时配额 5%/)
  assert.match(switchedAccount.notification.message, /周配额 9%/)
})

test('Codex 5 小时配额控制关闭时不生成小时预警项，开启时才生成', async () => {
  const warningHelpers = await import(pathToFileURL(path.join(process.cwd(), 'packages/app-shell/src/runtime/useQuotaWarningNotifications.js')).href)
  const account = {
    id: 'cx-hourly-toggle',
    email: 'toggle@example.com',
    quota: { hourly_percentage: 4, weekly_percentage: 80 }
  }

  const disabled = warningHelpers.buildQuotaWarningItems('codex', account, {
    quotaWarningEnabled: true,
    hourlyQuotaControlEnabled: false,
    quotaWarningHourlyThreshold: 10,
    quotaWarningWeeklyThreshold: 10
  })
  assert.deepEqual(disabled.map(item => item.key), ['weekly'])

  const enabled = warningHelpers.buildQuotaWarningItems('codex', account, {
    quotaWarningEnabled: true,
    hourlyQuotaControlEnabled: true,
    quotaWarningHourlyThreshold: 10,
    quotaWarningWeeklyThreshold: 10
  })
  assert.deepEqual(enabled.map(item => item.key), ['hourly', 'weekly'])
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

test('Codex App 进程识别应覆盖主进程、Helper 和 app-server', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const isAppProcess = codex._internal.isCodexDarwinAppProcessArgs

  assert.equal(isAppProcess('/Applications/Codex.app/Contents/MacOS/Codex'), true)
  assert.equal(isAppProcess('/Applications/OpenAI Codex.app/Contents/MacOS/Codex'), true)
  assert.equal(isAppProcess('/Applications/Codex.app/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper --type=gpu-process'), true)
  assert.equal(isAppProcess('/Applications/Codex.app/Contents/Frameworks/Codex Helper (Renderer).app/Contents/MacOS/Codex Helper (Renderer) --type=renderer'), true)
  assert.equal(isAppProcess('/Applications/Codex.app/Contents/Resources/codex app-server --analytics-default-enabled'), true)
  assert.equal(isAppProcess('/Applications/Codex.app/Contents/Resources/node_repl'), false)
  assert.equal(isAppProcess('/Users/tester/.npm-global/bin/codex'), false)
  assert.equal(isAppProcess('/Users/tester/.vscode/extensions/openai.chatgpt/bin/macos-aarch64/codex app-server'), false)
})

test('Gemini / Antigravity 服务层批量刷新应返回每个账号结果', async () => {
  const antigravity = require(path.join(process.cwd(), 'packages/platforms/src/antigravityService.impl.cjs'))
  const gemini = require(path.join(process.cwd(), 'packages/platforms/src/geminiService.impl.cjs'))

  const geminiResults = await gemini.refreshQuotasBatch(['missing-gemini-account'], {
    concurrency: 1,
    delayMs: 0
  })
  assert.deepEqual(geminiResults, [
    { id: 'missing-gemini-account', success: false, error: '账号不存在' }
  ])

  const antigravityResults = await antigravity.refreshQuotasBatch(['missing-antigravity-account'], {
    concurrency: 1,
    delayMs: 0
  })
  assert.deepEqual(antigravityResults, [
    { id: 'missing-antigravity-account', success: false, error: '账号不存在' }
  ])
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
  const blocker = net.createServer()
  const port = await new Promise((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(0, () => {
      const address = blocker.address()
      const value = address && typeof address === 'object' ? address.port : 0
      resolve(value)
    })
  })
  assert.ok(port > 0)
  await new Promise((resolve, reject) => {
    blocker.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })

  const prepared = await gemini.prepareOAuthSession(port)
  assert.equal(prepared.success, true)
  const callbackPort = Number(new URL(prepared.session.redirectUri).port)
  assert.ok(callbackPort > 0)
  const savedPending = gemini.getPendingOAuthSession(prepared.session.sessionId)
  assert.equal(String(savedPending.callbackUrl || ''), '')
  gemini.cancelOAuthSession(prepared.session.sessionId)
  gemini.savePendingOAuthSession(savedPending)

  delete require.cache[require.resolve(modulePath)]
  const reloadedGemini = require(modulePath)

  await new Promise((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(callbackPort, resolve)
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
