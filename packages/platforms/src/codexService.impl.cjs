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
const crypto = require('node:crypto')
const http = require('node:http')
const { retryOAuthRequest } = require('./utils/retryOAuthRequest')
const fileUtils = require('../../infra-node/src/fileUtils.cjs')
const storage = require('../../infra-node/src/accountStorage.cjs')
const requestLogger = require('../../infra-node/src/requestLogStore.cjs')
const sharedSettingsStore = require('../../infra-node/src/sharedSettingsStore.cjs')

const PLATFORM = 'codex'

// Codex (OpenAI) 配额 API
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

// Codex OAuth2 凭证（提取自 codex-tools）
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = process.env.CODEX_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_OAUTH_SCOPES = 'openid profile email offline_access'
const CODEX_OAUTH_ORIGINATOR = 'codex_vscode'
const CODEX_OAUTH_CALLBACK_PORT = 1455
const CODEX_OAUTH_SESSION_TTL_MS = 10 * 60 * 1000
const LOCAL_SYNC_IMPORT_COOLDOWN_MS = 30 * 1000

const oauthSessions = new Map()
const localSyncState = {
  lastFingerprint: '',
  lastAttemptAt: 0
}

const DEFAULT_ADVANCED_SETTINGS = {
  codexStartupPath: '',
  openCodeStartupPath: '',
  autoRestartCodexApp: false,
  autoStartCodexAppWhenClosed: false,
  overrideOpenCode: true,
  autoRestartOpenCode: false,
  autoStartOpenCodeWhenClosed: false
}

function _resolveRuntimePlatform (runtime) {
  return runtime && typeof runtime.platform === 'string' && runtime.platform.trim()
    ? runtime.platform.trim()
    : process.platform
}

function _resolveRuntimeEnv (runtime) {
  return runtime && runtime.env && typeof runtime.env === 'object'
    ? runtime.env
    : process.env
}

function _resolveRuntimeHomeDir (runtime) {
  return runtime && typeof runtime.homeDir === 'string' && runtime.homeDir.trim()
    ? runtime.homeDir.trim()
    : fileUtils.getHomeDir()
}

function getCodexAppPathCandidates (runtime) {
  const platform = _resolveRuntimePlatform(runtime)
  const env = _resolveRuntimeEnv(runtime)
  const homeDir = _resolveRuntimeHomeDir(runtime)
  const candidates = []

  if (platform === 'darwin') {
    _pushUniquePath(candidates, '/Applications/Codex.app')
    _pushUniquePath(candidates, '/Applications/OpenAI Codex.app')
    _pushUniquePath(candidates, path.join(homeDir, 'Applications', 'Codex.app'))
    _pushUniquePath(candidates, path.join(homeDir, 'Applications', 'OpenAI Codex.app'))
    return candidates
  }

  if (platform === 'win32') {
    _pushUniquePath(candidates, path.join(String(env.LOCALAPPDATA || '').trim(), 'Programs', 'Codex', 'Codex.exe'))
    _pushUniquePath(candidates, path.join(String(env.LOCALAPPDATA || '').trim(), 'Programs', 'OpenAI Codex', 'Codex.exe'))
    _pushUniquePath(candidates, path.join(String(env.ProgramFiles || '').trim(), 'Codex', 'Codex.exe'))
    _pushUniquePath(candidates, path.join(String(env['ProgramFiles(x86)'] || '').trim(), 'Codex', 'Codex.exe'))
    return candidates
  }

  _pushUniquePath(candidates, '/usr/bin/codex')
  _pushUniquePath(candidates, '/usr/local/bin/codex')
  _pushUniquePath(candidates, '/opt/Codex/codex')
  _pushUniquePath(candidates, path.join(homeDir, '.local', 'bin', 'codex'))
  return candidates
}

function getOpenCodeAppPathCandidates (runtime) {
  const platform = _resolveRuntimePlatform(runtime)
  const env = _resolveRuntimeEnv(runtime)
  const homeDir = _resolveRuntimeHomeDir(runtime)
  const candidates = []

  if (platform === 'darwin') {
    _pushUniquePath(candidates, '/Applications/OpenCode.app')
    _pushUniquePath(candidates, '/Applications/OpenCode Beta.app')
    _pushUniquePath(candidates, path.join(homeDir, 'Applications', 'OpenCode.app'))
    _pushUniquePath(candidates, path.join(homeDir, 'Applications', 'OpenCode Beta.app'))
    return candidates
  }

  if (platform === 'win32') {
    _pushUniquePath(candidates, path.join(String(env.LOCALAPPDATA || '').trim(), 'Programs', 'OpenCode', 'OpenCode.exe'))
    _pushUniquePath(candidates, path.join(String(env.ProgramFiles || '').trim(), 'OpenCode', 'OpenCode.exe'))
    _pushUniquePath(candidates, path.join(String(env['ProgramFiles(x86)'] || '').trim(), 'OpenCode', 'OpenCode.exe'))
    return candidates
  }

  _pushUniquePath(candidates, '/usr/bin/opencode')
  _pushUniquePath(candidates, '/usr/local/bin/opencode')
  _pushUniquePath(candidates, '/opt/OpenCode/opencode')
  _pushUniquePath(candidates, path.join(homeDir, '.local', 'bin', 'opencode'))
  return candidates
}

function getDefaultCodexAppPath (runtime) {
  const detected = detectCodexAppPath('', runtime)
  if (detected) return detected
  return getCodexAppPathCandidates(runtime)[0] || ''
}

function getDefaultOpenCodeAppPath (runtime) {
  const detected = detectOpenCodeAppPath('', runtime)
  if (detected) return detected
  return getOpenCodeAppPathCandidates(runtime)[0] || ''
}

function getConfigDirCandidates (runtime) {
  const platform = _resolveRuntimePlatform(runtime)
  const env = _resolveRuntimeEnv(runtime)
  const homeDir = _resolveRuntimeHomeDir(runtime)
  const candidates = []
  const explicit = String(env.CODEX_CONFIG_DIR || '').trim()

  if (explicit) {
    _pushUniquePath(candidates, _resolveUserPath(explicit))
  }

  _pushUniquePath(candidates, path.join(homeDir, '.codex'))

  if (platform === 'win32') {
    const roaming = String(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')).trim()
    const local = String(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')).trim()
    _pushUniquePath(candidates, path.join(roaming, 'Codex'))
    _pushUniquePath(candidates, path.join(roaming, '.codex'))
    _pushUniquePath(candidates, path.join(local, 'Codex'))
    _pushUniquePath(candidates, path.join(local, '.codex'))
  } else if (platform === 'linux') {
    const xdgConfigHome = String(env.XDG_CONFIG_HOME || '').trim()
    if (xdgConfigHome) {
      _pushUniquePath(candidates, path.join(xdgConfigHome, 'codex'))
      _pushUniquePath(candidates, path.join(xdgConfigHome, '.codex'))
    }
    _pushUniquePath(candidates, path.join(homeDir, '.config', 'codex'))
    _pushUniquePath(candidates, path.join(homeDir, '.config', '.codex'))
  }

  return candidates.filter(Boolean)
}

function getAuthFilePathCandidates (runtime) {
  return getConfigDirCandidates(runtime).map(dirPath => path.join(dirPath, 'auth.json'))
}

function getLocalStateWatchTargets (runtime) {
  const dirPaths = getConfigDirCandidates(runtime)
  return {
    dirPaths,
    fileNames: ['auth.json'],
    fallbackPaths: _getParentDirs(dirPaths)
  }
}

/**
 * 获取 Codex 配置目录
 * @returns {string}
 */
function getConfigDir () {
  const authFilePath = _pickExistingPath(getAuthFilePathCandidates())
  if (authFilePath) return path.dirname(authFilePath)
  const dirPath = _pickExistingDir(getConfigDirCandidates())
  if (dirPath) return dirPath
  return getConfigDirCandidates()[0] || path.join(fileUtils.getHomeDir(), '.codex')
}

/**
 * 获取 auth.json 完整路径
 * @returns {string}
 */
function getAuthFilePath () {
  return _pickExistingPath(getAuthFilePathCandidates()) || path.join(getConfigDir(), 'auth.json')
}

function _serializeOAuthSession (session) {
  if (!session || typeof session !== 'object') return null
  return {
    sessionId: session.sessionId || '',
    state: session.state || '',
    verifier: session.verifier || '',
    redirectUri: session.redirectUri || '',
    authUrl: session.authUrl || '',
    callbackUrl: session.callbackUrl || '',
    createdAt: Number(session.createdAt || Date.now()),
    completedAt: Number(session.completedAt || 0)
  }
}

function _saveOAuthSession (session) {
  const serialized = _serializeOAuthSession(session)
  if (!serialized || !serialized.sessionId) return false
  return storage.saveOAuthPending(PLATFORM, serialized)
}

function _loadOAuthSession (sessionId) {
  const sid = String(sessionId || '').trim()
  if (!sid) return null
  const saved = storage.getOAuthPending(PLATFORM, sid)
  if (!saved || typeof saved !== 'object') return null

  const session = {
    sessionId: sid,
    state: String(saved.state || '').trim(),
    verifier: String(saved.verifier || '').trim(),
    redirectUri: String(saved.redirectUri || '').trim(),
    authUrl: String(saved.authUrl || '').trim(),
    callbackUrl: String(saved.callbackUrl || '').trim(),
    createdAt: Number(saved.createdAt || 0) || Date.now(),
    completedAt: Number(saved.completedAt || 0) || 0
  }

  if (!session.state || !session.verifier || !session.redirectUri) {
    return null
  }
  oauthSessions.set(sid, session)
  return session
}

function getPendingOAuthSession (sessionId) {
  if (sessionId) {
    return storage.getOAuthPending(PLATFORM, sessionId)
  }
  return storage.getLatestOAuthPending(PLATFORM, CODEX_OAUTH_SESSION_TTL_MS)
}

function savePendingOAuthSession (payload) {
  return storage.saveOAuthPending(PLATFORM, payload)
}

function clearPendingOAuthSession (sessionId) {
  if (sessionId) {
    return storage.clearOAuthPending(PLATFORM, sessionId)
  }
  const latest = storage.getLatestOAuthPending(PLATFORM, 0)
  if (latest && latest.sessionId) {
    return storage.clearOAuthPending(PLATFORM, latest.sessionId)
  }
  return true
}

/**
 * 准备 OAuth 登录会话（手动回调模式）
 * @param {number} [port]
 * @returns {{success:boolean, session?:{sessionId:string,authUrl:string,redirectUri:string}, error?:string}}
 */
async function prepareOAuthSession (port) {
  try {
    storage.cleanupOAuthPending(PLATFORM, CODEX_OAUTH_SESSION_TTL_MS)
    _cleanupActiveOAuthSessions()
    const callbackPort = _resolveOAuthPort(port)
    const verifier = _randomBase64Url()
    const challenge = _sha256Base64Url(verifier)
    const state = _randomBase64Url()
    const redirectUri = 'http://localhost:' + callbackPort + '/auth/callback'
    const authUrl = _buildCodexOAuthAuthorizeUrl({
      state,
      redirectUri,
      challenge
    })
    const sessionId = 'oauth-' + fileUtils.generateId()

    _cleanupExpiredOAuthSessions()
    const session = {
      sessionId,
      state,
      verifier,
      redirectUri,
      authUrl,
      createdAt: Date.now()
    }
    oauthSessions.set(sessionId, session)
    const startRes = await _startOAuthCallbackServer(session)
    if (!startRes.success) {
      oauthSessions.delete(sessionId)
      storage.clearOAuthPending(PLATFORM, sessionId)
      return { success: false, error: startRes.error || '启动本地回调监听失败' }
    }
    _saveOAuthSession(session)

    return {
      success: true,
      session: {
        sessionId,
        authUrl,
        redirectUri
      }
    }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

/**
 * 取消 OAuth 会话
 * @param {string} sessionId
 * @returns {{success:boolean}}
 */
function cancelOAuthSession (sessionId) {
  if (!sessionId) {
    return { success: true }
  }
  const session = oauthSessions.get(sessionId)
  _closeOAuthSessionServer(session)
  oauthSessions.delete(sessionId)
  storage.clearOAuthPending(PLATFORM, sessionId)
  return { success: true }
}

/**
 * 完成 OAuth 会话：校验回调 + code 换 token + 入库
 * @param {string} sessionId
 * @param {string} callbackUrl
 * @returns {Promise<{success:boolean, account?:object, error?:string}>}
 */
async function completeOAuthSession (sessionId, callbackUrl) {
  const sid = (sessionId || '').trim()
  if (!sid) {
    return { success: false, error: '缺少 OAuth 会话 ID' }
  }
  _cleanupExpiredOAuthSessions()
  const session = oauthSessions.get(sid) || _loadOAuthSession(sid)
  if (!session) {
    return { success: false, error: 'OAuth 会话不存在或已过期，请重新生成授权链接' }
  }

  const callback = (callbackUrl || '').trim() || (session.callbackUrl || '').trim()
  if (!callback) {
    return { success: false, error: '尚未收到浏览器回调，请稍后重试或手动粘贴回调地址' }
  }

  const validationError = _validateManualCallback(callback, session.redirectUri, session.state)
  if (validationError) {
    return { success: false, error: validationError }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(callback)
  } catch {
    return { success: false, error: '回调地址格式不正确，请粘贴浏览器地址栏完整 URL' }
  }

  const code = parsedUrl.searchParams.get('code')
  if (!code) {
    return { success: false, error: '回调地址缺少 code 参数' }
  }

  const exchanged = await _exchangeCodeForTokens(code, session.verifier, session.redirectUri)
  if (!exchanged.ok) {
    return { success: false, error: exchanged.error || 'Token 交换失败' }
  }

  _closeOAuthSessionServer(session)
  oauthSessions.delete(sid)
  storage.clearOAuthPending(PLATFORM, sid)
  const profile = await _fetchCodexProfile(exchanged.tokens.access_token, exchanged.tokens.id_token)
  const draft = _createCodexAccountFromTokens(exchanged.tokens, 'oauth')
  if (profile.email) draft.email = profile.email
  if (profile.planType) draft.plan_type = profile.planType
  if (profile.accountId) draft.account_id = profile.accountId
  if (profile.organizationId) draft.organization_id = profile.organizationId
  if (profile.accountName) draft.account_name = profile.accountName
  if (profile.accountStructure) draft.account_structure = profile.accountStructure
  if (profile.workspace) draft.workspace = profile.workspace
  _stampPluginAddedMeta(draft, 'oauth')
  let account = storage.addAccount(PLATFORM, draft)

  // OAuth 添加成功后立即刷新配额，确保列表立刻展示最新额度
  let quotaRefreshError = ''
  try {
    if (account && account.id) {
      const quotaResult = await _refreshCodexQuotaAsync(account, account.id)
      if (!quotaResult || !quotaResult.success) {
        quotaRefreshError = (quotaResult && quotaResult.error) || '首次刷新配额失败'
      }
      account = storage.getAccount(PLATFORM, account.id) || account
    }
  } catch (err) {
    quotaRefreshError = err && err.message ? err.message : '首次刷新配额失败'
  }

  return {
    success: true,
    account,
    quotaRefreshError: quotaRefreshError || null
  }
}

/**
 * 查询 OAuth 会话状态（用于前端自动轮询回调）
 * @param {string} sessionId
 * @returns {{success:boolean,status:string,error?:string,callbackUrl?:string}}
 */
function getOAuthSessionStatus (sessionId) {
  const sid = (sessionId || '').trim()
  if (!sid) {
    return { success: false, status: 'missing', error: '缺少 OAuth 会话 ID' }
  }
  _cleanupExpiredOAuthSessions()
  let session = oauthSessions.get(sid)
  if (!session) {
    session = _loadOAuthSession(sid)
  }
  if (!session) {
    return { success: false, status: 'missing', error: 'OAuth 会话不存在或已过期' }
  }
  if (!session.callbackUrl && !session.server) {
    _startOAuthCallbackServer(session).then(function (res) {
      if (!res || !res.success) return
      _saveOAuthSession(session)
    }).catch(function () {})
  }
  if (session.callbackUrl) {
    return {
      success: true,
      status: 'completed',
      callbackUrl: session.callbackUrl
    }
  }
  return {
    success: true,
    status: 'pending'
  }
}

/**
 * 在系统浏览器打开 URL
 * @param {string} rawUrl
 * @returns {{success:boolean, error?:string}}
 */
function openExternalUrl (rawUrl) {
  const val = (rawUrl || '').trim()
  if (!val) return { success: false, error: '链接为空' }

  let parsed
  try {
    parsed = new URL(val)
  } catch {
    return { success: false, error: '链接格式不正确' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { success: false, error: '仅支持 http/https 链接' }
  }

  try {
    if (process.platform === 'darwin') {
      cp.spawn('open', [val], { detached: true, stdio: 'ignore' }).unref()
      return { success: true }
    }
    if (process.platform === 'win32') {
      cp.spawn('cmd', ['/c', 'start', '', val], { detached: true, stdio: 'ignore' }).unref()
      return { success: true }
    }
    if (process.platform === 'linux') {
      cp.spawn('xdg-open', [val], { detached: true, stdio: 'ignore' }).unref()
      return { success: true }
    }
    return { success: false, error: '当前系统不支持自动打开浏览器' }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

/**
 * 探测 Codex App 路径
 * @param {string} [customPath]
 * @returns {string}
 */
function detectCodexAppPath (customPath, runtime) {
  const custom = (customPath || '').trim()
  if (custom && fs.existsSync(custom)) {
    return custom
  }

  const candidates = getCodexAppPathCandidates(runtime)
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      return candidates[i]
    }
  }
  return ''
}

/**
 * 探测 OpenCode 路径
 * @param {string} [customPath]
 * @returns {string}
 */
function detectOpenCodeAppPath (customPath, runtime) {
  const custom = (customPath || '').trim()
  if (custom && fs.existsSync(custom)) {
    return custom
  }

  const candidates = getOpenCodeAppPathCandidates(runtime)
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
  const accounts = storage.listAccounts(PLATFORM)
  let changed = false

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]
    if (!account || !account.id) continue

    const updates = {}
    const cleanedTags = _stripAutoSourceTags(account.tags)
    if (!_sameTagList(account.tags, cleanedTags)) {
      updates.tags = cleanedTags
    }

    const via = _inferCodexAddedVia(account)
    if (!String(account.added_via || '').trim() && via) {
      updates.added_via = via
    }

    const addedAt = Number(account.added_at || 0)
    const createdAt = Number(account.created_at || 0)
    if (!(addedAt > 0) && createdAt > 0) {
      updates.added_at = createdAt
    }

    if (Object.keys(updates).length > 0) {
      storage.updateAccount(PLATFORM, account.id, updates)
      changed = true
    }
  }

  return changed ? storage.listAccounts(PLATFORM) : accounts
}

/**
 * 获取当前激活账号
 * @returns {object|null}
 */
function getCurrent () {
  return storage.getCurrentAccount(PLATFORM)
}

function getLocalImportStatus () {
  try {
    const local = fileUtils.readJsonFile(getAuthFilePath())
    if (!local || typeof local !== 'object') {
      return { success: true, hasLocalState: false, imported: false, matchedId: null, email: '', account: null }
    }

    const nested = (local.tokens && typeof local.tokens === 'object') ? local.tokens : {}
    const tokens = {
      id_token: nested.id_token || local.id_token || '',
      access_token: nested.access_token || local.token || local.access_token || '',
      refresh_token: nested.refresh_token || local.refresh_token || ''
    }
    const hasLocalState = !!_firstNonEmptyString(tokens.id_token, tokens.access_token, tokens.refresh_token)
    if (!hasLocalState) {
      return { success: true, hasLocalState: false, imported: false, matchedId: null, email: '', account: null }
    }

    const accounts = storage.listAccounts(PLATFORM)
    const matched = _findCodexAccountByLocalTokens(accounts, tokens)
    const email = String(extractEmailFromJwt(tokens.id_token || tokens.access_token) || '').trim().toLowerCase()

    return {
      success: true,
      hasLocalState: true,
      imported: !!matched,
      matchedId: matched ? matched.id : null,
      email: email || (matched && matched.email) || '',
      account: matched || null
    }
  } catch (err) {
    return {
      success: false,
      hasLocalState: false,
      imported: false,
      matchedId: null,
      email: '',
      account: null,
      error: err.message || String(err)
    }
  }
}

async function syncCurrentFromLocal (options) {
  try {
    const allowAutoImport = !options || options.autoImport !== false
    const local = fileUtils.readJsonFile(getAuthFilePath())
    const previousId = storage.getCurrentId(PLATFORM)
    if (!local || typeof local !== 'object') {
      if (previousId) {
        storage.clearCurrentId(PLATFORM)
        return { success: true, changed: true, currentId: null }
      }
      return { success: true, changed: false, currentId: null }
    }

    const nested = (local.tokens && typeof local.tokens === 'object') ? local.tokens : {}
    const tokens = {
      id_token: nested.id_token || local.id_token || '',
      access_token: nested.access_token || local.token || local.access_token || '',
      refresh_token: nested.refresh_token || local.refresh_token || ''
    }
    const hasLocalState = !!_firstNonEmptyString(tokens.id_token, tokens.access_token, tokens.refresh_token)
    if (!hasLocalState) {
      if (previousId) {
        storage.clearCurrentId(PLATFORM)
        return { success: true, changed: true, currentId: null, account: null }
      }
      return { success: true, changed: false, currentId: null, account: null }
    }

    let accounts = storage.listAccounts(PLATFORM)
    let matched = _findCodexAccountByLocalTokens(accounts, tokens)
    let importedAny = false

    if (!matched && allowAutoImport) {
      const fingerprint = _buildCodexLocalFingerprint(tokens)
      if (_shouldTryAutoImportByFingerprint(fingerprint)) {
        const imported = await importFromLocal()
        importedAny = _countImportedCodex(imported && imported.imported) > 0
        if (importedAny) {
          accounts = storage.listAccounts(PLATFORM)
          matched = _findCodexAccountByLocalTokens(accounts, tokens)
        }
      }
    }

    const nextId = matched ? matched.id : null
    if (nextId && previousId !== nextId) {
      storage.setCurrentId(PLATFORM, nextId)
      return { success: true, changed: true, currentId: nextId, account: matched }
    }
    if (!nextId && previousId) {
      storage.clearCurrentId(PLATFORM)
      return { success: true, changed: true, currentId: null }
    }

    return {
      success: true,
      changed: !!importedAny,
      currentId: previousId || nextId || null,
      account: matched || null
    }
  } catch (err) {
    return { success: false, changed: false, error: err.message || String(err) }
  }
}

/**
 * 从本地导入 Codex 账号
 * - ~/.codex/auth.json（当前登录）
 * @returns {object} { imported: object|Array|null, error: string|null }
 */
function importFromLocal () {
  return _importFromLocalAsync()
}

async function _importFromLocalAsync () {
  const imported = []
  const seen = new Set()
  const warnings = []

  function pushImported (account) {
    if (!account || !account.id) return
    _stampPluginAddedMeta(account, 'local')
    const saved = storage.addAccount(PLATFORM, account)
    const key = (saved && saved.id) ? saved.id : account.id
    if (!key || seen.has(key)) return
    seen.add(key)
    imported.push(saved || account)
  }

  // 1) 兼容新版 ~/.codex/auth.json（token 字段或 tokens 嵌套）
  const authFile = getAuthFilePath()
  const data = fileUtils.readJsonFile(authFile)
  if (data && typeof data === 'object') {
    const nested = (data.tokens && typeof data.tokens === 'object') ? data.tokens : {}
    let accessToken = nested.access_token || data.token || data.access_token || ''
    let refreshToken = nested.refresh_token || data.refresh_token || ''
    let idToken = nested.id_token || data.id_token || ''

    if (refreshToken) {
      const refreshed = await _refreshCodexToken(refreshToken)
      if (refreshed && refreshed.ok) {
        accessToken = refreshed.access_token || accessToken
        idToken = refreshed.id_token || idToken
        refreshToken = refreshed.refresh_token || refreshToken
      } else if (!accessToken) {
        return { imported: null, error: '刷新本地凭证失败: ' + ((refreshed && refreshed.error) || '未知错误') }
      } else if (refreshed && refreshed.error) {
        warnings.push('刷新 access_token 失败，已使用本地 access_token 继续导入: ' + refreshed.error)
      }
    }

    if (accessToken || refreshToken) {
      const profile = await _fetchCodexProfile(accessToken, idToken)
      const account = normalizeAccount({
        id: data.id,
        email: profile.email || data.email || extractEmailFromJwt(idToken || accessToken) || 'local@codex',
        user_id: profile.userId || data.user_id || '',
        auth_mode: data.auth_mode || 'oauth',
        plan_type: profile.planType || data.plan_type || '',
        account_id: profile.accountId || data.account_id || '',
        organization_id: profile.organizationId || data.organization_id || '',
        account_name: profile.accountName || data.account_name || '',
        account_structure: profile.accountStructure || data.account_structure || '',
        workspace: profile.workspace || data.workspace || '',
        tokens: {
          id_token: idToken,
          access_token: accessToken,
          refresh_token: refreshToken
        },
        created_at: data.created_at || Date.now(),
        last_used: data.last_used || 0
      })
      if (account) pushImported(account)
    }
  }

  if (imported.length === 0) {
    return { imported: null, error: '未找到有效的 Codex 账号数据' }
  }
  const first = imported[0]
  if (first && first.id) {
    storage.setCurrentId(PLATFORM, first.id)
    try {
      await _refreshCodexQuotaAsync(first, first.id)
    } catch {}
  }
  if (imported.length === 1) {
    return {
      imported: imported[0],
      error: null,
      warning: warnings.length > 0 ? warnings.join('；') : null
    }
  }
  return {
    imported: imported,
    error: null,
    warning: warnings.length > 0 ? warnings.join('；') : null
  }
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
        _stampPluginAddedMeta(account, 'json', { override: true })
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
async function addWithToken (idToken, accessToken, refreshToken) {
  let nextIdToken = idToken || ''
  let nextAccessToken = accessToken || ''
  let nextRefreshToken = refreshToken || ''

  if (nextRefreshToken) {
    const refreshed = await _refreshCodexToken(nextRefreshToken)
    if (refreshed && refreshed.ok) {
      nextAccessToken = refreshed.access_token || nextAccessToken
      nextIdToken = refreshed.id_token || nextIdToken
      nextRefreshToken = refreshed.refresh_token || nextRefreshToken
    } else if (!nextAccessToken) {
      throw new Error('refresh_token 换取 access_token 失败')
    }
  }

  const profile = await _fetchCodexProfile(nextAccessToken, nextIdToken)
  const account = _createCodexAccountFromTokens({
    id_token: nextIdToken,
    access_token: nextAccessToken,
    refresh_token: nextRefreshToken
  }, 'token', 'token')
  if (profile.email) account.email = profile.email
  if (profile.planType) account.plan_type = profile.planType
  if (profile.accountId) account.account_id = profile.accountId
  if (profile.organizationId) account.organization_id = profile.organizationId
  if (profile.accountName) account.account_name = profile.accountName
  if (profile.accountStructure) account.account_structure = profile.accountStructure
  if (profile.workspace) account.workspace = profile.workspace
  _stampPluginAddedMeta(account, 'token')
  const saved = storage.addAccount(PLATFORM, account)
  if (saved && saved.id) {
    try {
      await _refreshCodexQuotaAsync(saved, saved.id)
    } catch {}
  }
  return saved || account
}

/**
 * 切换 Codex 账号：写入 ~/.codex/auth.json
 * @param {string} accountId
 * @param {object} [options]
 * @returns {object} { success: boolean, error: string|null, warnings?: string[] }
 */
async function switchAccount (accountId, options) {
  let account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    requestLogger.warn('codex.switch', '切号失败：账号不存在', { accountId })
    return { success: false, error: '账号不存在' }
  }
  requestLogger.info('codex.switch', '开始切换账号', {
    account: account.email || account.id
  })

  const prepared = await _prepareCodexAccountForSwitch(accountId, account)
  if (!prepared.success) {
    requestLogger.warn('codex.switch', '切号失败：准备注入账号失败', {
      account: account.email || account.id,
      error: prepared.error
    })
    return { success: false, error: prepared.error || '准备账号失败' }
  }
  account = prepared.account
  const authData = _buildCodexAuthFile(account)

  const configDir = getConfigDir()
  fileUtils.ensureDir(configDir)

  const written = fileUtils.writeJsonFile(getAuthFilePath(), authData)
  if (!written) {
    requestLogger.warn('codex.switch', '切号失败：写入 auth.json 失败', {
      account: account.email || account.id
    })
    return { success: false, error: '写入 auth.json 失败' }
  }

  storage.updateAccount(PLATFORM, accountId, { last_used: Date.now() })
  storage.setCurrentId(PLATFORM, accountId)

  const settings = _resolveAdvancedSettings(options)
  const keychainWarning = _writeCodexKeychain(configDir, authData)
  const warnings = []
  if (keychainWarning) {
    warnings.push(keychainWarning)
  }
  warnings.push(..._applySwitchIntegrations(account, settings))
  requestLogger.info('codex.switch', '切号成功', {
    account: account.email || account.id,
    warnings
  })
  return {
    success: true,
    error: null,
    warnings: warnings
  }
}

async function _prepareCodexAccountForSwitch (accountId, account) {
  if (!account || typeof account !== 'object') {
    return { success: false, error: '账号不存在', account: null }
  }
  const tokens = (account.tokens && typeof account.tokens === 'object') ? account.tokens : {}
  const accessToken = String(tokens.access_token || '').trim()
  const refreshToken = String(tokens.refresh_token || '').trim()
  if (!accessToken || !_isCodexTokenExpired(accessToken)) {
    return { success: true, error: null, account }
  }
  if (!refreshToken) {
    return { success: false, error: 'Token 已过期且缺少 refresh_token，请重新登录', account: null }
  }

  const refreshed = await _refreshCodexToken(refreshToken, {
    account: account.email || account.id,
    source: 'switch-account'
  })
  if (!refreshed.ok) {
    return {
      success: false,
      error: 'Token 已过期且刷新失败: ' + refreshed.error,
      account: null
    }
  }

  const nextTokens = Object.assign({}, tokens, {
    access_token: refreshed.access_token,
    id_token: refreshed.id_token || tokens.id_token || '',
    refresh_token: refreshed.refresh_token || refreshToken,
    account_id: _firstNonEmptyString(
      tokens.account_id,
      _extractChatGptAccountId(refreshed.access_token),
      _extractChatGptAccountId(refreshed.id_token),
      _extractChatGptAccountId(tokens.id_token)
    ) || ''
  })
  storage.updateAccount(PLATFORM, accountId, { tokens: nextTokens })
  const latest = storage.getAccount(PLATFORM, accountId)
  return { success: true, error: null, account: latest || Object.assign({}, account, { tokens: nextTokens }) }
}

function _buildCodexAuthFile (account) {
  const tokens = (account && account.tokens && typeof account.tokens === 'object') ? account.tokens : {}
  const accessToken = String(tokens.access_token || '').trim()
  const refreshToken = String(tokens.refresh_token || '').trim()
  const idToken = String(tokens.id_token || '').trim()
  const accountId = _firstNonEmptyString(
    account && account.account_id,
    tokens.account_id,
    _extractChatGptAccountId(accessToken),
    _extractChatGptAccountId(idToken)
  )

  const existing = fileUtils.readJsonFile(getAuthFilePath())
  const baseUrl = existing && typeof existing === 'object' ? existing.base_url : undefined

  const payload = {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: accountId || ''
    },
    last_refresh: new Date().toISOString()
  }

  if (typeof baseUrl === 'string' && baseUrl.trim()) {
    payload.base_url = baseUrl.trim()
  }

  return payload
}

function _buildCodexKeychainAccount (baseDir) {
  try {
    const resolved = fs.realpathSync.native(baseDir)
    const digest = crypto.createHash('sha256').update(String(resolved)).digest('hex')
    return 'cli|' + digest.slice(0, 16)
  } catch {
    const digest = crypto.createHash('sha256').update(String(baseDir || '')).digest('hex')
    return 'cli|' + digest.slice(0, 16)
  }
}

function _writeCodexKeychain (baseDir, authData) {
  if (process.platform !== 'darwin') return ''
  try {
    const account = _buildCodexKeychainAccount(baseDir)
    cp.execFileSync('security', [
      'add-generic-password',
      '-U',
      '-s',
      'Codex Auth',
      '-a',
      account,
      '-w',
      JSON.stringify(authData)
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    return ''
  } catch (err) {
    return 'Codex keychain 同步失败: ' + (err && err.message ? err.message : String(err))
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
    requestLogger.warn('codex.quota', '刷新配额失败：账号不存在', { accountId })
    return { success: false, quota: null, error: '账号不存在' }
  }
  requestLogger.info('codex.quota', '开始刷新配额', {
    account: account.email || account.id
  })
  return _refreshCodexQuotaAsync(account, accountId)
}

function refreshQuotaOrUsage (accountId) {
  return refreshQuota(accountId)
}

async function activateAccount (accountId, options) {
  const result = await switchAccount(accountId, options)
  return {
    success: !!result?.success,
    error: result?.error || null,
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    stage: result?.stage || '',
    changed: !!result?.success
  }
}

async function refreshToken (accountId) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    requestLogger.warn('codex.token', '刷新失败：账号不存在', { accountId })
    return { success: false, error: '账号不存在' }
  }

  const tokens = (account.tokens && typeof account.tokens === 'object') ? account.tokens : {}
  const accessToken = String(tokens.access_token || '').trim()
  const refreshTokenValue = String(tokens.refresh_token || '').trim()
  const expiresAtMs = _decodeTokenExpMs(accessToken)
  const shouldRefresh = !accessToken || (expiresAtMs && expiresAtMs <= Date.now() + (10 * 60 * 1000))

  if (!shouldRefresh) {
    return { success: true, refreshed: false, error: null, message: 'Token 仍然有效' }
  }
  if (!refreshTokenValue) {
    requestLogger.warn('codex.token', '刷新失败：缺少 refresh_token', {
      account: account.email || account.id
    })
    return { success: false, error: '缺少 refresh_token，无法刷新 Token' }
  }

  const refreshed = await _refreshCodexToken(refreshTokenValue, {
    account: account.email || account.id,
    source: 'token-refresh'
  })
  if (!refreshed.ok) {
    requestLogger.warn('codex.token', '刷新失败：Token 刷新失败', {
      account: account.email || account.id,
      error: refreshed.error || '未知错误'
    })
    return {
      success: false,
      error: 'Token 刷新失败: ' + (refreshed.error || '未知错误')
    }
  }

  const nextTokens = Object.assign({}, tokens, {
    access_token: refreshed.access_token,
    id_token: refreshed.id_token || tokens.id_token || '',
    refresh_token: refreshed.refresh_token || refreshTokenValue,
    account_id: _firstNonEmptyString(
      tokens.account_id,
      _extractChatGptAccountId(refreshed.access_token),
      _extractChatGptAccountId(refreshed.id_token),
      _extractChatGptAccountId(tokens.id_token)
    ) || ''
  })
  const accountIdValue = _firstNonEmptyString(account.account_id, nextTokens.account_id) || ''
  storage.updateAccount(PLATFORM, accountId, {
    tokens: nextTokens,
    account_id: accountIdValue,
    last_used: Date.now()
  })
  requestLogger.info('codex.token', '刷新 Token 成功', {
    account: account.email || account.id
  })
  return {
    success: true,
    refreshed: true,
    error: null,
    message: 'Token 刷新成功'
  }
}

async function _refreshCodexQuotaAsync (account, accountId) {
  const http = require('./httpClient')
  const tokens = account.tokens || {}

  try {
    // 1. 检查并刷新 token
    let accessToken = tokens.access_token
    let idToken = tokens.id_token || ''
    if (_isCodexTokenExpired(accessToken)) {
      if (!tokens.refresh_token) {
        const quotaError = _extractCodexQuotaError(401, 'Token 已过期且无 refresh_token')
        _persistCodexQuotaError(accountId, quotaError)
        requestLogger.warn('codex.quota', '刷新配额失败：Token 已过期且无 refresh_token', {
          account: account.email || account.id
        })
        return { success: false, quota: null, error: quotaError.message }
      }
      const refreshed = await _refreshCodexToken(tokens.refresh_token, {
        account: account.email || account.id,
        source: 'quota-refresh'
      })
      if (!refreshed.ok) {
        const quotaError = _extractCodexQuotaError(401, '刷新 Token 失败: ' + refreshed.error)
        _persistCodexQuotaError(accountId, quotaError)
        requestLogger.warn('codex.quota', '刷新配额失败：刷新 Token 失败', {
          account: account.email || account.id,
          error: refreshed.error
        })
        return { success: false, quota: null, error: quotaError.message }
      }
      accessToken = refreshed.access_token
      idToken = refreshed.id_token || idToken
      const newTokens = Object.assign({}, tokens, {
        access_token: refreshed.access_token,
        id_token: idToken,
        refresh_token: refreshed.refresh_token || tokens.refresh_token
      })
      storage.updateAccount(PLATFORM, accountId, { tokens: newTokens })
    }
    if (!accessToken) {
      const quotaError = _extractCodexQuotaError(401, 'access_token 为空，无法查询配额')
      _persistCodexQuotaError(accountId, quotaError)
      return { success: false, quota: null, error: quotaError.message }
    }

    // 2. 提取 ChatGPT-Account-Id（优先已保存账号标识，其次 JWT claim）
    const accId =
      _firstNonEmptyString(
        account.account_id,
        tokens.account_id,
        _extractChatGptAccountId(accessToken),
        _extractChatGptAccountId(tokens.id_token)
      ) || null
    const headers = { Authorization: 'Bearer ' + accessToken }
    if (accId) {
      headers['ChatGPT-Account-Id'] = accId
    }

    // 3. 调用 wham/usage API
    const res = await http.getJSON(CODEX_USAGE_URL, headers)
    if (!res.ok) {
      const quotaError = _extractCodexQuotaError(res.status, res.raw)
      _persistCodexQuotaError(accountId, quotaError)
      return {
        success: false,
        quota: null,
        error: quotaError.message
      }
    }

    // 4. 解析配额
    const quota = _parseCodexQuota(res.data)
    const planType = (res.data && res.data.plan_type) || account.plan_type
    const cleanQuota = Object.assign({}, quota, {
      error: null,
      error_code: '',
      invalid: false
    })
    const nextPatch = {
      quota: cleanQuota,
      plan_type: planType,
      invalid: false,
      quota_error: null
    }
    if (_shouldHydrateCodexProfile(account, planType)) {
      try {
        const profile = await _fetchCodexProfile(accessToken, idToken)
        if (profile && typeof profile === 'object') {
          if (profile.email) nextPatch.email = profile.email
          if (profile.userId) nextPatch.user_id = profile.userId
          if (profile.planType) nextPatch.plan_type = profile.planType
          if (profile.accountId) nextPatch.account_id = profile.accountId
          if (profile.organizationId) nextPatch.organization_id = profile.organizationId
          if (profile.accountName) nextPatch.account_name = profile.accountName
          if (profile.accountStructure) nextPatch.account_structure = profile.accountStructure
          if (profile.workspace) nextPatch.workspace = profile.workspace
        }
      } catch {}
    }
    storage.updateAccount(PLATFORM, accountId, nextPatch)
    requestLogger.info('codex.quota', '刷新配额成功', {
      account: account.email || account.id,
      planType: nextPatch.plan_type || ''
    })

    return { success: true, quota: cleanQuota, error: null }
  } catch (err) {
    const quotaError = _extractCodexQuotaError(0, err && err.message ? err.message : String(err))
    _persistCodexQuotaError(accountId, quotaError)
    requestLogger.error('codex.quota', '刷新配额异常', {
      account: account.email || account.id,
      error: quotaError.message
    })
    return { success: false, quota: null, error: quotaError.message }
  }
}

function _extractCodexQuotaError (status, raw) {
  const shortRaw = String(raw || '').slice(0, 300)
  let code = ''
  let detailMessage = ''

  try {
    const payload = JSON.parse(String(raw || '{}'))
    const detail = payload && payload.detail
    if (detail && typeof detail === 'object') {
      if (typeof detail.code === 'string') code = detail.code
      if (typeof detail.message === 'string') detailMessage = detail.message
    } else if (typeof detail === 'string') {
      detailMessage = detail
    }
    if (!code && typeof payload.code === 'string') code = payload.code
    if (!detailMessage && typeof payload.message === 'string') detailMessage = payload.message
    if (!detailMessage && typeof payload.error === 'string') detailMessage = payload.error
  } catch {}

  const hasCode = typeof code === 'string' && code.trim().length > 0
  const base = status > 0 ? ('API 返回 ' + status) : '配额刷新失败'
  const message = hasCode
    ? (base + ' [error_code:' + code.trim() + '] - ' + (detailMessage || shortRaw || '未知错误'))
    : (base + ' - ' + (detailMessage || shortRaw || '未知错误'))

  const normalizedCode = String(code || '').trim().toLowerCase()
  const lowerMsg = String(message || '').toLowerCase()
  const disabled = (
    normalizedCode === 'deactivated_workspace' ||
    lowerMsg.includes('deactivated_workspace') ||
    lowerMsg.includes('api 返回 402') ||
    lowerMsg.includes('api returned 402')
  )

  return {
    status: Number(status || 0),
    code: hasCode ? code.trim() : '',
    message: message,
    disabled: disabled
  }
}

function _persistCodexQuotaError (accountId, quotaError) {
  if (!accountId || !quotaError || typeof quotaError !== 'object') return

  const existing = storage.getAccount(PLATFORM, accountId) || {}
  const currentQuota = (existing.quota && typeof existing.quota === 'object')
    ? existing.quota
    : {}
  const nowSec = Math.floor(Date.now() / 1000)
  const nextQuota = Object.assign({}, currentQuota, {
    error: quotaError.message || '配额刷新失败',
    error_code: quotaError.code || '',
    invalid: Boolean(quotaError.disabled),
    updated_at: nowSec
  })

  storage.updateAccount(PLATFORM, accountId, {
    quota: nextQuota,
    invalid: Boolean(quotaError.disabled),
    quota_error: {
      status: Number(quotaError.status || 0),
      code: quotaError.code || '',
      message: quotaError.message || '配额刷新失败',
      disabled: Boolean(quotaError.disabled),
      timestamp: nowSec
    }
  })
}

/** 刷新 Codex access_token */
async function _refreshCodexToken (refreshToken, context = {}) {
  const http = require('./httpClient')
  requestLogger.info('codex.token', '开始刷新 Token', context)
  const res = await http.postForm(CODEX_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CODEX_CLIENT_ID
  })
  if (!res.ok || !res.data || !res.data.access_token) {
    requestLogger.warn('codex.token', '刷新 Token 失败', {
      ...context,
      error: (res.raw || '').slice(0, 200)
    })
    return { ok: false, error: (res.raw || '').slice(0, 200) }
  }
  requestLogger.info('codex.token', '刷新 Token 成功', context)
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
    // 优先读取 OpenAI 自定义 claim，兼容 account_id/chatgpt_account_id/workspace_id
    const authClaim = data['https://api.openai.com/auth'] || {}
    return _firstNonEmptyString(
      authClaim.chatgpt_account_id,
      authClaim.account_id,
      authClaim.workspace_id,
      data.chatgpt_account_id,
      data.account_id,
      data.workspace_id
    ) || null
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
  const codeReviewRateLimit = (data && (
    data.code_review_rate_limit ||
    data.codeReviewRateLimit ||
    data.code_review ||
    (data.rate_limit && (
      data.rate_limit.code_review_rate_limit ||
      data.rate_limit.codeReviewRateLimit ||
      data.rate_limit.code_review
    ))
  )) || null
  const codeReviewWindow = _resolveCodeReviewWindow(codeReviewRateLimit)

  const hourlyRemaining = _resolveRemainingPercent(hourly)
  const weeklyRemaining = _resolveRemainingPercent(weekly)
  let codeReviewRemaining = _resolveRemainingPercent(codeReviewWindow)
  if (codeReviewRemaining === null) {
    // 兼容部分账号未返回独立 code review 窗口，回退到周配额
    codeReviewRemaining = weeklyRemaining
  }

  const hourlyReset = _normalizeResetTime(hourly)
  const weeklyReset = _normalizeResetTime(weekly)
  const codeReviewReset = _normalizeResetTime(codeReviewWindow) || weeklyReset
  const codeReviewRequestsLeft = _pickNumberField(codeReviewWindow, ['remaining', 'requests_left']) ?? _pickNumberField(weekly, ['remaining', 'requests_left'])
  const codeReviewRequestsLimit = _pickNumberField(codeReviewWindow, ['limit', 'requests_limit']) ?? _pickNumberField(weekly, ['limit', 'requests_limit'])

  return {
    hourly_percentage: hourlyRemaining,
    hourly_reset_time: hourlyReset,
    hourly_requests_left: _pickNumberField(hourly, ['remaining', 'requests_left']),
    hourly_requests_limit: _pickNumberField(hourly, ['limit', 'requests_limit']),
    weekly_percentage: weeklyRemaining,
    weekly_reset_time: weeklyReset,
    weekly_requests_left: _pickNumberField(weekly, ['remaining', 'requests_left']),
    weekly_requests_limit: _pickNumberField(weekly, ['limit', 'requests_limit']),
    code_review_percentage: codeReviewRemaining,
    code_review_reset_time: codeReviewReset,
    code_review_requests_left: codeReviewRequestsLeft,
    code_review_requests_limit: codeReviewRequestsLimit,
    code_review_window_present: Boolean(codeReviewWindow) || typeof codeReviewRemaining === 'number',
    updated_at: Math.floor(Date.now() / 1000)
  }
}

function _resolveCodeReviewWindow (rateLimit) {
  if (!rateLimit || typeof rateLimit !== 'object') return null
  if (_looksLikeQuotaWindow(rateLimit)) {
    return rateLimit
  }
  const primary = rateLimit.primary_window || rateLimit.primaryWindow || null
  const secondary = rateLimit.secondary_window || rateLimit.secondaryWindow || null
  if (!primary && !secondary && Array.isArray(rateLimit.windows) && rateLimit.windows.length > 0) {
    const windows = rateLimit.windows.filter(function (item) {
      return item && typeof item === 'object'
    })
    if (windows.length === 1) return windows[0]
    if (windows.length >= 2) {
      const sorted = windows.slice().sort(function (left, right) {
        return _getWindowSeconds(left) - _getWindowSeconds(right)
      })
      return sorted[0]
    }
  }
  if (primary && secondary) {
    const primarySeconds = _getWindowSeconds(primary)
    const secondarySeconds = _getWindowSeconds(secondary)
    return primarySeconds <= secondarySeconds ? primary : secondary
  }
  return primary || secondary || null
}

function _resolveRemainingPercent (window) {
  if (!window || typeof window !== 'object') return null
  const usedPercent = _pickNumberField(window, ['used_percent', 'usedPercent'])
  if (typeof usedPercent === 'number') {
    return Math.max(0, Math.min(100, 100 - usedPercent))
  }
  const remainingPercent = _pickNumberField(window, ['remaining_percent', 'remainingPercent'])
  if (typeof remainingPercent === 'number') {
    return Math.max(0, Math.min(100, remainingPercent))
  }
  const remaining = _pickNumberField(window, ['remaining', 'requests_left'])
  const limit = _pickNumberField(window, ['limit', 'requests_limit'])
  if (typeof remaining === 'number' && typeof limit === 'number' && limit > 0) {
    return Math.max(0, Math.min(100, (remaining / limit) * 100))
  }
  return null
}

function _looksLikeQuotaWindow (window) {
  if (!window || typeof window !== 'object') return false
  return (
    _pickNumberField(window, ['used_percent', 'usedPercent']) !== null ||
    _pickNumberField(window, ['remaining_percent', 'remainingPercent']) !== null ||
    _pickNumberField(window, ['remaining', 'requests_left']) !== null ||
    _pickNumberField(window, ['limit', 'requests_limit']) !== null
  )
}

function _normalizeResetTime (window) {
  if (!window) return null
  const resetAt = _normalizeUnixSeconds(
    window.reset_at ||
    window.resetAt ||
    window.reset_time ||
    window.resetTime
  )
  if (typeof resetAt === 'number') return resetAt

  const resetAfterSeconds = _toFiniteNumber(
    window.reset_after_seconds ||
    window.resetAfterSeconds ||
    window.reset_after ||
    window.resetAfter
  )
  if (typeof resetAfterSeconds === 'number' && resetAfterSeconds >= 0) {
    return Math.floor(Date.now() / 1000) + Math.floor(resetAfterSeconds)
  }
  return null
}

function _buildCodexOAuthAuthorizeUrl (params) {
  const state = params.state
  const redirectUri = params.redirectUri
  const challenge = params.challenge
  return (
    CODEX_AUTH_URL +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(CODEX_CLIENT_ID) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&scope=' + encodeURIComponent(CODEX_OAUTH_SCOPES) +
    '&code_challenge=' + encodeURIComponent(challenge) +
    '&code_challenge_method=S256' +
    '&id_token_add_organizations=true' +
    '&codex_cli_simplified_flow=true' +
    '&state=' + encodeURIComponent(state) +
    '&originator=' + encodeURIComponent(CODEX_OAUTH_ORIGINATOR)
  )
}

function _resolveOAuthPort (port) {
  if (typeof port === 'number' && Number.isFinite(port) && port > 0 && port < 65536) {
    return Math.floor(port)
  }
  return CODEX_OAUTH_CALLBACK_PORT
}

function _cleanupExpiredOAuthSessions () {
  storage.cleanupOAuthPending(PLATFORM, CODEX_OAUTH_SESSION_TTL_MS)
  const now = Date.now()
  const entries = Array.from(oauthSessions.entries())
  for (let i = 0; i < entries.length; i++) {
    const pair = entries[i]
    const session = pair[1]
    if (!session || typeof session.createdAt !== 'number') {
      _closeOAuthSessionServer(session)
      oauthSessions.delete(pair[0])
      continue
    }
    if (now - session.createdAt > CODEX_OAUTH_SESSION_TTL_MS) {
      _closeOAuthSessionServer(session)
      oauthSessions.delete(pair[0])
    }
  }
}

function _cleanupActiveOAuthSessions () {
  const entries = Array.from(oauthSessions.entries())
  for (let i = 0; i < entries.length; i++) {
    const pair = entries[i]
    const sessionId = pair[0]
    const session = pair[1]
    _closeOAuthSessionServer(session)
    oauthSessions.delete(sessionId)
    storage.clearOAuthPending(PLATFORM, sessionId)
  }
}

function _startOAuthCallbackServer (session) {
  return new Promise((resolve) => {
    if (!session || !session.redirectUri) {
      resolve({ success: false, error: 'OAuth 会话无效，无法监听回调端口' })
      return
    }
    const port = Number(new URL(session.redirectUri).port || CODEX_OAUTH_CALLBACK_PORT)
    const expected = new URL(session.redirectUri)

    const server = require('node:http').createServer(function (req, res) {
      try {
        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        const reqUrl = req.url || '/'
        const url = new URL(reqUrl, session.redirectUri)
        if (url.pathname !== expected.pathname) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Not found')
          return
        }

        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Missing code')
          return
        }
        if (state !== session.state) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('State mismatch')
          return
        }

        session.callbackUrl = url.toString()
        session.completedAt = Date.now()
        _saveOAuthSession(session)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(_oauthCallbackSuccessHtml())

        setTimeout(function () {
          _closeOAuthSessionServer(session)
        }, 20)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('OAuth callback handling failed')
      }
    })

    // 使用重试机制监听端口，处理网络不稳定问题
    retryOAuthRequest(
      () => new Promise((resolveListen, rejectListen) => {
        server.once('error', function (err) {
          rejectListen(err)
        })

        // 不指定 host，兼容 localhost 在不同系统下的 IPv4/IPv6 解析策略
        server.listen(port, function () {
          session.server = server
          resolveListen()
        })
      }),
      {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 10000, // 10 秒最大延迟
        operationName: 'OAuth callback server listen',
        onRetry: (attempt, err, delayMs) => {
          requestLogger.info('codex.oauth', `启动 OAuth 回调服务器失败，正在重试 (${attempt}/5)`, {
            error: err.message,
            delayMs
          })
        }
      }
    ).then(() => {
      resolve({ success: true })
    }).catch((err) => {
      resolve({
        success: false,
        error: '回调端口监听失败：' + (err && err.message ? err.message : String(err))
      })
    })
  })
}


function _closeOAuthSessionServer (session) {
  if (!session || !session.server) return
  try {
    session.server.close()
  } catch {}
  session.server = null
}

function _oauthCallbackSuccessHtml () {
  return '<!doctype html><html><head><meta charset="utf-8"><title>Codex 授权成功</title>' +
    '<style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#0f172a;color:#e2e8f0;font:16px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,PingFang SC,Helvetica Neue,Arial,sans-serif}.card{padding:24px 28px;border:1px solid #334155;border-radius:12px;background:#111827}h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#94a3b8}</style>' +
    '</head><body><div class="card"><h1>授权完成</h1><p>你可以关闭此页面，返回 Aideck。</p></div></body></html>'
}

function _validateManualCallback (callbackUrl, redirectUri, expectedState) {
  const trimmed = (callbackUrl || '').trim()
  if (!trimmed) {
    return '请粘贴完整回调地址'
  }

  try {
    const url = new URL(trimmed)
    const expected = new URL(redirectUri)
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
      return '回调地址必须以 ' + redirectUri + ' 开头'
    }
    if (url.searchParams.get('state') !== expectedState) {
      return '回调地址 state 不匹配，请重新授权'
    }
    if (!url.searchParams.get('code')) {
      return '回调地址缺少 code 参数'
    }
    return ''
  } catch {
    return '请粘贴浏览器地址栏中的完整回调 URL'
  }
}

async function _exchangeCodeForTokens (code, verifier, redirectUri) {
  const http = require('./httpClient')
  try {
    const res = await http.postForm(CODEX_TOKEN_URL, {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      client_id: CODEX_CLIENT_ID,
      code_verifier: verifier
    })
    if (!res.ok || !res.data || !res.data.access_token) {
      return {
        ok: false,
        error: 'Token 交换失败: ' + ((res.raw || '').slice(0, 200) || ('HTTP ' + res.status))
      }
    }
    return {
      ok: true,
      tokens: {
        id_token: res.data.id_token || '',
        access_token: res.data.access_token || '',
        refresh_token: res.data.refresh_token || ''
      }
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

function _createCodexAccountFromTokens (tokens, addedVia, authMode) {
  const safeTokens = tokens || {}
  const idToken = safeTokens.id_token || ''
  const accessToken = safeTokens.access_token || ''
  const refreshToken = safeTokens.refresh_token || ''
  const idPayload = extractJwtPayload(idToken) || {}
  const accessPayload = extractJwtPayload(accessToken) || {}
  const idAuth = (idPayload && idPayload['https://api.openai.com/auth'] && typeof idPayload['https://api.openai.com/auth'] === 'object')
    ? idPayload['https://api.openai.com/auth']
    : {}
  const accessAuth = (accessPayload && accessPayload['https://api.openai.com/auth'] && typeof accessPayload['https://api.openai.com/auth'] === 'object')
    ? accessPayload['https://api.openai.com/auth']
    : {}
  const email = extractEmailFromJwt(idToken || accessToken) || 'unknown@codex'
  const accountId = _firstNonEmptyString(
    idAuth.chatgpt_account_id,
    idAuth.account_id,
    accessAuth.chatgpt_account_id,
    accessAuth.account_id,
    idPayload.account_id,
    accessPayload.account_id
  )
  const organizationId = _firstNonEmptyString(
    idAuth.organization_id,
    idAuth.chatgpt_organization_id,
    idAuth.chatgpt_org_id,
    idAuth.org_id,
    accessAuth.organization_id,
    accessAuth.chatgpt_organization_id,
    accessAuth.chatgpt_org_id,
    accessAuth.org_id
  )
  const workspace = _resolveWorkspaceTitleFromOrganizations(
    Array.isArray(idAuth.organizations) ? idAuth.organizations : [],
    organizationId
  )
  const normalizedAuthMode = String(authMode || 'oauth').trim().toLowerCase() || 'oauth'
  const normalizedAddedVia = String(addedVia || '').trim().toLowerCase()
  return {
    id: '',
    email: email,
    auth_mode: normalizedAuthMode,
    account_id: accountId,
    organization_id: organizationId,
    workspace: workspace || '',
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken
    },
    tags: [],
    added_via: normalizedAddedVia,
    added_at: Date.now(),
    created_at: Date.now(),
    last_used: 0
  }
}

async function _fetchCodexProfile (accessToken, idToken) {
  const access = String(accessToken || '').trim()
  const id = String(idToken || '').trim()
  const token = access || id
  if (!token) {
    return {
      email: '',
      userId: '',
      planType: '',
      accountId: '',
      organizationId: '',
      accountName: '',
      accountStructure: '',
      workspace: ''
    }
  }

  const idPayload = extractJwtPayload(id) || {}
  const accessPayload = extractJwtPayload(access) || {}
  const payload = Object.keys(idPayload).length > 0 ? idPayload : accessPayload
  const idAuthClaim = (idPayload && idPayload['https://api.openai.com/auth'] && typeof idPayload['https://api.openai.com/auth'] === 'object')
    ? idPayload['https://api.openai.com/auth']
    : {}
  const accessAuthClaim = (accessPayload && accessPayload['https://api.openai.com/auth'] && typeof accessPayload['https://api.openai.com/auth'] === 'object')
    ? accessPayload['https://api.openai.com/auth']
    : {}
  const authClaim = Object.keys(idAuthClaim).length > 0 ? idAuthClaim : accessAuthClaim
  const organizations = Array.isArray(authClaim.organizations) ? authClaim.organizations : []

  const profile = {
    email: String(payload.email || '').trim(),
    userId: _firstNonEmptyString(
      payload.sub,
      authClaim.chatgpt_user_id,
      authClaim.user_id
    ),
    planType: '',
    accountId: String(
      authClaim.chatgpt_account_id ||
      authClaim.account_id ||
      payload.account_id ||
      ''
    ).trim(),
    organizationId: String(
      authClaim.organization_id ||
      authClaim.chatgpt_organization_id ||
      authClaim.chatgpt_org_id ||
      authClaim.org_id ||
      ''
    ).trim(),
    accountName: '',
    accountStructure: '',
    workspace: ''
  }
  profile.workspace = _resolveWorkspaceTitleFromOrganizations(organizations, profile.organizationId)

  try {
    const http = require('./httpClient')
    const headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    }
    if (profile.accountId) {
      headers['ChatGPT-Account-Id'] = profile.accountId
    }
    const res = await http.getJSON('https://chatgpt.com/backend-api/wham/accounts/check', headers)
    if (res && res.ok && res.data && typeof res.data === 'object') {
      if (typeof res.data.plan_type === 'string' && res.data.plan_type.trim()) {
        profile.planType = res.data.plan_type.trim()
      }
      const accountProfile = _parseAccountProfileFromCheckResponse(res.data, {
        accountId: profile.accountId,
        organizationId: profile.organizationId
      })
      if (accountProfile.accountId) profile.accountId = accountProfile.accountId
      if (accountProfile.organizationId) profile.organizationId = accountProfile.organizationId
      if (accountProfile.accountName) profile.accountName = accountProfile.accountName
      if (accountProfile.accountStructure) profile.accountStructure = accountProfile.accountStructure
      if (accountProfile.accountName) {
        profile.workspace = accountProfile.accountName
      }
      if (!profile.workspace) {
        profile.workspace = _resolveWorkspaceTitleFromOrganizations(organizations, profile.organizationId)
      }
    }
  } catch {}

  return profile
}

function _parseAccountProfileFromCheckResponse (payload, hints) {
  const records = _collectAccountRecords(payload)
  if (records.length === 0) {
    return {
      accountId: '',
      organizationId: '',
      accountName: '',
      accountStructure: ''
    }
  }

  const hintAccountId = _firstNonEmptyString(hints && hints.accountId)
  const hintOrgId = _firstNonEmptyString(hints && hints.organizationId)
  const accountOrdering = payload && Array.isArray(payload.account_ordering)
    ? payload.account_ordering.map(function (item) { return _firstNonEmptyString(item) }).filter(Boolean)
    : []

  let selected = null
  if (hintAccountId) {
    selected = records.find(function (record) {
      const recordId = _extractAccountRecordField(record, ['id', 'account_id', 'chatgpt_account_id', 'workspace_id'])
      return recordId && recordId === hintAccountId
    }) || null
  }

  if (!selected && accountOrdering.length > 0) {
    for (let i = 0; i < accountOrdering.length; i++) {
      const orderingId = accountOrdering[i]
      selected = records.find(function (record) {
        const recordId = _extractAccountRecordField(record, ['id', 'account_id', 'chatgpt_account_id', 'workspace_id'])
        return recordId && recordId === orderingId
      }) || null
      if (selected) break
    }
  }

  if (!selected && hintOrgId) {
    selected = records.find(function (record) {
      const recordOrgId = _extractAccountRecordField(record, ['organization_id', 'org_id', 'workspace_id'])
      return recordOrgId && recordOrgId === hintOrgId
    }) || null
  }

  if (!selected) {
    selected = records[0]
  }

  return {
    accountId: _extractAccountRecordField(selected, ['id', 'account_id', 'chatgpt_account_id', 'workspace_id']),
    organizationId: _extractAccountRecordField(selected, ['organization_id', 'org_id', 'workspace_id']),
    accountName: _extractAccountRecordField(selected, ['name', 'display_name', 'account_name', 'organization_name', 'workspace_name', 'title']),
    accountStructure: _extractAccountRecordField(selected, ['structure', 'account_structure', 'kind', 'type', 'account_type'])
  }
}

function _collectAccountRecords (payload) {
  const records = []
  if (!payload || typeof payload !== 'object') return records

  const accounts = payload.accounts
  if (Array.isArray(accounts)) {
    for (let i = 0; i < accounts.length; i++) {
      const item = accounts[i]
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        records.push(item)
      }
    }
  } else if (accounts && typeof accounts === 'object') {
    const values = Object.values(accounts)
    for (let i = 0; i < values.length; i++) {
      const item = values[i]
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        records.push(item)
      }
    }
  }

  if (records.length === 0 && Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      const item = payload[i]
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        records.push(item)
      }
    }
  }

  return records
}

function _extractAccountRecordField (record, keys) {
  if (!record || typeof record !== 'object' || !Array.isArray(keys)) return ''
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const val = _firstNonEmptyString(record[key])
    if (val) return val
  }
  return ''
}

function _resolveWorkspaceTitleFromOrganizations (organizations, expectedOrgId) {
  if (!Array.isArray(organizations) || organizations.length === 0) return ''

  const expected = _firstNonEmptyString(expectedOrgId)
  let matched = ''
  let defaultTitle = ''
  let first = ''

  for (let i = 0; i < organizations.length; i++) {
    const item = organizations[i]
    if (!item || typeof item !== 'object') continue

    const orgId = _firstNonEmptyString(item.id, item.organization_id, item.workspace_id)
    const title = _firstNonEmptyString(item.title, item.name, item.display_name, item.workspace_name, item.organization_name, orgId)
    if (!title) continue

    if (!first) first = title
    if (!defaultTitle && item.is_default === true) defaultTitle = title
    if (!matched && expected && orgId && orgId === expected) matched = title
  }

  return matched || defaultTitle || first
}

function _randomBase64Url () {
  const base64 = crypto.randomBytes(32).toString('base64')
  return _toBase64Url(base64)
}

function _sha256Base64Url (value) {
  const base64 = crypto.createHash('sha256').update(value).digest('base64')
  return _toBase64Url(base64)
}

function _toBase64Url (base64) {
  return (base64 || '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
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

function _shouldHydrateCodexProfile (account, planType) {
  const acc = account || {}
  const structure = _firstNonEmptyString(acc.account_structure)
  const accountName = _firstNonEmptyString(acc.account_name)
  const organizationId = _firstNonEmptyString(acc.organization_id)
  const workspace = _firstNonEmptyString(acc.workspace)
  const currentPlan = _firstNonEmptyString(planType, acc.plan_type)
  const isTeamLike = _isCodexTeamLikePlan(currentPlan)

  if (!accountName) return true
  if (!structure) return true
  if (!organizationId && isTeamLike) return true
  if (!workspace) return true
  if (workspace === '个人' && isTeamLike) return true
  return false
}

function _findCodexAccountByLocalTokens (accounts, tokens) {
  const idToken = _firstNonEmptyString(tokens && tokens.id_token)
  const accessToken = _firstNonEmptyString(tokens && tokens.access_token)
  const refreshToken = _firstNonEmptyString(tokens && tokens.refresh_token)
  const accessPayload = extractJwtPayload(accessToken) || {}
  const idPayload = extractJwtPayload(idToken) || {}
  const accessAuth = accessPayload['https://api.openai.com/auth'] || {}
  const idAuth = idPayload['https://api.openai.com/auth'] || {}
  const email = _firstNonEmptyString(idPayload.email, accessPayload.email).toLowerCase()
  const accountId = _firstNonEmptyString(
    accessAuth.chatgpt_account_id,
    accessAuth.account_id,
    idAuth.chatgpt_account_id,
    idAuth.account_id,
    accessPayload.account_id,
    idPayload.account_id
  )
  const organizationId = _firstNonEmptyString(
    accessAuth.organization_id,
    accessAuth.chatgpt_organization_id,
    accessAuth.org_id,
    idAuth.organization_id,
    idAuth.chatgpt_organization_id,
    idAuth.org_id
  )

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i] || {}
    const accountTokens = (account.tokens && typeof account.tokens === 'object') ? account.tokens : {}
    if (refreshToken && accountTokens.refresh_token === refreshToken) return account
    if (accessToken && accountTokens.access_token === accessToken) return account
  }

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i] || {}
    if (!email || String(account.email || '').toLowerCase() !== email) continue
    const accountAccountId = _firstNonEmptyString(account.account_id)
    const accountOrgId = _firstNonEmptyString(account.organization_id)
    if (!accountId && !organizationId) return account
    if (accountId && !organizationId && accountAccountId === accountId) {
      return account
    }
    if (!accountId && organizationId && accountOrgId === organizationId) {
      return account
    }
    if (accountId && organizationId && accountAccountId === accountId && accountOrgId === organizationId) {
      return account
    }
  }

  return null
}

function _buildCodexLocalFingerprint (tokens) {
  const idToken = _firstNonEmptyString(tokens && tokens.id_token)
  const accessToken = _firstNonEmptyString(tokens && tokens.access_token)
  const refreshToken = _firstNonEmptyString(tokens && tokens.refresh_token)
  if (!idToken && !accessToken && !refreshToken) return ''

  const payload = extractJwtPayload(idToken || accessToken) || {}
  const auth = payload['https://api.openai.com/auth'] || {}
  const email = _firstNonEmptyString(payload.email)
  const accountId = _firstNonEmptyString(
    auth.chatgpt_account_id,
    auth.account_id,
    payload.account_id
  )
  const organizationId = _firstNonEmptyString(
    auth.organization_id,
    auth.chatgpt_organization_id,
    auth.org_id
  )
  const raw = [refreshToken, accessToken, email, accountId, organizationId].join('|')
  return crypto.createHash('sha1').update(raw).digest('hex')
}

function _shouldTryAutoImportByFingerprint (fingerprint) {
  if (!fingerprint) return false
  const now = Date.now()
  const shouldTry =
    localSyncState.lastFingerprint !== fingerprint ||
    (now - localSyncState.lastAttemptAt) >= LOCAL_SYNC_IMPORT_COOLDOWN_MS
  if (!shouldTry) return false

  localSyncState.lastFingerprint = fingerprint
  localSyncState.lastAttemptAt = now
  return true
}

function _countImportedCodex (imported) {
  if (Array.isArray(imported)) return imported.filter(Boolean).length
  if (imported && typeof imported === 'object') return 1
  return 0
}

function _isWeeklyWindow (window) {
  const sec = _getWindowSeconds(window)
  return sec >= 24 * 60 * 60
}

function _getWindowSeconds (window) {
  if (!window || typeof window !== 'object') return Number.MAX_SAFE_INTEGER
  const seconds = _toFiniteNumber(
    window.limit_window_seconds ||
    window.limitWindowSeconds ||
    window.window_seconds ||
    window.windowSeconds
  )
  if (typeof seconds === 'number' && seconds > 0) {
    return seconds
  }
  return Number.MAX_SAFE_INTEGER
}

function _pickNumberField (source, fields) {
  if (!source || !Array.isArray(fields)) return null
  for (let i = 0; i < fields.length; i++) {
    const val = _toFiniteNumber(source[fields[i]])
    if (typeof val === 'number') return val
  }
  return null
}

function _normalizeUnixSeconds (value) {
  const raw = _toFiniteNumber(value)
  if (typeof raw !== 'number') return null
  if (raw > 1000000000000) return Math.floor(raw / 1000)
  if (raw > 10000000000) return Math.floor(raw / 1000)
  return Math.floor(raw)
}

function _toFiniteNumber (value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric
    return null
  }

  if (value && typeof value === 'object') {
    const candidates = [
      value.value,
      value.seconds,
      value.sec,
      value.timestamp,
      value.ts,
      value.unix,
      value.epoch,
      value.epoch_seconds,
      value.epochSeconds
    ]
    for (let i = 0; i < candidates.length; i++) {
      const parsed = _toFiniteNumber(candidates[i])
      if (typeof parsed === 'number') return parsed
    }
  }

  return null
}

function _firstNonEmptyString () {
  for (let i = 0; i < arguments.length; i++) {
    const val = arguments[i]
    if (typeof val !== 'string') continue
    const trimmed = val.trim()
    if (trimmed) return trimmed
  }
  return ''
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

function _isCodexTeamLikePlan (planType) {
  if (!planType || typeof planType !== 'string') return false
  const upper = planType.toUpperCase()
  return (
    upper.includes('TEAM') ||
    upper.includes('BUSINESS') ||
    upper.includes('ENTERPRISE') ||
    upper.includes('EDU')
  )
}

// ---- 内部工具函数 ----

/**
 * 从 JWT token 解析邮箱
 * @param {string} token
 * @returns {string|null}
 */
function extractJwtPayload (token) {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function extractEmailFromJwt (token) {
  const data = extractJwtPayload(token)
  if (!data) return null
  return data.email || data.sub || null
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

  const jwtData = extractJwtPayload(idToken || accessToken) || {}
  const authClaim = (jwtData && jwtData['https://api.openai.com/auth'] && typeof jwtData['https://api.openai.com/auth'] === 'object')
    ? jwtData['https://api.openai.com/auth']
    : {}
  const email = raw.email || jwtData.email || jwtData.sub || 'unknown@codex'
  const accountId = _firstNonEmptyString(
    raw.account_id,
    raw.accountId,
    tokens.account_id,
    tokens.accountId,
    authClaim.chatgpt_account_id,
    authClaim.account_id,
    jwtData.account_id
  )
  const organizationId = _firstNonEmptyString(
    raw.organization_id,
    raw.organizationId,
    tokens.organization_id,
    tokens.organizationId,
    authClaim.organization_id,
    authClaim.chatgpt_organization_id,
    authClaim.chatgpt_org_id,
    authClaim.org_id
  )
  const accountName = _firstNonEmptyString(raw.account_name, raw.accountName)
  const accountStructure = _firstNonEmptyString(raw.account_structure, raw.accountStructure)
  const tokenWorkspaceTitle = _resolveWorkspaceTitleFromOrganizations(
    Array.isArray(authClaim.organizations) ? authClaim.organizations : [],
    organizationId
  )
  const isPersonalStructure = accountStructure.toLowerCase().includes('personal')
  const isTeamLikePlan = _isCodexTeamLikePlan(raw.plan_type)
  const workspaceType = isPersonalStructure || (!accountStructure && !isTeamLikePlan) ? '个人' : '团队'

  let workspace = _firstNonEmptyString(raw.workspace, accountName, tokenWorkspaceTitle)
  if (!workspace) {
    workspace = workspaceType
  }

  const userId = _firstNonEmptyString(
    raw.user_id,
    authClaim.chatgpt_user_id,
    authClaim.user_id,
    jwtData.sub
  )

  return {
    id: raw.id || fileUtils.generateId(),
    email: email,
    user_id: userId,
    workspace: workspace,
    auth_mode: raw.auth_mode || 'import',
    plan_type: raw.plan_type || '',
    account_id: accountId,
    organization_id: organizationId,
    account_name: accountName,
    account_structure: accountStructure,
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken
    },
    quota: raw.quota || null,
    quota_error: raw.quota_error || null,
    invalid: Boolean(raw.invalid),
    tags: raw.tags || [],
    created_at: raw.created_at || Date.now(),
    last_used: raw.last_used || 0,
    added_via: raw.added_via || '',
    added_at: raw.added_at || 0
  }
}

function _stampPluginAddedMeta (account, addedVia, options) {
  if (!account || typeof account !== 'object') return account
  const via = String(addedVia || '').trim().toLowerCase()
  if (via) {
    account.added_via = via
  }
  account.added_at = Date.now()
  if (options && options.override === true) {
    account.added_meta_override = true
  }
  return account
}

function _normalizeAutoSourceTagKey (value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}

function _resolveAutoSourceViaByTag (tag) {
  const normalized = _normalizeAutoSourceTagKey(tag)
  if (!normalized) return ''
  if (normalized === '本地导入') return 'local'
  if (normalized === 'json导入' || normalized === 'json导入账号') return 'json'
  if (normalized === 'oauth授权') return 'oauth'
  if (normalized === 'token导入') return 'token'
  if (normalized === 'apikey导入') return 'apikey'
  return ''
}

function _stripAutoSourceTags (tags) {
  if (!Array.isArray(tags)) return []
  return tags
    .map(tag => String(tag || '').trim())
    .filter(Boolean)
    .filter(tag => !_resolveAutoSourceViaByTag(tag))
}

function _sameTagList (left, right) {
  const a = Array.isArray(left) ? left : []
  const b = Array.isArray(right) ? right : []
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (String(a[i] || '') !== String(b[i] || '')) return false
  }
  return true
}

function _inferCodexAddedVia (account) {
  const tags = Array.isArray(account && account.tags) ? account.tags : []
  for (let i = 0; i < tags.length; i++) {
    const via = _resolveAutoSourceViaByTag(tags[i])
    if (via) return via
  }

  const mode = String(account && account.auth_mode ? account.auth_mode : '').trim().toLowerCase()
  if (mode === 'oauth') return 'oauth'
  if (mode === 'token') return 'token'
  if (mode === 'import') return 'json'
  if (mode === 'apikey') return 'apikey'
  return ''
}

function _resolveAdvancedSettings (options) {
  const stored = _readAdvancedSettingsFromStorage()
  const merged = options && typeof options === 'object'
    ? Object.assign({}, DEFAULT_ADVANCED_SETTINGS, stored, options)
    : Object.assign({}, DEFAULT_ADVANCED_SETTINGS, stored)

  if (typeof merged.codexStartupPath !== 'string' || !merged.codexStartupPath.trim()) {
    if (typeof merged.startupPath === 'string' && merged.startupPath.trim()) {
      merged.codexStartupPath = merged.startupPath
    }
  }
  if (typeof merged.autoRestartCodexApp === 'undefined' && typeof merged.autoStartCodexApp !== 'undefined') {
    merged.autoRestartCodexApp = Boolean(merged.autoStartCodexApp)
  }
  merged.autoRestartCodexApp = Boolean(merged.autoRestartCodexApp)
  merged.autoStartCodexAppWhenClosed = Boolean(merged.autoStartCodexAppWhenClosed)
  merged.overrideOpenCode = Boolean(merged.overrideOpenCode)
  merged.autoRestartOpenCode = Boolean(merged.autoRestartOpenCode)
  merged.autoStartOpenCodeWhenClosed = Boolean(merged.autoStartOpenCodeWhenClosed)
  merged.codexStartupPath = typeof merged.codexStartupPath === 'string' ? merged.codexStartupPath : ''
  merged.openCodeStartupPath = typeof merged.openCodeStartupPath === 'string' ? merged.openCodeStartupPath : ''
  delete merged.autoStartCodexApp
  delete merged.autoStartOpenCode
  delete merged.startupPath
  delete merged.overrideOpenClaw
  return merged
}

function _readAdvancedSettingsFromStorage () {
  try {
    const saved = sharedSettingsStore.readValue('codex_advanced_settings', {})
    if (saved && typeof saved === 'object') return saved
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
      const openCodeRunning = _isOpenCodeRunning()
      if (openCodeRunning) {
        const restartRes = _restartOpenCode(settings.openCodeStartupPath)
        if (!restartRes.success) {
          warnings.push('OpenCode 重启失败: ' + restartRes.error)
        }
      } else if (settings.autoStartOpenCodeWhenClosed) {
        const launchRes = _startOpenCode(settings.openCodeStartupPath)
        if (!launchRes.success) {
          warnings.push('OpenCode 启动失败: ' + launchRes.error)
        }
      }
    }
  }

  const codexRunning = _isCodexAppRunning()
  if (settings.autoRestartCodexApp) {
    if (codexRunning) {
      const restartRes = _restartCodexApp(settings.codexStartupPath)
      if (!restartRes.success) {
        warnings.push('Codex App 重启失败: ' + restartRes.error)
      }
    } else if (settings.autoStartCodexAppWhenClosed) {
      const launchRes = _launchCodexApp(settings.codexStartupPath)
      if (!launchRes.success) {
        warnings.push('Codex App 启动失败: ' + launchRes.error)
      }
    }
  }

  return warnings
}

function _isCodexAppRunning () {
  try {
    if (process.platform === 'darwin') return _listCodexPids().length > 0
    if (process.platform === 'win32') {
      const output = cp.execFileSync('tasklist', ['/FI', 'IMAGENAME eq Codex.exe'], { encoding: 'utf8' })
      return /Codex\.exe/i.test(String(output || ''))
    }
    if (process.platform === 'linux') {
      cp.execFileSync('pgrep', ['-f', 'codex'], { stdio: 'ignore' })
      return true
    }
  } catch {}
  return false
}

function _listCodexPids () {
  if (process.platform !== 'darwin') return []
  try {
    const output = cp.execFileSync('pgrep', ['-f', 'Codex.app/Contents/MacOS|OpenAI Codex.app/Contents/MacOS'], { encoding: 'utf8' })
    return String(output || '')
      .split(/\s+/)
      .map(item => Number(item))
      .filter(pid => Number.isInteger(pid) && pid > 0)
  } catch {}
  return []
}

function _sleepSync (ms) {
  const duration = Math.max(0, Number(ms) || 0)
  if (!duration) return
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration)
  } catch {}
}

function _isOpenCodeRunning () {
  try {
    if (process.platform === 'darwin') return _listOpenCodePids().length > 0
    if (process.platform === 'win32') {
      const output = cp.execFileSync('tasklist', ['/FI', 'IMAGENAME eq OpenCode.exe'], { encoding: 'utf8' })
      return /OpenCode\.exe/i.test(String(output || ''))
    }
    if (process.platform === 'linux') {
      cp.execFileSync('pgrep', ['-f', 'opencode'], { stdio: 'ignore' })
      return true
    }
  } catch {}
  return false
}

function _listOpenCodePids () {
  if (process.platform !== 'darwin') return []
  try {
    const output = cp.execFileSync('pgrep', ['-f', 'OpenCode.app/Contents/MacOS|OpenCode Beta.app/Contents/MacOS'], { encoding: 'utf8' })
    return String(output || '')
      .split(/\s+/)
      .map(item => Number(item))
      .filter(pid => Number.isInteger(pid) && pid > 0)
  } catch {}
  return []
}

function _restartCodexApp (customPath) {
  _closeCodexApp()
  const waited = _waitForCodexExit(20000)
  if (!waited.success) return waited
  return _launchCodexApp(customPath)
}

function _closeCodexApp () {
  if (process.platform === 'darwin') {
    const pids = _listCodexPids()
    for (const pid of pids) {
      try {
        const script = [
          'tell application "System Events" to set frontmost of (first process whose unix id is ' + pid + ') to true',
          'tell application "System Events" to keystroke "q" using command down'
        ].join('\n')
        cp.execFileSync('osascript', ['-e', script], { stdio: 'ignore' })
      } catch {}
    }
    if (pids.length > 0) _sleepSync(1800)
    if (_isCodexAppRunning()) {
      for (const pid of _listCodexPids()) {
        try {
          cp.execFileSync('kill', ['-15', String(pid)], { stdio: 'ignore' })
        } catch {}
      }
      _sleepSync(1000)
    }
    if (_isCodexAppRunning()) {
      try {
        cp.execFileSync('pkill', ['-f', 'Codex.app/Contents/MacOS|OpenAI Codex.app/Contents/MacOS'], { stdio: 'ignore' })
      } catch {}
    }
    return
  }

  try {
    if (process.platform === 'win32') {
      cp.execFileSync('taskkill', ['/IM', 'Codex.exe'], { stdio: 'ignore' })
      _sleepSync(1200)
      if (_isCodexAppRunning()) {
        cp.execFileSync('taskkill', ['/IM', 'Codex.exe', '/F'], { stdio: 'ignore' })
      }
    } else if (process.platform === 'linux') {
      cp.execFileSync('pkill', ['-15', '-f', 'codex'], { stdio: 'ignore' })
      _sleepSync(1200)
      if (_isCodexAppRunning()) {
        cp.execFileSync('pkill', ['-f', 'codex'], { stdio: 'ignore' })
      }
    }
  } catch {}
}

function _waitForCodexExit (timeoutMs = 20000) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 20000)
  while (Date.now() < deadline) {
    if (!_isCodexAppRunning()) {
      return { success: true }
    }
    _sleepSync(250)
  }
  return { success: false, error: '等待 Codex App 退出超时' }
}

function _launchCodexApp (customPath) {
  const appPath = detectCodexAppPath(customPath)
  if (!appPath) {
    return { success: false, error: '未找到 Codex App 路径' }
  }

  try {
    if (process.platform === 'darwin') {
      if (appPath.endsWith('.app')) {
        cp.spawn('open', ['-n', '-a', appPath], { detached: true, stdio: 'ignore' }).unref()
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
    accountId: _firstNonEmptyString(
      account.account_id,
      tokens.account_id,
      _extractChatGptAccountId(tokens.access_token),
      _extractChatGptAccountId(tokens.id_token)
    ) || undefined
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
    accountId: _firstNonEmptyString(
      account.account_id,
      tokens.account_id,
      _extractChatGptAccountId(tokens.access_token),
      _extractChatGptAccountId(tokens.id_token)
    ) || undefined,
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

function _pickExistingPath (paths) {
  for (let i = 0; i < paths.length; i++) {
    const candidate = String(paths[i] || '').trim()
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return ''
}

function _pickExistingDir (paths) {
  for (let i = 0; i < paths.length; i++) {
    const candidate = String(paths[i] || '').trim()
    if (!candidate) continue
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
    } catch {}
  }
  return ''
}

function _pushUniquePath (arr, val) {
  if (!val) return
  if (arr.indexOf(val) >= 0) return
  arr.push(val)
}

function _getParentDirs (paths) {
  const parents = []
  for (let i = 0; i < paths.length; i++) {
    const dirPath = String(paths[i] || '').trim()
    if (!dirPath) continue
    _pushUniquePath(parents, path.dirname(dirPath))
  }
  return parents
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

function _restartOpenCode (customPath) {
  try {
    _closeOpenCode()
    const waited = _waitForOpenCodeExit(20000)
    if (!waited.success) return waited
    const started = _startOpenCode(customPath)
    if (!started.success) return started
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

function _closeOpenCode () {
  if (process.platform === 'darwin') {
    const pids = _listOpenCodePids()
    for (const pid of pids) {
      try {
        const script = [
          'tell application "System Events" to set frontmost of (first process whose unix id is ' + pid + ') to true',
          'tell application "System Events" to keystroke "q" using command down'
        ].join('\n')
        cp.execFileSync('osascript', ['-e', script], { stdio: 'ignore' })
      } catch {}
    }
    if (pids.length > 0) _sleepSync(1800)
    if (_isOpenCodeRunning()) {
      for (const pid of _listOpenCodePids()) {
        try {
          cp.execFileSync('kill', ['-15', String(pid)], { stdio: 'ignore' })
        } catch {}
      }
      _sleepSync(1000)
    }
    if (_isOpenCodeRunning()) {
      try {
        cp.execFileSync('pkill', ['-f', 'OpenCode.app/Contents/MacOS|OpenCode Beta.app/Contents/MacOS'], { stdio: 'ignore' })
      } catch {}
    }
    return
  }

  try {
    if (process.platform === 'win32') {
      cp.execFileSync('taskkill', ['/IM', 'OpenCode.exe'], { stdio: 'ignore' })
      _sleepSync(1200)
      if (_isOpenCodeRunning()) {
        cp.execFileSync('taskkill', ['/IM', 'OpenCode.exe', '/F'], { stdio: 'ignore' })
      }
    } else if (process.platform === 'linux') {
      cp.execFileSync('pkill', ['-15', '-f', 'opencode'], { stdio: 'ignore' })
      _sleepSync(1200)
      if (_isOpenCodeRunning()) {
        cp.execFileSync('pkill', ['-f', 'opencode'], { stdio: 'ignore' })
      }
    }
  } catch {}
}

function _waitForOpenCodeExit (timeoutMs = 20000) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 20000)
  while (Date.now() < deadline) {
    if (!_isOpenCodeRunning()) {
      return { success: true }
    }
    _sleepSync(250)
  }
  return { success: false, error: '等待 OpenCode 退出超时' }
}

function _startOpenCode (customPath) {
  const appPath = detectOpenCodeAppPath(customPath)
  if (!appPath) {
    return { success: false, error: '未找到 OpenCode 可执行文件' }
  }
  try {
    if (process.platform === 'darwin') {
      if (appPath.endsWith('.app')) {
        cp.spawn('open', ['-n', '-a', appPath], { detached: true, stdio: 'ignore' }).unref()
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
    return { success: false, error: '当前系统不支持重启 OpenCode' }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

module.exports = {
  list,
  getCurrent,
  getLocalImportStatus,
  syncCurrentFromLocal,
  importFromLocal,
  importFromJson,
  addWithToken,
  prepareOAuthSession,
  getOAuthSessionStatus,
  completeOAuthSession,
  cancelOAuthSession,
  getPendingOAuthSession,
  savePendingOAuthSession,
  clearPendingOAuthSession,
  openExternalUrl,
  switchAccount,
  activateAccount,
  deleteAccount,
  deleteAccounts,
  refreshToken,
  refreshQuota,
  refreshQuotaOrUsage,
  exportAccounts,
  updateTags,
  getPlanDisplayName,
  getConfigDir,
  getConfigDirCandidates,
  getAuthFilePathCandidates,
  getLocalStateWatchTargets,
  getCodexAppPathCandidates,
  getOpenCodeAppPathCandidates,
  getDefaultCodexAppPath,
  getDefaultOpenCodeAppPath,
  detectCodexAppPath,
  detectOpenCodeAppPath
}
