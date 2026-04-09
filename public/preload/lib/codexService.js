/**
 * codexService.js — Codex 账号管理服务
 *
 * Codex (OpenAI) 本地凭证文件：
 *   ~/.codex/auth.json
 *
 * auth.json 结构示例：
 * {
 *   "token": "<access_token>",
 *   "refresh_token": "<refresh_token>",
 *   "id_token": "<id_token>",
 *   "expiry": "2026-xx-xxTxx:xx:xxZ"
 * }
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const fileUtils = require('./fileUtils')
const storage = require('./accountStorage')

const PLATFORM = 'codex'

// Codex (OpenAI) 配额 API
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

// Codex OAuth2 凭证（提取自 codex-tools）
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = process.env.CODEX_CLIENT_ID || 'app_YOUR_CLIENT_ID'

const DEFAULT_ADVANCED_SETTINGS = {
  startupPath: '',
  autoStartCodexApp: false,
  overrideOpenClaw: true,
  overrideOpenCode: true,
  autoRestartOpenCode: true
}

const MAC_CODEX_APP_CANDIDATES = [
  '/Applications/Codex.app',
  '/Applications/OpenAI Codex.app',
  path.join(os.homedir(), 'Applications', 'Codex.app'),
  path.join(os.homedir(), 'Applications', 'OpenAI Codex.app')
]

const WINDOWS_CODEX_APP_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Codex', 'Codex.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenAI Codex', 'Codex.exe'),
  path.join(process.env.ProgramFiles || '', 'Codex', 'Codex.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Codex', 'Codex.exe')
].filter(Boolean)

const LINUX_CODEX_APP_CANDIDATES = [
  '/usr/bin/codex',
  '/usr/local/bin/codex',
  '/opt/Codex/codex',
  path.join(os.homedir(), '.local', 'bin', 'codex')
]

/**
 * 获取 Codex 配置目录
 * @returns {string}
 */
function getConfigDir () {
  return path.join(fileUtils.getHomeDir(), '.codex')
}

/**
 * 获取 auth.json 完整路径
 * @returns {string}
 */
function getAuthFilePath () {
  return path.join(getConfigDir(), 'auth.json')
}

/**
 * 探测 Codex App 路径
 * @param {string} [customPath]
 * @returns {string}
 */
function detectCodexAppPath (customPath) {
  const custom = (customPath || '').trim()
  if (custom && fs.existsSync(custom)) {
    return custom
  }

  const candidates = _getCodexAppCandidatesByPlatform()
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      return candidates[i]
    }
  }
  return ''
}

/**
 * 列出所有 Codex 账号
 * @returns {Array}
 */
function list () {
  return storage.listAccounts(PLATFORM)
}

/**
 * 获取当前激活账号
 * @returns {object|null}
 */
function getCurrent () {
  return storage.getCurrentAccount(PLATFORM)
}

/**
 * 从本地 ~/.codex/auth.json 导入当前登录的账号
 * @returns {object} { imported: object|null, error: string|null }
 */
function importFromLocal () {
  const authFile = getAuthFilePath()
  const data = fileUtils.readJsonFile(authFile)

  if (!data) {
    return { imported: null, error: '未找到 Codex 凭证文件: ' + authFile }
  }

  const accessToken = data.token || data.access_token || ''
  const refreshToken = data.refresh_token || ''
  const idToken = data.id_token || ''

  if (!accessToken && !refreshToken) {
    return { imported: null, error: 'auth.json 中未找到有效 token' }
  }

  // 解析 JWT 获取邮箱
  const email = extractEmailFromJwt(idToken || accessToken) || 'local@codex'

  const account = {
    id: fileUtils.generateId(),
    email: email,
    auth_mode: 'oauth',
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken
    },
    tags: ['本地导入'],
    created_at: Date.now(),
    last_used: 0
  }

  storage.addAccount(PLATFORM, account)
  return { imported: account, error: null }
}

/**
 * 从 JSON 字符串导入账号
 * @param {string} jsonContent
 * @returns {object} { imported: Array, error: string|null }
 */
function importFromJson (jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent)
    const rawList = Array.isArray(parsed) ? parsed : [parsed]
    const imported = []

    for (let i = 0; i < rawList.length; i++) {
      const account = normalizeAccount(rawList[i])
      if (account) {
        storage.addAccount(PLATFORM, account)
        imported.push(account)
      }
    }

    if (imported.length === 0) {
      return { imported: [], error: '未找到有效的 Codex 账号数据' }
    }
    return { imported: imported, error: null }
  } catch (err) {
    return { imported: [], error: 'JSON 解析失败: ' + err.message }
  }
}

/**
 * 通过 Token 添加账号
 * @param {string} idToken
 * @param {string} accessToken
 * @param {string} [refreshToken]
 * @returns {object}
 */
function addWithToken (idToken, accessToken, refreshToken) {
  const email = extractEmailFromJwt(idToken || accessToken) || 'token@codex'
  const account = {
    id: fileUtils.generateId(),
    email: email,
    auth_mode: 'token',
    tokens: {
      id_token: idToken || '',
      access_token: accessToken || '',
      refresh_token: refreshToken || ''
    },
    tags: ['Token 导入'],
    created_at: Date.now(),
    last_used: 0
  }
  storage.addAccount(PLATFORM, account)
  return account
}

/**
 * 切换 Codex 账号：写入 ~/.codex/auth.json
 * @param {string} accountId
 * @param {object} [options]
 * @returns {object} { success: boolean, error: string|null, warnings?: string[] }
 */
function switchAccount (accountId, options) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    return { success: false, error: '账号不存在' }
  }

  const tokens = account.tokens || {}
  const authData = {
    token: tokens.access_token || '',
    refresh_token: tokens.refresh_token || '',
    id_token: tokens.id_token || ''
  }

  const configDir = getConfigDir()
  fileUtils.ensureDir(configDir)

  const written = fileUtils.writeJsonFile(getAuthFilePath(), authData)
  if (!written) {
    return { success: false, error: '写入 auth.json 失败' }
  }

  storage.updateAccount(PLATFORM, accountId, { last_used: Date.now() })
  storage.setCurrentId(PLATFORM, accountId)

  const settings = _resolveAdvancedSettings(options)
  const warnings = _applySwitchIntegrations(account, settings)
  return {
    success: true,
    error: null,
    warnings: warnings
  }
}

/**
 * 删除账号
 * @param {string} accountId
 * @returns {boolean}
 */
function deleteAccount (accountId) {
  return storage.deleteAccount(PLATFORM, accountId)
}

/**
 * 批量删除
 * @param {string[]} accountIds
 * @returns {number}
 */
function deleteAccounts (accountIds) {
  return storage.deleteAccounts(PLATFORM, accountIds)
}

/**
 * 刷新配额 — 调用 OpenAI wham/usage API
 * @param {string} accountId
 * @returns {Promise<object>}
 */
function refreshQuota (accountId) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    return { success: false, quota: null, error: '账号不存在' }
  }
  return _refreshCodexQuotaAsync(account, accountId)
}

async function _refreshCodexQuotaAsync (account, accountId) {
  const http = require('./httpClient')
  const tokens = account.tokens || {}

  try {
    // 1. 检查并刷新 token
    let accessToken = tokens.access_token
    if (_isCodexTokenExpired(accessToken)) {
      if (!tokens.refresh_token) {
        return { success: false, quota: null, error: 'Token 已过期且无 refresh_token' }
      }
      const refreshed = await _refreshCodexToken(tokens.refresh_token)
      if (!refreshed.ok) {
        return { success: false, quota: null, error: '刷新 Token 失败: ' + refreshed.error }
      }
      accessToken = refreshed.access_token
      const newTokens = Object.assign({}, tokens, {
        access_token: refreshed.access_token,
        id_token: refreshed.id_token || tokens.id_token,
        refresh_token: refreshed.refresh_token || tokens.refresh_token
      })
      storage.updateAccount(PLATFORM, accountId, { tokens: newTokens })
    }

    // 2. 提取 ChatGPT-Account-Id（从 access_token JWT 中提取）
    const accId = _extractChatGptAccountId(accessToken)
    const headers = { Authorization: 'Bearer ' + accessToken }
    if (accId) {
      headers['ChatGPT-Account-Id'] = accId
    }

    // 3. 调用 wham/usage API
    const res = await http.getJSON(CODEX_USAGE_URL, headers)
    if (!res.ok) {
      return {
        success: false,
        quota: null,
        error: 'API 返回 ' + res.status + ': ' + (res.raw || '').slice(0, 200)
      }
    }

    // 4. 解析配额
    const quota = _parseCodexQuota(res.data)
    const planType = (res.data && res.data.plan_type) || account.plan_type
    storage.updateAccount(PLATFORM, accountId, { quota: quota, plan_type: planType })

    return { success: true, quota: quota, error: null }
  } catch (err) {
    return { success: false, quota: null, error: err.message || String(err) }
  }
}

/** 刷新 Codex access_token */
async function _refreshCodexToken (refreshToken) {
  const http = require('./httpClient')
  const res = await http.postForm(CODEX_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CODEX_CLIENT_ID
  })
  if (!res.ok || !res.data || !res.data.access_token) {
    return { ok: false, error: (res.raw || '').slice(0, 200) }
  }
  return {
    ok: true,
    access_token: res.data.access_token,
    id_token: res.data.id_token || '',
    refresh_token: res.data.refresh_token || ''
  }
}

/** 检查 JWT 是否过期 */
function _isCodexTokenExpired (token) {
  if (!token) return true
  try {
    const parts = token.split('.')
    if (parts.length < 2) return true
    const payload = parts[1]
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    const data = JSON.parse(decoded)
    if (!data.exp) return false
    return data.exp < Math.floor(Date.now() / 1000) + 60
  } catch {
    return true
  }
}

/** 从 access_token JWT 提取 ChatGPT Account ID */
function _extractChatGptAccountId (token) {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    const data = JSON.parse(decoded)
    // OpenAI 的 JWT 中 account_id 在 https://api.openai.com/auth 自定义 claim 中
    const authClaim = data['https://api.openai.com/auth'] || {}
    return authClaim.account_id || data.account_id || null
  } catch {
    return null
  }
}

/** 解析 wham/usage 响应为配额数据 */
function _parseCodexQuota (data) {
  const rl = data && data.rate_limit ? data.rate_limit : null
  const primary = rl ? rl.primary_window : null
  const secondary = rl ? rl.secondary_window : null
  const windows = _resolveRateLimitWindows(primary, secondary)
  const hourly = windows.hourlyWindow || null
  const weekly = windows.weeklyWindow || null
  const codeReviewPrimary = data && data.code_review_rate_limit ? data.code_review_rate_limit.primary_window : null

  const hourlyUsed = (hourly && typeof hourly.used_percent === 'number') ? hourly.used_percent : 0
  const weeklyUsed = (weekly && typeof weekly.used_percent === 'number') ? weekly.used_percent : 0
  const codeReviewUsed = (codeReviewPrimary && typeof codeReviewPrimary.used_percent === 'number')
    ? codeReviewPrimary.used_percent
    : null

  const hourlyReset = _normalizeResetTime(hourly)
  const weeklyReset = _normalizeResetTime(weekly)
  const codeReviewReset = _normalizeResetTime(codeReviewPrimary)

  return {
    hourly_percentage: Math.max(0, Math.min(100, 100 - hourlyUsed)),
    hourly_reset_time: hourlyReset,
    hourly_requests_left: _pickNumberField(hourly, ['remaining', 'requests_left']),
    hourly_requests_limit: _pickNumberField(hourly, ['limit', 'requests_limit']),
    weekly_percentage: Math.max(0, Math.min(100, 100 - weeklyUsed)),
    weekly_reset_time: weeklyReset,
    weekly_requests_left: _pickNumberField(weekly, ['remaining', 'requests_left']),
    weekly_requests_limit: _pickNumberField(weekly, ['limit', 'requests_limit']),
    code_review_percentage: typeof codeReviewUsed === 'number'
      ? Math.max(0, Math.min(100, 100 - codeReviewUsed))
      : null,
    code_review_reset_time: codeReviewReset,
    code_review_requests_left: _pickNumberField(codeReviewPrimary, ['remaining', 'requests_left']),
    code_review_requests_limit: _pickNumberField(codeReviewPrimary, ['limit', 'requests_limit']),
    updated_at: Math.floor(Date.now() / 1000)
  }
}

function _normalizeResetTime (window) {
  if (!window) return null
  if (typeof window.reset_at === 'number') return window.reset_at
  if (typeof window.reset_after_seconds === 'number' && window.reset_after_seconds >= 0) {
    return Math.floor(Date.now() / 1000) + window.reset_after_seconds
  }
  return null
}

function _resolveRateLimitWindows (primary, secondary) {
  const windows = [primary, secondary].filter(Boolean)
  if (windows.length === 0) {
    return {}
  }
  if (windows.length === 1) {
    const one = windows[0]
    if (_isWeeklyWindow(one)) return { weeklyWindow: one }
    return { hourlyWindow: one }
  }
  const sorted = windows.slice().sort(function (left, right) {
    return _getWindowSeconds(left) - _getWindowSeconds(right)
  })
  return {
    hourlyWindow: sorted[0],
    weeklyWindow: sorted[sorted.length - 1]
  }
}

function _isWeeklyWindow (window) {
  const sec = _getWindowSeconds(window)
  return sec >= 24 * 60 * 60
}

function _getWindowSeconds (window) {
  if (!window || typeof window !== 'object') return Number.MAX_SAFE_INTEGER
  if (typeof window.limit_window_seconds === 'number' && window.limit_window_seconds > 0) {
    return window.limit_window_seconds
  }
  return Number.MAX_SAFE_INTEGER
}

function _pickNumberField (source, fields) {
  if (!source || !Array.isArray(fields)) return null
  for (let i = 0; i < fields.length; i++) {
    const val = source[fields[i]]
    if (typeof val === 'number') return val
  }
  return null
}

/**
 * 导出账号
 * @param {string[]} accountIds
 * @returns {string}
 */
function exportAccounts (accountIds) {
  return storage.exportAccounts(PLATFORM, accountIds)
}

/**
 * 更新标签
 * @param {string} accountId
 * @param {string[]} tags
 * @returns {object|null}
 */
function updateTags (accountId, tags) {
  return storage.updateAccount(PLATFORM, accountId, { tags: tags })
}

/**
 * 获取 Codex Plan 显示名
 * @param {string} [planType]
 * @returns {string}
 */
function getPlanDisplayName (planType) {
  if (!planType) return 'FREE'
  const upper = planType.toUpperCase()
  if (upper.includes('TEAM')) return 'TEAM'
  if (upper.includes('ENTERPRISE')) return 'ENTERPRISE'
  if (upper.includes('PLUS')) return 'PLUS'
  if (upper.includes('PRO')) return 'PRO'
  return upper
}

// ---- 内部工具函数 ----

/**
 * 从 JWT token 解析邮箱
 * @param {string} token
 * @returns {string|null}
 */
function extractEmailFromJwt (token) {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    const data = JSON.parse(decoded)
    return data.email || data.sub || null
  } catch {
    return null
  }
}

/**
 * 标准化 Codex 账号数据
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeAccount (raw) {
  if (!raw) return null

  const tokens = raw.tokens || {}
  const accessToken = tokens.access_token || raw.access_token || raw.token || ''
  const refreshToken = tokens.refresh_token || raw.refresh_token || ''
  const idToken = tokens.id_token || raw.id_token || ''

  if (!accessToken && !refreshToken) return null

  const email = raw.email || extractEmailFromJwt(idToken || accessToken) || 'unknown@codex'

  return {
    id: raw.id || fileUtils.generateId(),
    email: email,
    auth_mode: raw.auth_mode || 'import',
    plan_type: raw.plan_type || '',
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken
    },
    quota: raw.quota || null,
    tags: raw.tags || [],
    created_at: raw.created_at || Date.now(),
    last_used: raw.last_used || 0
  }
}

function _resolveAdvancedSettings (options) {
  const stored = _readAdvancedSettingsFromStorage()
  if (options && typeof options === 'object') {
    return Object.assign({}, DEFAULT_ADVANCED_SETTINGS, stored, options)
  }
  return Object.assign({}, DEFAULT_ADVANCED_SETTINGS, stored)
}

function _readAdvancedSettingsFromStorage () {
  try {
    if (window.utools && window.utools.dbStorage) {
      const saved = window.utools.dbStorage.getItem('codex_advanced_settings')
      if (saved && typeof saved === 'object') return saved
    }
  } catch {}
  return {}
}

function _applySwitchIntegrations (account, settings) {
  const warnings = []

  if (settings.overrideOpenCode) {
    const syncOpenCodeRes = _syncOpenCodeAuthFromCodex(account)
    if (!syncOpenCodeRes.success) {
      warnings.push('OpenCode 覆盖失败: ' + syncOpenCodeRes.error)
    } else if (settings.autoRestartOpenCode) {
      const restartRes = _restartOpenCode(settings.startupPath)
      if (!restartRes.success) {
        warnings.push('OpenCode 重启失败: ' + restartRes.error)
      }
    }
  }

  if (settings.overrideOpenClaw) {
    const syncOpenClawRes = _syncOpenClawAuthFromCodex(account)
    if (!syncOpenClawRes.success) {
      warnings.push('OpenClaw 覆盖失败: ' + syncOpenClawRes.error)
    }
  }

  if (settings.autoStartCodexApp) {
    const launchRes = _launchCodexApp(settings.startupPath)
    if (!launchRes.success) {
      warnings.push('Codex App 启动失败: ' + launchRes.error)
    }
  }

  return warnings
}

function _getCodexAppCandidatesByPlatform () {
  switch (process.platform) {
    case 'darwin':
      return MAC_CODEX_APP_CANDIDATES
    case 'win32':
      return WINDOWS_CODEX_APP_CANDIDATES
    case 'linux':
      return LINUX_CODEX_APP_CANDIDATES
    default:
      return []
  }
}

function _launchCodexApp (customPath) {
  const appPath = detectCodexAppPath(customPath)
  if (!appPath) {
    return { success: false, error: '未找到 Codex App 路径' }
  }

  try {
    if (process.platform === 'darwin') {
      if (appPath.endsWith('.app')) {
        cp.spawn('open', ['-a', appPath], { detached: true, stdio: 'ignore' }).unref()
      } else {
        cp.spawn('open', [appPath], { detached: true, stdio: 'ignore' }).unref()
      }
      return { success: true, path: appPath }
    }

    if (process.platform === 'win32') {
      cp.spawn('cmd', ['/c', 'start', '', appPath], { detached: true, stdio: 'ignore' }).unref()
      return { success: true, path: appPath }
    }

    if (process.platform === 'linux') {
      cp.spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref()
      return { success: true, path: appPath }
    }

    return { success: false, error: '当前系统不支持自动启动' }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

function _syncOpenCodeAuthFromCodex (account) {
  const tokens = account.tokens || {}
  if (!tokens.access_token || !tokens.refresh_token) {
    return { success: false, error: '缺少 access_token 或 refresh_token' }
  }

  const expires = _decodeTokenExpMs(tokens.access_token)
  if (!expires) {
    return { success: false, error: 'access_token 缺少 exp' }
  }

  const paths = _getOpenCodeAuthPathCandidates()
  if (paths.length === 0) {
    return { success: false, error: '无法推断 OpenCode auth.json 路径' }
  }
  const targetPath = _pickPrimaryPath(paths)

  let authJson = {}
  if (fs.existsSync(targetPath)) {
    const existing = fileUtils.readJsonFile(targetPath)
    if (existing && typeof existing === 'object') authJson = existing
  }

  authJson.openai = {
    type: 'oauth',
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: expires,
    accountId: _extractChatGptAccountId(tokens.access_token) || undefined
  }

  const written = fileUtils.writeJsonFile(targetPath, authJson)
  if (!written) return { success: false, error: '写入 OpenCode auth.json 失败' }

  // 尽可能同步到其余已有候选路径
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]
    if (p === targetPath || !fs.existsSync(p)) continue
    fileUtils.writeJsonFile(p, authJson)
  }

  return { success: true }
}

function _syncOpenClawAuthFromCodex (account) {
  const tokens = account.tokens || {}
  if (!tokens.access_token || !tokens.refresh_token) {
    return { success: false, error: '缺少 access_token 或 refresh_token' }
  }

  const expires = _decodeTokenExpMs(tokens.access_token)
  if (!expires) {
    return { success: false, error: 'access_token 缺少 exp' }
  }

  const paths = _getOpenClawAuthProfilesPathCandidates()
  if (paths.length === 0) {
    return { success: false, error: '无法推断 OpenClaw auth-profiles.json 路径' }
  }
  const targetPath = _pickPrimaryPath(paths)

  let authJson = {
    version: 1,
    profiles: {}
  }
  if (fs.existsSync(targetPath)) {
    const existing = fileUtils.readJsonFile(targetPath)
    if (existing && typeof existing === 'object') authJson = existing
  }

  if (!authJson.profiles || typeof authJson.profiles !== 'object') {
    authJson.profiles = {}
  }
  if (!authJson.order || typeof authJson.order !== 'object') {
    authJson.order = {}
  }
  if (!authJson.lastGood || typeof authJson.lastGood !== 'object') {
    authJson.lastGood = {}
  }

  authJson.profiles['openai-codex:default'] = {
    type: 'oauth',
    provider: 'openai-codex',
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: expires,
    accountId: _extractChatGptAccountId(tokens.access_token) || undefined,
    email: account.email || undefined
  }
  authJson.order['openai-codex'] = ['openai-codex:default']
  authJson.lastGood['openai-codex'] = 'openai-codex:default'
  if (!authJson.version) authJson.version = 1

  const written = fileUtils.writeJsonFile(targetPath, authJson)
  if (!written) return { success: false, error: '写入 OpenClaw auth-profiles.json 失败' }

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]
    if (p === targetPath || !fs.existsSync(p)) continue
    fileUtils.writeJsonFile(p, authJson)
  }

  return { success: true }
}

function _getOpenCodeAuthPathCandidates () {
  const candidates = []
  const xdgDataHome = (process.env.XDG_DATA_HOME || '').trim()
  if (xdgDataHome) {
    _pushUniquePath(candidates, path.join(xdgDataHome, 'opencode', 'auth.json'))
  }

  _pushUniquePath(candidates, path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'))

  if (process.platform === 'darwin') {
    _pushUniquePath(candidates, path.join(os.homedir(), 'Library', 'Application Support', 'opencode', 'auth.json'))
  }
  if (process.platform === 'win32') {
    _pushUniquePath(candidates, path.join(process.env.APPDATA || '', 'opencode', 'auth.json'))
    _pushUniquePath(candidates, path.join(process.env.LOCALAPPDATA || '', 'opencode', 'auth.json'))
  }
  if (process.platform === 'linux') {
    _pushUniquePath(candidates, path.join(os.homedir(), '.config', 'opencode', 'auth.json'))
  }

  return candidates.filter(Boolean)
}

function _getOpenClawAuthProfilesPathCandidates () {
  const candidates = []
  const envAgentDir = (process.env.OPENCLAW_AGENT_DIR || process.env.PI_CODING_AGENT_DIR || '').trim()
  if (envAgentDir) {
    _pushUniquePath(candidates, path.join(_resolveUserPath(envAgentDir), 'auth-profiles.json'))
  }

  const stateDirs = _getOpenClawStateDirCandidates()
  for (let i = 0; i < stateDirs.length; i++) {
    _pushUniquePath(
      candidates,
      path.join(stateDirs[i], 'agents', 'main', 'agent', 'auth-profiles.json')
    )
  }

  return candidates.filter(Boolean)
}

function _getOpenClawStateDirCandidates () {
  const dirs = []
  const explicit = (process.env.OPENCLAW_STATE_DIR || process.env.CLAWDBOT_STATE_DIR || '').trim()
  if (explicit) _pushUniquePath(dirs, _resolveUserPath(explicit))
  _pushUniquePath(dirs, path.join(os.homedir(), '.openclaw'))
  _pushUniquePath(dirs, path.join(os.homedir(), '.clawdbot'))
  _pushUniquePath(dirs, path.join(os.homedir(), '.moldbot'))
  _pushUniquePath(dirs, path.join(os.homedir(), '.moltbot'))
  return dirs.filter(Boolean)
}

function _resolveUserPath (rawPath) {
  if (!rawPath) return rawPath
  if (rawPath === '~') return os.homedir()
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return path.join(os.homedir(), rawPath.slice(2))
  }
  return rawPath
}

function _pickPrimaryPath (paths) {
  for (let i = 0; i < paths.length; i++) {
    if (fs.existsSync(paths[i])) return paths[i]
  }
  return paths[0]
}

function _pushUniquePath (arr, val) {
  if (!val) return
  if (arr.indexOf(val) >= 0) return
  arr.push(val)
}

function _decodeTokenExpMs (token) {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    const data = JSON.parse(decoded)
    if (!data.exp || typeof data.exp !== 'number') return null
    return data.exp * 1000
  } catch {
    return null
  }
}

function _restartOpenCode () {
  try {
    _closeOpenCode()
    const started = _startOpenCode()
    if (!started.success) return started
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

function _closeOpenCode () {
  try {
    if (process.platform === 'darwin') {
      cp.execFileSync('pkill', ['-f', 'OpenCode'], { stdio: 'ignore' })
    } else if (process.platform === 'win32') {
      cp.execFileSync('taskkill', ['/IM', 'OpenCode.exe', '/F'], { stdio: 'ignore' })
    } else if (process.platform === 'linux') {
      cp.execFileSync('pkill', ['-f', 'opencode'], { stdio: 'ignore' })
    }
  } catch {}
}

function _startOpenCode () {
  try {
    if (process.platform === 'darwin') {
      cp.spawn('open', ['-a', 'OpenCode'], { detached: true, stdio: 'ignore' }).unref()
      return { success: true }
    }
    if (process.platform === 'win32') {
      const candidates = [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenCode', 'OpenCode.exe'),
        path.join(process.env.ProgramFiles || '', 'OpenCode', 'OpenCode.exe')
      ]
      for (let i = 0; i < candidates.length; i++) {
        if (!fs.existsSync(candidates[i])) continue
        cp.spawn(candidates[i], [], { detached: true, stdio: 'ignore' }).unref()
        return { success: true }
      }
      return { success: false, error: '未找到 OpenCode 可执行文件' }
    }
    if (process.platform === 'linux') {
      const candidates = ['/usr/bin/opencode', '/opt/opencode/opencode', 'opencode']
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].includes('/') && !fs.existsSync(candidates[i])) continue
        cp.spawn(candidates[i], [], { detached: true, stdio: 'ignore' }).unref()
        return { success: true }
      }
      return { success: false, error: '未找到 OpenCode 可执行文件' }
    }
    return { success: false, error: '当前系统不支持重启 OpenCode' }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

module.exports = {
  list,
  getCurrent,
  importFromLocal,
  importFromJson,
  addWithToken,
  switchAccount,
  deleteAccount,
  deleteAccounts,
  refreshQuota,
  exportAccounts,
  updateTags,
  getPlanDisplayName,
  getConfigDir,
  detectCodexAppPath
}
