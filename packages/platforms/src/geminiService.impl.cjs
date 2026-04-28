/**
 * geminiService.js — Gemini CLI 账号管理服务
 *
 * Gemini CLI 本地凭证文件位于 ~/.gemini/ 目录：
 *   - oauth_creds.json     (OAuth 凭证)
 *   - google_accounts.json (Google 账号激活信息)
 *   - settings.json        (配置)
 */

const path = require('path')
const cp = require('child_process')
const crypto = require('crypto')
const http = require('http')
const { retryOAuthRequest } = require('./utils/retryOAuthRequest')
const fileUtils = require('../../infra-node/src/fileUtils.cjs')
const storage = require('../../infra-node/src/accountStorage.cjs')
const requestLogger = require('../../infra-node/src/requestLogStore.cjs')
const sharedSettingsStore = require('../../infra-node/src/sharedSettingsStore.cjs')

const PLATFORM = 'gemini'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const CODE_ASSIST_LOAD_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const CODE_ASSIST_QUOTA_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'

const GEMINI_CLIENT_ID = String(
  process.env.GEMINI_CLIENT_ID ||
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
).trim()
const GEMINI_CLIENT_SECRET = String(
  process.env.GEMINI_CLIENT_SECRET ||
  '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'
).trim()

const GEMINI_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
].join(' ')

const GEMINI_OAUTH_CALLBACK_PORT = 1458
const GEMINI_OAUTH_CALLBACK_PATH = '/oauth2callback'
const GEMINI_OAUTH_SESSION_TTL_MS = 10 * 60 * 1000
const LOCAL_SYNC_IMPORT_COOLDOWN_MS = 30 * 1000

const oauthSessions = new Map()
const localSyncState = {
  lastFingerprint: '',
  lastAttemptAt: 0
}
const AUTO_SOURCE_TAG_TO_VIA = {
  本地导入: 'local',
  JSON导入: 'json',
  JSON导入账号: 'json',
  OAuth授权: 'oauth',
  'OAuth 授权': 'oauth',
  Token导入: 'token',
  'Token 导入': 'token'
}

function _readAdvancedSettingsFromStorage () {
  try {
    const saved = sharedSettingsStore.readValue('gemini_advanced_settings', {})
    if (saved && typeof saved === 'object') return saved
  } catch {}
  return {}
}

function _resolveGeminiOAuthCredentials () {
  const settings = _readAdvancedSettingsFromStorage()
  return {
    clientId: String(GEMINI_CLIENT_ID || settings.oauthClientId || '').trim(),
    clientSecret: String(GEMINI_CLIENT_SECRET || settings.oauthClientSecret || '').trim()
  }
}

function _getGeminiOAuthCredentialError (action) {
  const actionText = String(action || '执行操作').trim() || '执行操作'
  return `未配置 Gemini 的 Google OAuth 凭证，无法${actionText}。请先到 Gemini 设置中填写 Client ID 和 Client Secret。`
}

function _normalizeAutoSourceTagKey (value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}

function _resolveAutoSourceViaByTag (tag) {
  const normalized = _normalizeAutoSourceTagKey(tag)
  if (!normalized) return ''
  const entries = Object.entries(AUTO_SOURCE_TAG_TO_VIA)
  for (let i = 0; i < entries.length; i++) {
    const [label, via] = entries[i]
    if (_normalizeAutoSourceTagKey(label) === normalized) return via
  }
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

function _inferGeminiAddedVia (account) {
  const explicit = String(account && account.added_via ? account.added_via : '').trim().toLowerCase()
  if (explicit) return explicit
  const tags = Array.isArray(account && account.tags) ? account.tags : []
  for (let i = 0; i < tags.length; i++) {
    const via = _resolveAutoSourceViaByTag(tags[i])
    if (via) return via
  }
  return ''
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

function getConfigDirCandidates (runtime) {
  const platform = _resolveRuntimePlatform(runtime)
  const env = _resolveRuntimeEnv(runtime)
  const homeDir = _resolveRuntimeHomeDir(runtime)
  const candidates = []
  const explicit = String(env.GEMINI_CONFIG_DIR || '').trim()

  if (explicit) {
    _pushUniquePath(candidates, _resolveUserPath(explicit))
  }

  _pushUniquePath(candidates, path.join(homeDir, '.gemini'))

  if (platform === 'win32') {
    const roaming = String(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')).trim()
    const local = String(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')).trim()
    _pushUniquePath(candidates, path.join(roaming, 'Gemini'))
    _pushUniquePath(candidates, path.join(roaming, '.gemini'))
    _pushUniquePath(candidates, path.join(local, 'Gemini'))
    _pushUniquePath(candidates, path.join(local, '.gemini'))
  } else if (platform === 'linux') {
    const xdgConfigHome = String(env.XDG_CONFIG_HOME || '').trim()
    if (xdgConfigHome) {
      _pushUniquePath(candidates, path.join(xdgConfigHome, 'gemini'))
      _pushUniquePath(candidates, path.join(xdgConfigHome, '.gemini'))
    }
    _pushUniquePath(candidates, path.join(homeDir, '.config', 'gemini'))
    _pushUniquePath(candidates, path.join(homeDir, '.config', '.gemini'))
  }

  return candidates.filter(Boolean)
}

function getLocalStateFilePaths (runtime) {
  const dirPath = getConfigDir(runtime)
  return {
    configDir: dirPath,
    oauthFile: path.join(dirPath, 'oauth_creds.json'),
    googleAccountsFile: path.join(dirPath, 'google_accounts.json'),
    settingsFile: path.join(dirPath, 'settings.json')
  }
}

function getLocalStateWatchTargets (runtime) {
  const dirPaths = getConfigDirCandidates(runtime)
  return {
    dirPaths,
    fileNames: ['oauth_creds.json', 'google_accounts.json'],
    fallbackPaths: _getParentDirs(dirPaths)
  }
}

function getConfigDir (runtime) {
  const existingFiles = [
    'oauth_creds.json',
    'google_accounts.json',
    'settings.json'
  ]
    .map(fileName => getConfigDirCandidates(runtime).map(dirPath => path.join(dirPath, fileName)))
    .flat()
  const existingFile = _pickExistingPath(existingFiles)
  if (existingFile) return path.dirname(existingFile)
  const existingDir = _pickExistingDir(getConfigDirCandidates(runtime))
  if (existingDir) return existingDir
  return getConfigDirCandidates(runtime)[0] || path.join(fileUtils.getHomeDir(), '.gemini')
}

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

    const addedVia = _inferGeminiAddedVia(account)
    if (!String(account.added_via || '').trim() && addedVia) {
      updates.added_via = addedVia
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

function getCurrent () {
  return storage.getCurrentAccount(PLATFORM)
}

function getLocalImportStatus () {
  try {
    const { oauthFile, googleAccountsFile } = getLocalStateFilePaths()
    const oauthData = fileUtils.readJsonFile(oauthFile)
    const googleAccounts = fileUtils.readJsonFile(googleAccountsFile)

    const tokens = (oauthData && typeof oauthData === 'object') ? oauthData : {}
    const accessToken = String(tokens.access_token || '').trim()
    const refreshToken = String(tokens.refresh_token || '').trim()
    const idToken = String(tokens.id_token || '').trim()
    const activeEmail = String(extractEmailFromGoogleAccounts(googleAccounts) || '').trim().toLowerCase()
    const tokenEmail = String(extractEmailFromToken(idToken || accessToken) || '').trim().toLowerCase()
    const authId = String(extractSubFromToken(idToken) || '').trim()
    const email = activeEmail || tokenEmail
    const hasLocalState = !!(accessToken || refreshToken || activeEmail || tokenEmail || authId)
    if (!hasLocalState) {
      return { success: true, hasLocalState: false, imported: false, matchedId: null, email: '', account: null }
    }

    const accounts = storage.listAccounts(PLATFORM)
    const matched = _findGeminiAccountByLocalState(accounts, {
      accessToken,
      refreshToken,
      authId,
      email
    })

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
    const { oauthFile, googleAccountsFile } = getLocalStateFilePaths()
    const oauthData = fileUtils.readJsonFile(oauthFile)
    const googleAccounts = fileUtils.readJsonFile(googleAccountsFile)

    const tokens = (oauthData && typeof oauthData === 'object') ? oauthData : {}
    const accessToken = String(tokens.access_token || '').trim()
    const refreshToken = String(tokens.refresh_token || '').trim()
    const idToken = String(tokens.id_token || '').trim()
    const activeEmail = String(extractEmailFromGoogleAccounts(googleAccounts) || '').trim().toLowerCase()
    const tokenEmail = String(extractEmailFromToken(idToken || accessToken) || '').trim().toLowerCase()
    const authId = String(extractSubFromToken(idToken) || '').trim()

    const previousId = storage.getCurrentId(PLATFORM)
    if (!accessToken && !refreshToken && !activeEmail && !tokenEmail && !authId) {
      if (previousId) {
        storage.clearCurrentId(PLATFORM)
        return { success: true, changed: true, currentId: null, account: null }
      }
      return { success: true, changed: false, currentId: null, account: null }
    }

    let accounts = storage.listAccounts(PLATFORM)
    let matched = _findGeminiAccountByLocalState(accounts, {
      accessToken,
      refreshToken,
      authId,
      email: activeEmail || tokenEmail
    })
    let importedAny = false

    if (!matched && allowAutoImport) {
      const fingerprint = _buildGeminiLocalFingerprint({
        accessToken,
        refreshToken,
        authId,
        email: activeEmail || tokenEmail
      })
      if (_shouldTryAutoImportByFingerprint(fingerprint)) {
        const imported = await _importFromLocalAsync()
        importedAny = _countImportedArray(imported && imported.imported) > 0
        if (importedAny) {
          accounts = storage.listAccounts(PLATFORM)
          matched = _findGeminiAccountByLocalState(accounts, {
            accessToken,
            refreshToken,
            authId,
            email: activeEmail || tokenEmail
          })
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
      return { success: true, changed: true, currentId: null, account: null }
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

function _serializeOAuthSession (session) {
  if (!session || typeof session !== 'object') return null
  return {
    sessionId: session.sessionId || '',
    state: session.state || '',
    redirectUri: session.redirectUri || '',
    authUrl: session.authUrl || '',
    callbackUrl: session.callbackUrl || '',
    createdAt: Number(session.createdAt || Date.now()),
    completedAt: Number(session.completedAt || 0) || 0,
    autoStatus: String(session.autoStatus || '').trim(),
    autoError: String(session.autoError || '').trim(),
    autoAccountId: String(session.autoAccountId || '').trim(),
    autoQuotaRefreshError: String(session.autoQuotaRefreshError || '').trim(),
    autoCompletedAt: Number(session.autoCompletedAt || 0) || 0
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
    redirectUri: String(saved.redirectUri || '').trim(),
    authUrl: String(saved.authUrl || '').trim(),
    callbackUrl: String(saved.callbackUrl || '').trim(),
    createdAt: Number(saved.createdAt || 0) || Date.now(),
    completedAt: Number(saved.completedAt || 0) || 0,
    autoStatus: String(saved.autoStatus || '').trim(),
    autoError: String(saved.autoError || '').trim(),
    autoAccountId: String(saved.autoAccountId || '').trim(),
    autoQuotaRefreshError: String(saved.autoQuotaRefreshError || '').trim(),
    autoCompletedAt: Number(saved.autoCompletedAt || 0) || 0
  }
  if (!session.state || !session.redirectUri) return null
  oauthSessions.set(sid, session)
  return session
}

function getPendingOAuthSession (sessionId) {
  if (sessionId) {
    return storage.getOAuthPending(PLATFORM, sessionId)
  }
  return storage.getLatestOAuthPending(PLATFORM, GEMINI_OAUTH_SESSION_TTL_MS)
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

function _startOAuthCallbackServer (session) {
  return new Promise((resolve) => {
    if (!session || !session.redirectUri) {
      resolve({ success: false, error: 'OAuth 会话无效，无法监听回调端口' })
      return
    }

    const redirect = new URL(session.redirectUri)
    const port = Number(redirect.port || GEMINI_OAUTH_CALLBACK_PORT)
    const expectedPath = redirect.pathname || GEMINI_OAUTH_CALLBACK_PATH

    const server = require('http').createServer(function (req, res) {
      try {
        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        const reqUrl = req.url || '/'
        const url = new URL(reqUrl, session.redirectUri)
        if (url.pathname !== expectedPath) {
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
        session.autoStatus = 'processing'
        session.autoError = ''
        session.autoAccountId = ''
        session.autoQuotaRefreshError = ''
        session.autoCompletedAt = 0
        _saveOAuthSession(session)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(_oauthCallbackSuccessHtml())
        _triggerGeminiOAuthAutoComplete(session)
        setTimeout(function () {
          _closeOAuthSessionServer(session)
        }, 20)
      } catch {
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

        // 不指定 host，兼容 localhost / 127.0.0.1 / IPv6 loopback 的本地解析差异。
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
          requestLogger.info('gemini.oauth', `启动 OAuth 回调服务器失败，正在重试 (${attempt}/5)`, {
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
  return '<!doctype html><html><head><meta charset="utf-8"><title>Gemini 授权成功</title>' +
    '<style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#0f172a;color:#e2e8f0;font:16px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,PingFang SC,Helvetica Neue,Arial,sans-serif}.card{padding:24px 28px;border:1px solid #334155;border-radius:12px;background:#111827}h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#94a3b8}</style>' +
    '</head><body><div class="card"><h1>授权完成</h1><p>你可以关闭此页面，返回 Aideck。</p></div></body></html>'
}

async function _finalizeGeminiOAuthSession (session, callbackUrl, options = {}) {
  if (!session || !session.sessionId) {
    return { success: false, error: 'OAuth 会话不存在或已过期，请重新生成授权链接' }
  }

  const opts = options && typeof options === 'object' ? options : {}
  const keepPendingOnSuccess = opts.keepPendingOnSuccess !== false

  const callbackRaw = String(callbackUrl || '').trim() || String(session.callbackUrl || '').trim()
  if (!callbackRaw) {
    return { success: false, error: '尚未收到浏览器回调，请稍后重试或手动粘贴回调地址' }
  }

  const normalizedCallback = _normalizeCallbackUrl(callbackRaw, session.redirectUri)
  if (!normalizedCallback.ok) {
    return { success: false, error: normalizedCallback.error }
  }

  const callback = normalizedCallback.url
  const validationError = _validateManualCallback(callback, session.redirectUri, session.state)
  if (validationError) {
    return { success: false, error: validationError }
  }

  const authError = callback.searchParams.get('error')
  if (authError) {
    const desc = callback.searchParams.get('error_description') || ''
    return {
      success: false,
      error: desc ? ('Google OAuth 错误: ' + authError + ' (' + desc + ')') : ('Google OAuth 错误: ' + authError)
    }
  }

  const code = callback.searchParams.get('code')
  if (!code) {
    return { success: false, error: '回调地址缺少 code 参数' }
  }

  const exchanged = await _exchangeCodeForTokens(code, session.redirectUri)
  if (!exchanged.ok) {
    return { success: false, error: exchanged.error || 'Token 交换失败' }
  }

  const tokens = exchanged.tokens
  const accessToken = tokens.access_token || ''
  const remoteState = await _loadGeminiRemoteState(accessToken, '')

  const account = _createGeminiAccountFromPayload({
    email: remoteState.userinfo.email || extractEmailFromToken(tokens.id_token) || 'unknown@gmail.com',
    name: remoteState.userinfo.name || '',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    token_type: tokens.token_type,
    scope: tokens.scope,
    expiry_date: tokens.expiry_date,
    selected_auth_type: 'oauth-personal',
    auth_id: remoteState.userinfo.id || extractSubFromToken(tokens.id_token) || '',
    project_id: remoteState.codeAssist.project_id || '',
    tier_id: remoteState.codeAssist.tier_id || '',
    plan_name: remoteState.codeAssist.plan_name || '',
    quota: remoteState.quota || null
  }, 'oauth')

  const savedAccount = storage.addAccount(PLATFORM, account) || account

  _closeOAuthSessionServer(session)
  session.server = null
  session.autoStatus = 'completed'
  session.autoError = ''
  session.autoAccountId = savedAccount.id || account.id || ''
  session.autoQuotaRefreshError = String(remoteState.quotaError || '').trim()
  session.autoCompletedAt = Date.now()
  session.callbackUrl = callback.toString()
  session.completedAt = Number(session.completedAt || Date.now()) || Date.now()

  if (keepPendingOnSuccess) {
    oauthSessions.set(session.sessionId, session)
    _saveOAuthSession(session)
  } else {
    oauthSessions.delete(session.sessionId)
    storage.clearOAuthPending(PLATFORM, session.sessionId)
  }

  return {
    success: true,
    account: storage.getAccount(PLATFORM, savedAccount.id || account.id) || savedAccount,
    quotaRefreshError: remoteState.quotaError || null
  }
}

function _triggerGeminiOAuthAutoComplete (session) {
  if (!session || !session.sessionId) return
  if (session._autoCompleting) return
  session._autoCompleting = true

  session.autoStatus = 'processing'
  session.autoError = ''
  session.autoAccountId = ''
  session.autoQuotaRefreshError = ''
  session.autoCompletedAt = 0
  _saveOAuthSession(session)

  Promise.resolve()
    .then(() => _finalizeGeminiOAuthSession(session, session.callbackUrl, {
      keepPendingOnSuccess: true,
      keepPendingOnFailure: true
    }))
    .catch((err) => {
      session.autoStatus = 'failed'
      session.autoError = err && err.message ? err.message : String(err)
      session.autoAccountId = ''
      session.autoQuotaRefreshError = ''
      session.autoCompletedAt = 0
      _saveOAuthSession(session)
      return null
    })
    .then((result) => {
      if (!result) return
      if (result.success) return
      session.autoStatus = 'failed'
      session.autoError = String(result.error || '自动处理 OAuth 回调失败').trim()
      session.autoAccountId = ''
      session.autoQuotaRefreshError = ''
      session.autoCompletedAt = 0
      _saveOAuthSession(session)
    })
    .finally(() => {
      session._autoCompleting = false
    })
}

/**
 * 准备 OAuth 会话（优先自动回调，失败时可手动回调）
 */
async function prepareOAuthSession (port) {
  try {
    const { clientId, clientSecret } = _resolveGeminiOAuthCredentials()
    if (!clientId) {
      return { success: false, error: _getGeminiOAuthCredentialError('发起 OAuth') }
    }
    if (!clientSecret) {
      return { success: false, error: _getGeminiOAuthCredentialError('发起 OAuth') }
    }
    storage.cleanupOAuthPending(PLATFORM, GEMINI_OAUTH_SESSION_TTL_MS)
    // 清理旧的会话，避免 state 冲突
    _cleanupActiveOAuthSessions()
    const callbackPort = await _resolveAvailableOAuthPort(port)
    const redirectUri = 'http://127.0.0.1:' + callbackPort + GEMINI_OAUTH_CALLBACK_PATH
    const state = _randomBase64Url()
    const authUrl = _buildGeminiAuthorizeUrl(redirectUri, state, clientId)
    const sessionId = 'gemini-oauth-' + fileUtils.generateId()

    const session = {
      sessionId,
      state,
      redirectUri,
      authUrl,
      createdAt: Date.now(),
      expiresAt: Date.now() + GEMINI_OAUTH_SESSION_TTL_MS // 10 分钟后过期
    }
    oauthSessions.set(sessionId, session)
    const startRes = await _startOAuthCallbackServer(session)
    if (!startRes || !startRes.success) {
      oauthSessions.delete(sessionId)
      storage.clearOAuthPending(PLATFORM, sessionId)
      return { success: false, error: (startRes && startRes.error) || '启动本地回调监听失败' }
    }
    _saveOAuthSession(session)

    // 设置超时自动关闭定时器
    session.timeoutTimer = setTimeout(() => {
      requestLogger.info('gemini.oauth', 'OAuth 会话超时，自动关闭', {
        sessionId,
        timeoutMinutes: GEMINI_OAUTH_SESSION_TTL_MS / 60 / 1000
      })
      cancelOAuthSession(sessionId)
    }, GEMINI_OAUTH_SESSION_TTL_MS)

    return {
      success: true,
      session: {
        sessionId,
        authUrl,
        redirectUri,
        expiresAt: session.expiresAt
      }
    }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

function cancelOAuthSession (sessionId) {
  if (!sessionId) return { success: true }
  const session = oauthSessions.get(sessionId)
  // 清除超时定时器
  if (session && session.timeoutTimer) {
    clearTimeout(session.timeoutTimer)
    session.timeoutTimer = null
  }
  _closeOAuthSessionServer(session)
  oauthSessions.delete(sessionId)
  storage.clearOAuthPending(PLATFORM, sessionId)
  return { success: true }
}

async function getOAuthSessionStatus (sessionId) {
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
  if (session.autoStatus === 'processing') {
    return {
      success: true,
      status: 'processing'
    }
  }
  if (session.autoStatus === 'failed') {
    return {
      success: true,
      status: 'failed',
      error: session.autoError || '自动处理 OAuth 回调失败，请手动提交回调地址重试',
      callbackUrl: session.callbackUrl || ''
    }
  }
  if (session.autoStatus === 'completed') {
    return {
      success: true,
      status: 'completed',
      callbackUrl: session.callbackUrl || '',
      accountId: session.autoAccountId || '',
      quotaRefreshError: session.autoQuotaRefreshError || ''
    }
  }
  if (!session.callbackUrl && !session.server) {
    const startRes = await _startOAuthCallbackServer(session)
    if (!startRes || !startRes.success) {
      oauthSessions.delete(sid)
      storage.clearOAuthPending(PLATFORM, sid)
      return {
        success: false,
        status: 'missing',
        error: (startRes && startRes.error) || 'OAuth 回调监听启动失败，请重新生成授权链接'
      }
    }
    _saveOAuthSession(session)
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

async function completeOAuthSession (sessionId, callbackUrl) {
  const sid = (sessionId || '').trim()
  if (!sid) return { success: false, error: '缺少 OAuth 会话 ID' }

  _cleanupExpiredOAuthSessions()
  const session = oauthSessions.get(sid) || _loadOAuthSession(sid)
  if (!session) {
    return { success: false, error: 'OAuth 会话不存在或已过期，请重新生成授权链接' }
  }
  if (session.autoStatus === 'processing') {
    return { success: false, error: '已收到浏览器回调，正在自动添加账号，请稍后重试' }
  }
  if (session.autoStatus === 'completed' && session.autoAccountId) {
    const savedAccount = storage.getAccount(PLATFORM, session.autoAccountId)
    if (savedAccount) {
      _closeOAuthSessionServer(session)
      oauthSessions.delete(sid)
      storage.clearOAuthPending(PLATFORM, sid)
      return {
        success: true,
        account: savedAccount,
        quotaRefreshError: session.autoQuotaRefreshError || null
      }
    }
  }
  if (session.autoStatus === 'failed') {
    session.autoStatus = ''
    session.autoError = ''
    session.autoAccountId = ''
    session.autoQuotaRefreshError = ''
    session.autoCompletedAt = 0
    _saveOAuthSession(session)
  }

  const result = await _finalizeGeminiOAuthSession(session, callbackUrl, {
    keepPendingOnSuccess: false,
    keepPendingOnFailure: true
  })

  if (!result || !result.success) {
    session.autoStatus = 'failed'
    session.autoError = String((result && result.error) || '自动处理 OAuth 回调失败').trim()
    session.autoAccountId = ''
    session.autoQuotaRefreshError = ''
    session.autoCompletedAt = 0
    _saveOAuthSession(session)
    return result
  }

  return result
}

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

function importFromLocal () {
  return _importFromLocalAsync()
}

async function _importFromLocalAsync () {
  const { configDir, oauthFile, googleAccountsFile, settingsFile } = getLocalStateFilePaths()
  if (!fileUtils.dirExists(configDir)) {
    return { imported: [], error: '未找到 Gemini 配置目录: ' + configDir }
  }

  const imported = []
  const seen = new Set()

  function pushImported (account) {
    if (!account || !account.id) return
    const saved = storage.addAccount(PLATFORM, account)
    const key = (saved && saved.id) ? saved.id : account.id
    if (!key || seen.has(key)) return
    seen.add(key)
    imported.push(saved || account)
  }

  const oauthData = fileUtils.readJsonFile(oauthFile)
  const googleAccounts = fileUtils.readJsonFile(googleAccountsFile)
  const settingsData = fileUtils.readJsonFile(settingsFile)
  const selectedAuthType = _readSelectedAuthTypeFromSettings(settingsData)
  const warnings = []

  if (oauthData && (oauthData.access_token || oauthData.refresh_token)) {
    let accessToken = oauthData.access_token || ''
    const refreshToken = oauthData.refresh_token || ''
    let idToken = oauthData.id_token || ''
    let tokenType = oauthData.token_type || 'Bearer'
    let scope = oauthData.scope || ''
    let expiryDate = oauthData.expiry_date || null

    if (refreshToken) {
      const refreshed = await _refreshGeminiTokenByRefreshToken(refreshToken)
      if (refreshed && refreshed.success) {
        accessToken = refreshed.access_token || accessToken
        idToken = refreshed.id_token || idToken
        tokenType = refreshed.token_type || tokenType
        scope = refreshed.scope || scope
        expiryDate = refreshed.expiry_date || expiryDate
      } else if (!accessToken) {
        return { imported: [], error: 'refresh_token 刷新 access_token 失败: ' + ((refreshed && refreshed.error) || '未知错误') }
      } else if (refreshed && refreshed.error) {
        warnings.push('refresh_token 刷新失败，已使用本地 access_token 继续导入: ' + refreshed.error)
      }
    }

    const remoteState = await _loadGeminiRemoteState(accessToken, oauthData.project_id || '')
    const account = _createGeminiAccountFromPayload({
      email: remoteState.userinfo.email || extractEmailFromGoogleAccounts(googleAccounts) || extractEmailFromToken(idToken) || 'local@gemini',
      name: remoteState.userinfo.name || '',
      auth_id: remoteState.userinfo.id || extractSubFromToken(idToken) || '',
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
      token_type: tokenType,
      scope: scope,
      expiry_date: expiryDate,
      selected_auth_type: selectedAuthType,
      project_id: remoteState.codeAssist.project_id || oauthData.project_id || '',
      tier_id: remoteState.codeAssist.tier_id || oauthData.tier_id || '',
      plan_name: remoteState.codeAssist.plan_name || oauthData.plan_name || '',
      quota: remoteState.quota || null
    }, 'local')

    pushImported(account)
  }

  if (imported.length === 0) {
    return { imported: [], error: '未找到有效的 Gemini 账号数据' }
  }
  const first = imported[0]
  if (first && first.id) {
    storage.setCurrentId(PLATFORM, first.id)
  }
  return {
    imported,
    error: null,
    warning: warnings.length > 0 ? warnings.join('；') : null
  }
}

function importFromJson (jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent)
    const rawList = Array.isArray(parsed) ? parsed : [parsed]
    const imported = []

    for (let i = 0; i < rawList.length; i++) {
      const account = normalizeAccount(rawList[i], 'json')
      if (account) {
        storage.addAccount(PLATFORM, account)
        imported.push(account)
      }
    }

    if (imported.length === 0) {
      return { imported: [], error: '未找到有效的 Gemini 账号数据' }
    }
    return { imported, error: null }
  } catch (err) {
    return { imported: [], error: 'JSON 解析失败: ' + err.message }
  }
}

async function addWithToken (idToken, accessToken, refreshToken) {
  let nextAccessToken = accessToken || ''
  let nextIdToken = idToken || ''
  const nextRefreshToken = refreshToken || ''
  let tokenType = 'Bearer'
  let scope = ''
  let expiryDate = null

  if (nextRefreshToken) {
    const refreshed = await _refreshGeminiTokenByRefreshToken(nextRefreshToken)
    if (refreshed && refreshed.success) {
      nextAccessToken = refreshed.access_token || nextAccessToken
      nextIdToken = refreshed.id_token || nextIdToken
      tokenType = refreshed.token_type || tokenType
      scope = refreshed.scope || scope
      expiryDate = refreshed.expiry_date || expiryDate
    } else if (!nextAccessToken) {
      throw new Error('refresh_token 刷新 access_token 失败')
    }
  }

  const remoteState = await _loadGeminiRemoteState(nextAccessToken, '')
  const account = _createGeminiAccountFromPayload({
    email: remoteState.userinfo.email || extractEmailFromToken(nextIdToken || nextAccessToken) || 'token-import@gemini',
    auth_id: remoteState.userinfo.id || extractSubFromToken(nextIdToken) || '',
    name: remoteState.userinfo.name || '',
    access_token: nextAccessToken,
    refresh_token: nextRefreshToken,
    id_token: nextIdToken,
    token_type: tokenType,
    scope: scope,
    expiry_date: expiryDate,
    selected_auth_type: 'oauth-personal',
    project_id: remoteState.codeAssist.project_id || '',
    tier_id: remoteState.codeAssist.tier_id || '',
    plan_name: remoteState.codeAssist.plan_name || '',
    quota: remoteState.quota || null
  }, 'token')

  const saved = storage.addAccount(PLATFORM, account)
  return saved || account
}

function inject (accountId) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    requestLogger.warn('gemini.switch', '注入失败：账号不存在', { accountId })
    return { success: false, error: '账号不存在' }
  }
  requestLogger.info('gemini.switch', '开始注入账号', {
    account: account.email || account.id
  })

  const { configDir, oauthFile, googleAccountsFile, settingsFile } = getLocalStateFilePaths()
  fileUtils.ensureDir(configDir)

  const oauthData = {
    access_token: account.access_token || '',
    refresh_token: account.refresh_token || '',
    id_token: account.id_token || '',
    token_type: account.token_type || 'Bearer',
    scope: account.scope || '',
    expiry_date: account.expiry_date || null
  }

  const oauthOk = fileUtils.writeJsonFile(oauthFile, oauthData)
  if (!oauthOk) {
    requestLogger.warn('gemini.switch', '注入失败：写入 oauth_creds.json 失败', {
      account: account.email || account.id
    })
    return { success: false, error: '写入 oauth_creds.json 失败' }
  }

  const existingGoogleAccounts = fileUtils.readJsonFile(googleAccountsFile)
  const nextGoogleAccounts = _buildGoogleAccountsWithActive(existingGoogleAccounts, account.email)
  const accountsOk = fileUtils.writeJsonFile(googleAccountsFile, nextGoogleAccounts)
  if (!accountsOk) {
    requestLogger.warn('gemini.switch', '注入失败：写入 google_accounts.json 失败', {
      account: account.email || account.id
    })
    return { success: false, error: '写入 google_accounts.json 失败' }
  }

  const existingSettings = fileUtils.readJsonFile(settingsFile) || {}
  const selectedType = account.selected_auth_type || 'oauth-personal'
  const nextSettings = _writeSelectedAuthTypeToSettings(existingSettings, selectedType)
  const settingsOk = fileUtils.writeJsonFile(settingsFile, nextSettings)
  if (!settingsOk) {
    requestLogger.warn('gemini.switch', '注入失败：写入 settings.json 失败', {
      account: account.email || account.id
    })
    return { success: false, error: '写入 settings.json 失败' }
  }

  storage.updateAccount(PLATFORM, accountId, { last_used: Date.now() })
  storage.setCurrentId(PLATFORM, accountId)
  requestLogger.info('gemini.switch', '注入成功', {
    account: account.email || account.id
  })

  return { success: true, error: null }
}

function deleteAccount (accountId) {
  return storage.deleteAccount(PLATFORM, accountId)
}

function deleteAccounts (accountIds) {
  return storage.deleteAccounts(PLATFORM, accountIds)
}

function refreshQuotaOrUsage (accountId) {
  return refreshToken(accountId)
}

function activateAccount (accountId) {
  const result = inject(accountId)
  const warnings = []
  if (result?.warning) warnings.push(result.warning)
  if (Array.isArray(result?.warnings)) warnings.push(...result.warnings)
  return {
    success: !!result?.success,
    error: result?.error || null,
    warnings,
    stage: result?.success ? 'inject' : 'inject_failed',
    changed: !!result?.success
  }
}

function refreshToken (accountId) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    requestLogger.warn('gemini.token', '刷新失败：账号不存在', { accountId })
    return { success: false, error: '账号不存在' }
  }
  requestLogger.info('gemini.token', '开始刷新 Token/配额', {
    account: account.email || account.id
  })
  return _refreshGeminiTokenAsync(account, accountId)
}

function _normalizeGeminiExpiryDateMs (value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num) || num <= 0) return 0
  return num > 1000000000000 ? Math.floor(num) : Math.floor(num * 1000)
}

function _shouldRefreshGeminiAccessToken (accessToken, expiryDate, leadTimeMs = 15 * 60 * 1000) {
  const nextAccessToken = String(accessToken || '').trim()
  if (!nextAccessToken) return true
  const expiryMs = _normalizeGeminiExpiryDateMs(expiryDate)
  if (!expiryMs) return false
  return expiryMs <= (Date.now() + Math.max(0, Number(leadTimeMs || 0)))
}

async function _refreshGeminiTokenAsync (account, accountId) {
  const refreshTokenValue = account.refresh_token
  let nextAccessToken = String(account.access_token || '').trim()
  let tokenRefreshed = false
  let nextExpiryDate = account.expiry_date || null
  let nextIdToken = account.id_token || ''
  let nextTokenType = account.token_type || 'Bearer'
  let nextScope = account.scope || ''

  if (!refreshTokenValue && !nextAccessToken) {
    const quotaError = _extractGeminiQuotaError(0, '账号无可用 access_token / refresh_token，无法刷新')
    const persisted = _persistGeminiQuotaError(accountId, quotaError)
    requestLogger.warn('gemini.token', '刷新失败：缺少 access_token 与 refresh_token', {
      account: account.email || account.id
    })
    return { success: false, error: quotaError.message, quota_error: persisted.quotaError }
  }

  try {
    const shouldRefreshToken = _shouldRefreshGeminiAccessToken(nextAccessToken, nextExpiryDate)
    if (refreshTokenValue && shouldRefreshToken) {
      const refreshed = await _refreshGeminiTokenByRefreshToken(refreshTokenValue)
      if (!refreshed.success) {
        // 检查是否需要禁用账号
        if (refreshed.should_disable_account) {
          requestLogger.warn('gemini.token', '禁用账号（Token 失效）', {
            account: account.email || account.id
          })
          storage.updateAccount(PLATFORM, accountId, {
            disabled: true,
            disabled_at: Date.now(),
            disabled_reason: refreshed.error
          })
        }
        
        if (!nextAccessToken) {
          const quotaError = _extractGeminiQuotaError(0, refreshed.error || 'Token 刷新失败')
          const persisted = _persistGeminiQuotaError(accountId, quotaError)
          return {
            success: false,
            error: quotaError.message,
            quota_error: persisted.quotaError
          }
        }
      } else {
        nextAccessToken = refreshed.access_token || nextAccessToken
        nextExpiryDate = refreshed.expiry_date || nextExpiryDate
        tokenRefreshed = true
        if (refreshed.id_token) nextIdToken = refreshed.id_token
        if (refreshed.token_type) nextTokenType = refreshed.token_type
        if (refreshed.scope) nextScope = refreshed.scope
      }
    }

    const remoteState = await _loadGeminiRemoteState(nextAccessToken, account.project_id || '')
    const updates = {
      access_token: nextAccessToken,
      expiry_date: nextExpiryDate,
      id_token: nextIdToken,
      token_type: nextTokenType,
      scope: nextScope,
      last_used: Date.now()
    }

    if (remoteState.userinfo.email) updates.email = remoteState.userinfo.email
    if (remoteState.userinfo.name) updates.name = remoteState.userinfo.name
    if (remoteState.userinfo.id) updates.auth_id = remoteState.userinfo.id
    if (remoteState.codeAssist.project_id) updates.project_id = remoteState.codeAssist.project_id
    if (remoteState.codeAssist.tier_id) updates.tier_id = remoteState.codeAssist.tier_id
    if (remoteState.codeAssist.plan_name) updates.plan_name = remoteState.codeAssist.plan_name
    if (remoteState.quota) {
      updates.quota = Object.assign({}, remoteState.quota, {
        error: null,
        error_code: '',
        invalid: false
      })
      updates.invalid = false
      updates.quota_error = null
    }

    storage.updateAccount(PLATFORM, accountId, updates)

    const hasQuotaModels = !!(remoteState.quota && Array.isArray(remoteState.quota.models) && remoteState.quota.models.length > 0)
    if (!remoteState.quota && remoteState.quotaError) {
      const quotaError = _extractGeminiQuotaError(0, remoteState.quotaError)
      const persisted = _persistGeminiQuotaError(accountId, quotaError)
      requestLogger.warn('gemini.token', '刷新成功但配额查询失败', {
        account: updates.email || account.email || account.id,
        error: quotaError.message
      })
      return {
        success: false,
        error: quotaError.message,
        quota_error: persisted.quotaError
      }
    }

    requestLogger.info('gemini.token', '刷新 Token/配额成功', {
      account: updates.email || account.email || account.id,
      tokenRefreshed,
      hasQuotaModels
    })

    return {
      success: true,
      error: null,
      quota_error: null,
      message: hasQuotaModels
        ? (tokenRefreshed ? 'Token 与配额刷新成功' : '配额刷新成功')
        : (tokenRefreshed ? 'Token 刷新成功，但未获取到配额' : '未获取到配额')
    }
  } catch (err) {
    const quotaError = _extractGeminiQuotaError(0, err && err.message ? err.message : String(err))
    const persisted = _persistGeminiQuotaError(accountId, quotaError)
    requestLogger.error('gemini.token', '刷新 Token/配额异常', {
      account: account.email || account.id,
      error: err && err.message ? err.message : String(err)
    })
    return { success: false, error: quotaError.message, quota_error: persisted.quotaError }
  }
}

function exportAccounts (accountIds) {
  return storage.exportAccounts(PLATFORM, accountIds)
}

function updateTags (accountId, tags) {
  return storage.updateAccount(PLATFORM, accountId, { tags })
}

function getPlanBadge (account) {
  const raw = (account.plan_name || account.tier_id || '').trim().toLowerCase()
  if (!raw) return 'UNKNOWN'
  if (raw.includes('ultra')) return 'ULTRA'
  if (raw.includes('pro') || raw.includes('premium') || raw.includes('business') || raw.includes('enterprise')) return 'PRO'
  if (raw.includes('free') || raw === 'standard-tier') return 'FREE'
  return 'UNKNOWN'
}

function _extractGeminiQuotaError (status, raw) {
  const shortRaw = String(raw || '').slice(0, 300)
  let code = ''
  let detailMessage = ''

  try {
    const payload = JSON.parse(String(raw || '{}'))
    const detail = payload && payload.error && typeof payload.error === 'object' ? payload.error : payload
    if (detail && typeof detail === 'object') {
      if (typeof detail.code === 'string') code = detail.code
      if (!code && typeof detail.errorCode === 'string') code = detail.errorCode
      if (typeof detail.message === 'string') detailMessage = detail.message
      if (!detailMessage && typeof detail.error === 'string') detailMessage = detail.error
    }
  } catch {}

  const normalizedCode = String(code || '').trim().toLowerCase()
  const base = Number(status || 0) > 0 ? ('API 返回 ' + Number(status || 0)) : '配额刷新失败'
  const message = normalizedCode
    ? (base + ' [error_code:' + normalizedCode + '] - ' + (detailMessage || shortRaw || '未知错误'))
    : (base + ' - ' + (detailMessage || shortRaw || '未知错误'))
  const lowerMessage = String(message || '').toLowerCase()
  const disabled = (
    normalizedCode === 'deactivated_workspace' ||
    lowerMessage.includes('deactivated_workspace') ||
    Number(status || 0) === 402 ||
    lowerMessage.includes('api 返回 402') ||
    lowerMessage.includes('api returned 402')
  )

  return {
    status: Number(status || 0),
    code: normalizedCode,
    message,
    disabled
  }
}

function _persistGeminiQuotaError (accountId, quotaError) {
  if (!accountId || !quotaError || typeof quotaError !== 'object') {
    return { quota: null, quotaError: null }
  }

  const existing = storage.getAccount(PLATFORM, accountId) || {}
  const currentQuota = (existing.quota && typeof existing.quota === 'object') ? existing.quota : {}
  const nowSec = Math.floor(Date.now() / 1000)
  const nextQuota = Object.assign({}, currentQuota, {
    error: quotaError.message || '配额刷新失败',
    error_code: quotaError.code || '',
    invalid: Boolean(quotaError.disabled),
    updated_at: nowSec
  })
  const nextQuotaError = {
    status: Number(quotaError.status || 0),
    code: quotaError.code || '',
    message: quotaError.message || '配额刷新失败',
    disabled: Boolean(quotaError.disabled),
    timestamp: nowSec
  }

  storage.updateAccount(PLATFORM, accountId, {
    quota: nextQuota,
    invalid: Boolean(quotaError.disabled),
    quota_error: nextQuotaError
  })

  return {
    quota: nextQuota,
    quotaError: nextQuotaError
  }
}

// ---- 内部工具函数 ----

function _resolveOAuthPort (port) {
  if (typeof port === 'number' && Number.isFinite(port) && port > 0 && port < 65536) {
    return Math.floor(port)
  }
  return GEMINI_OAUTH_CALLBACK_PORT
}

async function _resolveAvailableOAuthPort (port) {
  const preferredPort = _resolveOAuthPort(port)
  if (typeof port === 'number' && Number.isFinite(port) && port > 0 && port < 65536) {
    return preferredPort
  }

  const candidates = [preferredPort]
  for (let i = 1; i <= 5; i++) {
    candidates.push(preferredPort + i)
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const availablePort = await _probeLoopbackPort(candidate)
    if (availablePort > 0) return availablePort
  }

  const dynamicPort = await _probeLoopbackPort(0)
  if (dynamicPort > 0) return dynamicPort
  return preferredPort
}

function _probeLoopbackPort (port) {
  return new Promise((resolve) => {
    const net = require('net')
    const server = net.createServer()

    server.once('error', function () {
      resolve(0)
    })

    server.listen(port, '127.0.0.1', function () {
      const address = server.address()
      const availablePort = address && typeof address === 'object' ? Number(address.port || 0) : 0
      server.close(function () {
        resolve(availablePort)
      })
    })
  })
}

function _cleanupExpiredOAuthSessions () {
  storage.cleanupOAuthPending(PLATFORM, GEMINI_OAUTH_SESSION_TTL_MS)
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
    if (now - session.createdAt > GEMINI_OAUTH_SESSION_TTL_MS) {
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

async function _refreshGeminiTokenByRefreshToken (refreshTokenValue) {
  const refreshToken = String(refreshTokenValue || '').trim()
  if (!refreshToken) {
    requestLogger.warn('gemini.token', '刷新 Token 失败：缺少 refresh_token')
    return { success: false, error: '缺少 refresh_token' }
  }

  const http = require('./httpClient.cjs')
  try {
    const { clientId, clientSecret } = _resolveGeminiOAuthCredentials()
    if (!clientId) {
      return { success: false, error: _getGeminiOAuthCredentialError('刷新 Token') }
    }
    if (!clientSecret) {
      return { success: false, error: _getGeminiOAuthCredentialError('刷新 Token') }
    }
    requestLogger.info('gemini.token', '开始通过 refresh_token 刷新 Token')
    const res = await http.postForm(GOOGLE_TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })

    if (!res.ok || !res.data || !res.data.access_token) {
      const rawError = res.raw || ''
      
      // 检测 invalid_grant 错误（Token 已失效）
      if (rawError.toLowerCase().includes('invalid_grant')) {
        requestLogger.error('gemini.token', 'Token 已失效（invalid_grant），建议禁用账号', {
          account: 'unknown', // Gemini 平台没有直接的账号上下文
          should_disable_account: true
        })
        
        return {
          success: false,
          error: 'invalid_grant: Token 已失效或已被撤销',
          should_disable_account: true  // 新增标记
        }
      }
      
      requestLogger.warn('gemini.token', '通过 refresh_token 刷新 Token 失败', {
        error: 'Token 刷新失败: ' + rawError.slice(0, 240)
      })
      return {
        success: false,
        error: 'Token 刷新失败: ' + rawError.slice(0, 240)
      }
    }

    const expiresIn = Number(res.data.expires_in || 3600)
    requestLogger.info('gemini.token', '通过 refresh_token 刷新 Token 成功')
    return {
      success: true,
      access_token: res.data.access_token || '',
      id_token: res.data.id_token || '',
      token_type: res.data.token_type || 'Bearer',
      scope: res.data.scope || '',
      expiry_date: Date.now() + expiresIn * 1000
    }
  } catch (err) {
    requestLogger.error('gemini.token', '通过 refresh_token 刷新 Token 异常', {
      error: err && err.message ? err.message : String(err)
    })
    return {
      success: false,
      error: err.message || String(err)
    }
  }
}

function _buildGeminiAuthorizeUrl (redirectUri, state, clientId) {
  const resolvedClientId = String(clientId || _resolveGeminiOAuthCredentials().clientId || '').trim()
  return (
    GOOGLE_AUTH_URL +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(resolvedClientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&access_type=offline' +
    '&prompt=consent' +
    '&scope=' + encodeURIComponent(GEMINI_OAUTH_SCOPES) +
    '&state=' + encodeURIComponent(state)
  )
}

function _normalizeCallbackUrl (rawCallbackUrl, redirectUri) {
  const trimmed = (rawCallbackUrl || '').trim()
  if (!trimmed) return { ok: false, error: '回调地址不能为空' }

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return { ok: true, url: new URL(trimmed) }
    }

    const redirect = new URL(redirectUri)

    if (trimmed.startsWith('/')) {
      return { ok: true, url: new URL(redirect.origin + trimmed) }
    }

    return {
      ok: true,
      url: new URL(redirect.origin + redirect.pathname + '?' + trimmed.replace(/^\?/, ''))
    }
  } catch {
    return { ok: false, error: '请粘贴浏览器地址栏中的完整回调 URL' }
  }
}

function _validateManualCallback (callbackUrl, redirectUri, expectedState) {
  const expected = new URL(redirectUri)

  if (callbackUrl.origin !== expected.origin || callbackUrl.pathname !== expected.pathname) {
    return '回调地址必须以 ' + redirectUri + ' 开头'
  }

  const gotState = callbackUrl.searchParams.get('state') || ''
  if (gotState !== expectedState) {
    return '回调地址 state 不匹配，请重新授权'
  }

  return ''
}

async function _exchangeCodeForTokens (code, redirectUri) {
  const http = require('./httpClient.cjs')

  try {
    const { clientId, clientSecret } = _resolveGeminiOAuthCredentials()
    if (!clientId) {
      return { ok: false, error: _getGeminiOAuthCredentialError('完成 OAuth') }
    }
    if (!clientSecret) {
      return { ok: false, error: _getGeminiOAuthCredentialError('完成 OAuth') }
    }
    const res = await http.postForm(GOOGLE_TOKEN_URL, {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })

    if (!res.ok || !res.data || !res.data.access_token) {
      return {
        ok: false,
        error: 'Token 交换失败: ' + ((res.raw || '').slice(0, 240) || ('HTTP ' + res.status))
      }
    }

    const expiresIn = Number(res.data.expires_in || 3600)
    return {
      ok: true,
      tokens: {
        access_token: res.data.access_token || '',
        refresh_token: res.data.refresh_token || '',
        id_token: res.data.id_token || '',
        token_type: res.data.token_type || 'Bearer',
        scope: res.data.scope || '',
        expiry_date: Date.now() + expiresIn * 1000
      }
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

async function _fetchGoogleUserinfo (accessToken) {
  if (!accessToken) return { email: '', name: '', id: '' }

  const http = require('./httpClient.cjs')
  try {
    const res = await http.getJSON(GOOGLE_USERINFO_URL, {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/json'
    })

    if (!res.ok || !res.data) {
      return { email: '', name: '', id: '' }
    }

    return {
      email: String(res.data.email || ''),
      name: String(res.data.name || ''),
      id: String(res.data.id || '')
    }
  } catch {
    return { email: '', name: '', id: '' }
  }
}

async function _loadGeminiRemoteState (accessToken, fallbackProjectId) {
  const userinfo = await _fetchGoogleUserinfo(accessToken)
  const codeAssistRaw = await _loadCodeAssistStatus(accessToken)

  const codeAssist = Object.assign({}, codeAssistRaw)
  if (!codeAssist.project_id && fallbackProjectId) {
    codeAssist.project_id = String(fallbackProjectId || '').trim()
  }

  const quotaState = await _retrieveUserQuotaStatus(accessToken, codeAssist.project_id)

  return {
    userinfo,
    codeAssist,
    quota: quotaState.quota,
    quotaError: quotaState.error || ''
  }
}

async function _loadCodeAssistStatus (accessToken) {
  if (!accessToken) {
    return { project_id: '', tier_id: '', plan_name: '' }
  }

  const http = require('./httpClient.cjs')

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const payload = {
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI'
        }
      }

      const res = await http.postJSON(
        CODE_ASSIST_LOAD_ENDPOINT,
        {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        },
        payload
      )

      if (!res.ok || !res.data) {
        return { project_id: '', tier_id: '', plan_name: '' }
      }

      const currentTier = res.data.currentTier || {}
      const paidTier = res.data.paidTier || {}

      const tierId = String(
        paidTier.id || paidTier.quotaTier || currentTier.id || currentTier.quotaTier || ''
      ).trim()

      const planName = String(
        paidTier.name || paidTier.id || currentTier.name || currentTier.id || ''
      ).trim()

      return {
        project_id: _extractProjectId(res.data.cloudaicompanionProject || res.data.project),
        tier_id: tierId,
        plan_name: planName
      }
    } catch (err) {
      if (attempt >= 1) {
        return { project_id: '', tier_id: '', plan_name: '' }
      }
      await _sleep(180)
    }
  }

  return { project_id: '', tier_id: '', plan_name: '' }
}

async function _retrieveUserQuotaStatus (accessToken, projectId) {
  const nextAccessToken = String(accessToken || '').trim()
  const nextProjectId = String(projectId || '').trim()
  if (!nextAccessToken || !nextProjectId) {
    return { quota: null, error: '' }
  }

  const http = require('./httpClient.cjs')

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const payload = {
        project: nextProjectId
      }

      const res = await http.postJSON(
        CODE_ASSIST_QUOTA_ENDPOINT,
        {
          Authorization: 'Bearer ' + nextAccessToken,
          'Content-Type': 'application/json'
        },
        payload
      )

      if (!res.ok || !res.data) {
        return {
          quota: null,
          error: (res.raw || ('HTTP ' + res.status) || '').slice(0, 240)
        }
      }

      return {
        quota: _parseGeminiQuotaResponse(res.data),
        error: ''
      }
    } catch (err) {
      if (attempt >= 1) {
        return {
          quota: null,
          error: err.message || String(err)
        }
      }
      await _sleep(220)
    }
  }

  return { quota: null, error: '未知错误' }
}

function _sleep (ms) {
  const waitMs = Number(ms || 0)
  return new Promise((resolve) => setTimeout(resolve, waitMs > 0 ? waitMs : 0))
}

function _parseGeminiQuotaResponse (data) {
  const buckets = Array.isArray(data && data.buckets) ? data.buckets : []
  const bucketMap = new Map()

  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i] && typeof buckets[i] === 'object' ? buckets[i] : {}
    const modelId = String(bucket.modelId || '').trim()
    if (!modelId) continue

    const tokenType = String(bucket.tokenType || '').trim()
    const current = bucketMap.get(modelId)
    if (!current) {
      bucketMap.set(modelId, bucket)
      continue
    }

    const currentType = String(current.tokenType || '').trim().toUpperCase()
    const nextType = tokenType.toUpperCase()
    if (currentType !== 'REQUESTS' && nextType === 'REQUESTS') {
      bucketMap.set(modelId, bucket)
      continue
    }
    if (!_toUnixSeconds(current.resetTime) && _toUnixSeconds(bucket.resetTime)) {
      bucketMap.set(modelId, bucket)
    }
  }

  const models = Array.from(bucketMap.entries())
    .map(function (pair) {
      const modelId = pair[0]
      const bucket = pair[1] && typeof pair[1] === 'object' ? pair[1] : {}
      const remainingFraction = Number(bucket.remainingFraction)
      const remainingAmount = Number.parseInt(String(bucket.remainingAmount || '').trim(), 10)
      let percentage = 0
      if (Number.isFinite(remainingFraction)) {
        percentage = remainingFraction <= 1
          ? Math.round(Math.max(0, Math.min(1, remainingFraction)) * 100)
          : Math.round(Math.max(0, Math.min(100, remainingFraction)))
      }

      let requestsLimit = null
      if (Number.isFinite(remainingAmount) && Number.isFinite(remainingFraction) && remainingFraction > 0 && remainingFraction <= 1) {
        requestsLimit = Math.round(remainingAmount / remainingFraction)
      }

      return {
        name: modelId,
        display_name: modelId,
        percentage: percentage,
        reset_time: _toUnixSeconds(bucket.resetTime),
        requests_left: Number.isFinite(remainingAmount) ? remainingAmount : null,
        requests_limit: Number.isFinite(requestsLimit) ? requestsLimit : null,
        token_type: String(bucket.tokenType || '').trim()
      }
    })
    .sort(function (left, right) {
      return String(left.name || '').localeCompare(String(right.name || ''))
    })

  return {
    models,
    updated_at: Math.floor(Date.now() / 1000)
  }
}

function _toUnixSeconds (value) {
  if (value === null || value === undefined || value === '') return 0

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1000000000000) return Math.floor(value / 1000)
    if (value > 10000000000) return Math.floor(value / 1000)
    return Math.floor(value)
  }

  const raw = String(value).trim()
  if (!raw) return 0

  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    return _toUnixSeconds(numeric)
  }

  const parsedMs = Date.parse(raw)
  if (!Number.isFinite(parsedMs)) return 0
  return Math.floor(parsedMs / 1000)
}

function _extractProjectId (project) {
  if (project && typeof project === 'object') {
    if (typeof project.id === 'string' && project.id.trim()) {
      return project.id.trim()
    }
    if (typeof project.name === 'string' && project.name.trim()) {
      return _extractProjectId(project.name)
    }
  }

  const raw = String(project || '').trim()
  if (!raw) return ''

  const marker = 'projects/'
  const idx = raw.indexOf(marker)
  if (idx < 0) return raw

  const rest = raw.slice(idx + marker.length)
  const slash = rest.indexOf('/')
  return slash >= 0 ? rest.slice(0, slash) : rest
}

function _createGeminiAccountFromPayload (payload, addedVia) {
  const safe = payload || {}
  const idToken = safe.id_token || ''
  const accessToken = safe.access_token || ''
  const via = String(addedVia || safe.added_via || '').trim().toLowerCase()

  return {
    id: safe.id || fileUtils.generateId(),
    email: safe.email || extractEmailFromToken(idToken || accessToken) || 'unknown@gemini',
    auth_id: safe.auth_id || extractSubFromToken(idToken) || '',
    name: safe.name || '',
    access_token: accessToken,
    refresh_token: safe.refresh_token || '',
    id_token: idToken,
    token_type: safe.token_type || 'Bearer',
    scope: safe.scope || '',
    expiry_date: safe.expiry_date || null,
    selected_auth_type: safe.selected_auth_type || 'oauth-personal',
    project_id: safe.project_id || '',
    tier_id: safe.tier_id || '',
    plan_name: safe.plan_name || '',
    subscription_status: safe.subscription_status || '',
    quota: safe.quota || null,
    quota_error: safe.quota_error || null,
    tags: Array.isArray(safe.tags) ? safe.tags : [],
    created_at: safe.created_at || Date.now(),
    last_used: safe.last_used || 0,
    added_via: via,
    added_at: safe.added_at || Date.now()
  }
}

function _findGeminiAccountByLocalState (accounts, localState) {
  const accessToken = String(localState && localState.accessToken ? localState.accessToken : '').trim()
  const refreshToken = String(localState && localState.refreshToken ? localState.refreshToken : '').trim()
  const authId = String(localState && localState.authId ? localState.authId : '').trim()
  const email = String(localState && localState.email ? localState.email : '').trim().toLowerCase()

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i] || {}
    const localRefresh = String(account.refresh_token || '').trim()
    const localAccess = String(account.access_token || '').trim()
    if (refreshToken && localRefresh && refreshToken === localRefresh) return account
    if (accessToken && localAccess && accessToken === localAccess) return account
  }

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i] || {}
    const localAuthId = String(account.auth_id || '').trim()
    if (authId && localAuthId && authId === localAuthId) return account
  }

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i] || {}
    const localEmail = String(account.email || '').trim().toLowerCase()
    if (email && localEmail && email === localEmail) return account
  }

  return null
}

function _buildGeminiLocalFingerprint (localState) {
  const refreshToken = String(localState && localState.refreshToken ? localState.refreshToken : '').trim()
  const accessToken = String(localState && localState.accessToken ? localState.accessToken : '').trim()
  const authId = String(localState && localState.authId ? localState.authId : '').trim()
  const email = String(localState && localState.email ? localState.email : '').trim().toLowerCase()
  const raw = [refreshToken, accessToken, authId, email].join('|')
  if (!raw.replace(/\|/g, '')) return ''
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

function _countImportedArray (arr) {
  return Array.isArray(arr) ? arr.filter(Boolean).length : 0
}

function extractEmailFromGoogleAccounts (data) {
  if (!data) return null

  if (Array.isArray(data) && data.length > 0) {
    return data[0].email || data[0].name || null
  }

  if (typeof data.active === 'string' && data.active.trim()) {
    return data.active.trim()
  }

  if (data.email) return data.email
  return null
}

function extractEmailFromToken (token) {
  return _extractClaimFromToken(token, 'email')
}

function extractSubFromToken (token) {
  return _extractClaimFromToken(token, 'sub')
}

function _extractClaimFromToken (token, key) {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    const data = JSON.parse(decoded)
    const value = data[key]
    if (typeof value !== 'string') return null
    return value || null
  } catch {
    return null
  }
}

function normalizeAccount (raw, addedViaHint) {
  if (!raw) return null

  const tokens = raw.tokens || {}
  const accessToken = tokens.access_token || raw.access_token || ''
  const refreshToken = tokens.refresh_token || raw.refresh_token || ''
  const idToken = tokens.id_token || raw.id_token || ''

  if (!accessToken && !refreshToken) return null

  return _createGeminiAccountFromPayload({
    id: raw.id,
    email: raw.email,
    auth_id: raw.auth_id,
    name: raw.name,
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken,
    token_type: tokens.token_type || raw.token_type,
    scope: tokens.scope || raw.scope,
    expiry_date: tokens.expiry_date || raw.expiry_date,
    selected_auth_type: raw.selected_auth_type,
    project_id: raw.project_id,
    tier_id: raw.tier_id,
    plan_name: raw.plan_name,
    subscription_status: raw.subscription_status,
    quota: raw.quota,
    quota_error: raw.quota_error,
    tags: raw.tags,
    created_at: raw.created_at,
    last_used: raw.last_used,
    added_via: raw.added_via,
    added_at: raw.added_at
  }, addedViaHint)
}

function _buildGoogleAccountsWithActive (existing, email) {
  const next = {
    active: email || '',
    old: []
  }

  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const prevActive = typeof existing.active === 'string' ? existing.active.trim() : ''
    const prevOld = Array.isArray(existing.old) ? existing.old : []

    if (prevActive && prevActive !== email && !prevOld.some(item => String(item).trim() === prevActive)) {
      next.old.push(prevActive)
    }

    for (let i = 0; i < prevOld.length; i++) {
      const val = String(prevOld[i] || '').trim()
      if (!val || val === email) continue
      if (!next.old.some(item => item === val)) {
        next.old.push(val)
      }
    }
  }

  return next
}

function _readSelectedAuthTypeFromSettings (settings) {
  if (!settings || typeof settings !== 'object') return 'oauth-personal'

  if (typeof settings.selected_auth_type === 'string' && settings.selected_auth_type.trim()) {
    return settings.selected_auth_type.trim()
  }

  const nested = settings.security && settings.security.auth && settings.security.auth.selectedType
  if (typeof nested === 'string' && nested.trim()) {
    return nested.trim()
  }

  return 'oauth-personal'
}

function _writeSelectedAuthTypeToSettings (settings, selectedType) {
  const next = (settings && typeof settings === 'object' && !Array.isArray(settings))
    ? Object.assign({}, settings)
    : {}

  const val = (selectedType || 'oauth-personal').trim() || 'oauth-personal'
  next.selected_auth_type = val

  if (!next.security || typeof next.security !== 'object' || Array.isArray(next.security)) {
    next.security = {}
  }
  if (!next.security.auth || typeof next.security.auth !== 'object' || Array.isArray(next.security.auth)) {
    next.security.auth = {}
  }
  next.security.auth.selectedType = val

  return next
}

function _pickExistingPath (paths) {
  for (let i = 0; i < paths.length; i++) {
    const candidate = String(paths[i] || '').trim()
    if (!candidate) continue
    if (fileUtils.fileExists(candidate)) return candidate
  }
  return ''
}

function _pickExistingDir (paths) {
  for (let i = 0; i < paths.length; i++) {
    const candidate = String(paths[i] || '').trim()
    if (!candidate) continue
    if (fileUtils.dirExists(candidate)) return candidate
  }
  return ''
}

function _pushUniquePath (arr, val) {
  const next = String(val || '').trim()
  if (!next) return
  if (arr.indexOf(next) >= 0) return
  arr.push(next)
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

function _resolveUserPath (rawPath) {
  const value = String(rawPath || '').trim()
  if (!value) return value
  if (value === '~') return fileUtils.getHomeDir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(fileUtils.getHomeDir(), value.slice(2))
  }
  return value
}

/**
 * 批量刷新配额 (带并发控制)
 * @param {string[]} accountIds - 账号 ID 列表
 * @param {object} options - 选项
 * @param {number} options.concurrency - 并发数 (默认 5)
 * @param {number} options.delayMs - 请求间隔 (默认 200ms，避免触发限流)
 * @param {function} options.onProgress - 进度回调
 * @returns {Promise<Array<{id: string, success: boolean, error?: string}>>}
 */
async function refreshQuotasBatch (accountIds, options = {}) {
  const {
    concurrency = 5,
    delayMs = 200,
    onProgress = null
  } = options

  const { Semaphore } = require('./utils/semaphore.cjs')
  const semaphore = new Semaphore(concurrency)
  let completed = 0

  const tasks = accountIds.map(async (accountId) => {
    await semaphore.acquire()

    try {
      const account = storage.getAccount(PLATFORM, accountId)
      if (!account) {
        return { id: accountId, success: false, error: '账号不存在' }
      }

      const result = await _refreshGeminiTokenAsync(account, accountId)
      completed++

      onProgress?.({ completed, total: accountIds.length, accountId, result })

      // 添加延迟，避免触发 Google API 限流
      if (delayMs > 0 && completed < accountIds.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      return { id: accountId, success: result.success, ...result }
    } catch (err) {
      completed++
      onProgress?.({ completed, total: accountIds.length, accountId, error: err.message })
      return { id: accountId, success: false, error: err.message }
    } finally {
      semaphore.release()
    }
  })

  return Promise.all(tasks)
}

function _randomBase64Url () {
  const base64 = crypto.randomBytes(24).toString('base64')
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
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
  completeOAuthSession,
  getOAuthSessionStatus,
  cancelOAuthSession,
  getPendingOAuthSession,
  savePendingOAuthSession,
  clearPendingOAuthSession,
  openExternalUrl,
  inject,
  activateAccount,
  deleteAccount,
  deleteAccounts,
  refreshToken,
  refreshQuotaOrUsage,
  shouldRefreshAccessTokenByExpiry: _shouldRefreshGeminiAccessToken,
  exportAccounts,
  updateTags,
  getPlanBadge,
  getConfigDir,
  getConfigDirCandidates,
  getLocalStateFilePaths,
  getLocalStateWatchTargets,
  refreshQuotasBatch // 新增批量刷新
}
