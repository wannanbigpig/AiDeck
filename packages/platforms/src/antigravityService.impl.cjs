/**
 * antigravityService.js — Antigravity 账号管理服务
 *
 * 数据存储位置：
 *   - Aideck 平台数据：~/.ai_deck/antigravity/
 *   - 官方客户端登录态探测：Antigravity 的 state.vscdb
 *
 * 核心能力：
 *   - 账号导入（本地 / JSON）
 *   - 账号切换（写入平台运行态文件）
 *   - 配额查询
 */

const cp = require('child_process')
const crypto = require('crypto')
const path = require('path')
const http = require('http')
const { retryOAuthRequest } = require('./utils/retryOAuthRequest')
const fileUtils = require('../../infra-node/src/fileUtils.cjs')
const storage = require('../../infra-node/src/accountStorage.cjs')
const requestLogger = require('../../infra-node/src/requestLogStore.cjs')
const sharedSettingsStore = require('../../infra-node/src/sharedSettingsStore.cjs')

const PLATFORM = 'antigravity'
const DEFAULT_ADVANCED_SETTINGS = {
  startupPath: '',
  oauthClientId: '',
  oauthClientSecret: '',
  autoRestartAntigravityApp: false,
  autoStartAntigravityAppWhenClosed: false
}

// Google Cloud Code API（配额查询）
const CLOUD_CODE_BASE_URL = 'https://cloudcode-pa.googleapis.com'
const LOAD_CODE_ASSIST_PATH = 'v1internal:loadCodeAssist'
const FETCH_MODELS_PATH = 'v1internal:fetchAvailableModels'

// Antigravity OAuth2 凭证
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const ANTIGRAVITY_CLIENT_ID = String(
  process.env.ANTIGRAVITY_CLIENT_ID ||
  '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
).trim()
const ANTIGRAVITY_CLIENT_SECRET = String(
  process.env.ANTIGRAVITY_CLIENT_SECRET ||
  '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'
).trim()
const ANTIGRAVITY_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ')
const ANTIGRAVITY_OAUTH_CALLBACK_PORT = 1456
const ANTIGRAVITY_OAUTH_CALLBACK_PATH = '/auth/callback'
const ANTIGRAVITY_OAUTH_SESSION_TTL_MS = 10 * 60 * 1000
const LOCAL_SYNC_IMPORT_COOLDOWN_MS = 30 * 1000
const DEVICE_ORIGINAL_FILE = 'device_original.json'
const SERVICE_MACHINE_ID_KEY = 'storage.serviceMachineId'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const oauthSessions = new Map()
const localSyncState = {
  lastFingerprint: '',
  lastAttemptAt: 0
}
const AUTO_SOURCE_TAG_TO_VIA = {
  本地数据库导入: 'local',
  本地导入: 'local',
  JSON导入: 'json',
  JSON导入账号: 'json',
  'OAuth授权': 'oauth',
  'OAuth 授权': 'oauth',
  Token导入: 'token',
  'Token 导入': 'token',
  索引导入: 'json'
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

function getAntigravityAppPathCandidates (runtime) {
  const platform = _resolveRuntimePlatform(runtime)
  const env = _resolveRuntimeEnv(runtime)
  const homeDir = _resolveRuntimeHomeDir(runtime)
  const candidates = []

  if (platform === 'darwin') {
    _pushUniquePath(candidates, '/Applications/Antigravity.app')
    _pushUniquePath(candidates, '/Applications/Antigravity Beta.app')
    _pushUniquePath(candidates, path.join(homeDir, 'Applications', 'Antigravity.app'))
    _pushUniquePath(candidates, path.join(homeDir, 'Applications', 'Antigravity Beta.app'))
    return candidates
  }

  if (platform === 'win32') {
    const localAppData = String(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')).trim()
    const programFiles = String(env.ProgramFiles || 'C:\\Program Files').trim()
    const programFilesX86 = String(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').trim()
    _pushUniquePath(candidates, path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'))
    _pushUniquePath(candidates, path.join(programFiles, 'Antigravity', 'Antigravity.exe'))
    _pushUniquePath(candidates, path.join(programFilesX86, 'Antigravity', 'Antigravity.exe'))
    return candidates
  }

  _pushUniquePath(candidates, '/usr/bin/antigravity')
  _pushUniquePath(candidates, '/usr/local/bin/antigravity')
  _pushUniquePath(candidates, '/opt/Antigravity/antigravity')
  _pushUniquePath(candidates, path.join(homeDir, '.local', 'bin', 'antigravity'))
  return candidates
}

function getDefaultAntigravityAppPath (runtime) {
  const detected = detectAntigravityAppPath('', runtime)
  if (detected) return detected
  return getAntigravityAppPathCandidates(runtime)[0] || ''
}

function getStoragePathCandidates (runtime) {
  const platform = _resolveRuntimePlatform(runtime)
  const env = _resolveRuntimeEnv(runtime)
  const homeDir = _resolveRuntimeHomeDir(runtime)
  const candidates = []

  if (platform === 'darwin') {
    _pushUniquePath(candidates, path.join(homeDir, 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage', 'storage.json'))
    return candidates
  }

  if (platform === 'win32') {
    const roaming = String(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')).trim()
    _pushUniquePath(candidates, path.join(roaming, 'Antigravity', 'User', 'globalStorage', 'storage.json'))
    return candidates
  }

  const xdgConfigHome = String(env.XDG_CONFIG_HOME || '').trim()
  if (xdgConfigHome) {
    _pushUniquePath(candidates, path.join(xdgConfigHome, 'Antigravity', 'User', 'globalStorage', 'storage.json'))
  }
  _pushUniquePath(candidates, path.join(homeDir, '.config', 'Antigravity', 'User', 'globalStorage', 'storage.json'))
  return candidates
}

function getMachineIdPathCandidates (runtime) {
  const platform = _resolveRuntimePlatform(runtime)
  const env = _resolveRuntimeEnv(runtime)
  const homeDir = _resolveRuntimeHomeDir(runtime)
  const candidates = []

  if (platform === 'darwin') {
    _pushUniquePath(candidates, path.join(homeDir, 'Library', 'Application Support', 'Antigravity', 'machineid'))
    return candidates
  }

  if (platform === 'win32') {
    const roaming = String(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')).trim()
    _pushUniquePath(candidates, path.join(roaming, 'Antigravity', 'machineid'))
    return candidates
  }

  const xdgConfigHome = String(env.XDG_CONFIG_HOME || '').trim()
  if (xdgConfigHome) {
    _pushUniquePath(candidates, path.join(xdgConfigHome, 'Antigravity', 'machineid'))
  }
  _pushUniquePath(candidates, path.join(homeDir, '.config', 'Antigravity', 'machineid'))
  return candidates
}

function getStateDbPathCandidates (runtime) {
  const platform = _resolveRuntimePlatform(runtime)
  const env = _resolveRuntimeEnv(runtime)
  const homeDir = _resolveRuntimeHomeDir(runtime)
  const candidates = []

  if (platform === 'darwin') {
    _pushUniquePath(candidates, path.join(homeDir, 'Library', 'Application Support', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'))
    return candidates
  }

  if (platform === 'win32') {
    const roaming = String(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')).trim()
    _pushUniquePath(candidates, path.join(roaming, 'Antigravity', 'User', 'globalStorage', 'state.vscdb'))
    return candidates
  }

  const xdgConfigHome = String(env.XDG_CONFIG_HOME || '').trim()
  if (xdgConfigHome) {
    _pushUniquePath(candidates, path.join(xdgConfigHome, 'Antigravity', 'User', 'globalStorage', 'state.vscdb'))
  }
  _pushUniquePath(candidates, path.join(homeDir, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb'))
  return candidates
}

function getLocalStatePaths (runtime) {
  return {
    storagePath: _pickExistingPath(getStoragePathCandidates(runtime)) || getStoragePathCandidates(runtime)[0] || '',
    machineIdPath: _pickExistingPath(getMachineIdPathCandidates(runtime)) || getMachineIdPathCandidates(runtime)[0] || '',
    stateDbPath: _pickExistingPath(getStateDbPathCandidates(runtime)) || getStateDbPathCandidates(runtime)[0] || ''
  }
}

function getLocalStateWatchTargets (runtime) {
  const dirPaths = getStateDbPathCandidates(runtime).map(item => path.dirname(item))
  return {
    dirPaths: _uniquePathList(dirPaths),
    fileNames: ['state.vscdb'],
    watchWholeDir: true,
    fallbackPaths: _getParentDirs(dirPaths)
  }
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

function _inferAntigravityAddedVia (account) {
  const explicit = String(account && account.added_via ? account.added_via : '').trim().toLowerCase()
  if (explicit) return explicit
  const tags = Array.isArray(account && account.tags) ? account.tags : []
  for (let i = 0; i < tags.length; i++) {
    const via = _resolveAutoSourceViaByTag(tags[i])
    if (via) return via
  }
  return ''
}

function _stampPluginAddedMeta (account, addedVia) {
  if (!account || typeof account !== 'object') return account
  const via = String(addedVia || '').trim().toLowerCase()
  if (via) {
    account.added_via = via
  }
  account.added_at = Date.now()
  return account
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
    redirectUri: String(saved.redirectUri || '').trim(),
    authUrl: String(saved.authUrl || '').trim(),
    callbackUrl: String(saved.callbackUrl || '').trim(),
    createdAt: Number(saved.createdAt || 0) || Date.now(),
    completedAt: Number(saved.completedAt || 0) || 0
  }
  if (!session.state || !session.redirectUri) return null
  oauthSessions.set(sid, session)
  return session
}

function getPendingOAuthSession (sessionId) {
  if (sessionId) {
    return storage.getOAuthPending(PLATFORM, sessionId)
  }
  return storage.getLatestOAuthPending(PLATFORM, ANTIGRAVITY_OAUTH_SESSION_TTL_MS)
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

function getPlatformDataDir () {
  return storage.getPlatformDataDir(PLATFORM)
}

function getConfigDir () {
  return path.join(fileUtils.getHomeDir(), '.antigravity')
}

function getPlatformAccountsDir () {
  return path.join(getPlatformDataDir(), 'accounts')
}

function getPlatformTokenPath () {
  return path.join(getPlatformDataDir(), 'token.json')
}

function getPlatformOriginalDevicePath () {
  return path.join(getPlatformDataDir(), DEVICE_ORIGINAL_FILE)
}

function _getAntigravityStoragePath () {
  return getLocalStatePaths().storagePath
}

function _getAntigravityMachineIdPath () {
  return getLocalStatePaths().machineIdPath
}

function _randomHex (length) {
  const size = Math.max(1, Math.ceil(Number(length || 0) / 2))
  return crypto.randomBytes(size).toString('hex').slice(0, Math.max(0, Number(length || 0)))
}

function _generateUuid () {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const buf = crypto.randomBytes(16)
  buf[6] = (buf[6] & 0x0f) | 0x40
  buf[8] = (buf[8] & 0x3f) | 0x80
  const hex = buf.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-')
}

function _generateMachineId () {
  return 'auth0|user_' + _randomHex(32)
}

function _generateSqmId () {
  return '{' + _generateUuid().toUpperCase() + '}'
}

function _validateServiceMachineId (value) {
  const raw = String(value || '').trim()
  return UUID_RE.test(raw) ? raw : ''
}

function _normalizeDeviceProfile (raw, options = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const allowGenerate = options.allowGenerate !== false

  const machineId = String(source.machine_id || source.machineId || '').trim() || (allowGenerate ? _generateMachineId() : '')
  const macMachineId = String(source.mac_machine_id || source.macMachineId || '').trim() || (allowGenerate ? _generateUuid() : '')
  const devDeviceId = String(source.dev_device_id || source.devDeviceId || '').trim() || (allowGenerate ? _generateUuid() : '')
  const sqmId = String(source.sqm_id || source.sqmId || '').trim() || (allowGenerate ? _generateSqmId() : '')
  const serviceMachineId = _validateServiceMachineId(source.service_machine_id || source.serviceMachineId) || (allowGenerate ? _getServiceMachineId() : '')

  if (!machineId || !macMachineId || !devDeviceId || !sqmId || !serviceMachineId) {
    return null
  }

  return {
    machine_id: machineId,
    mac_machine_id: macMachineId,
    dev_device_id: devDeviceId,
    sqm_id: sqmId,
    service_machine_id: serviceMachineId
  }
}

function _generateDeviceProfile () {
  return _normalizeDeviceProfile({}, { allowGenerate: true })
}

function _readMachineIdFile () {
  return _validateServiceMachineId(fileUtils.readTextFile(_getAntigravityMachineIdPath()))
}

function _writeMachineIdFile (serviceMachineId) {
  const normalized = _validateServiceMachineId(serviceMachineId)
  if (!normalized) return false
  return fileUtils.writeTextFile(_getAntigravityMachineIdPath(), normalized)
}

function _readStateServiceMachineIdValue () {
  const dbPath = _getAntigravityStateDbPath()
  if (!fileUtils.fileExists(dbPath)) return ''
  try {
    const output = cp.execFileSync(
      'sqlite3',
      [dbPath, "SELECT value FROM ItemTable WHERE key = '" + SERVICE_MACHINE_ID_KEY + "' LIMIT 1;"],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return _validateServiceMachineId(output)
  } catch {
    return ''
  }
}

function _syncStateServiceMachineIdValue (serviceMachineId) {
  const normalized = _validateServiceMachineId(serviceMachineId)
  if (!normalized) return { success: false, error: 'serviceMachineId 无效' }

  const dbPath = _getAntigravityStateDbPath()
  fileUtils.ensureDir(path.dirname(dbPath))

  try {
    _execSqliteStatement(dbPath, [
      'CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT);',
      "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('" + SERVICE_MACHINE_ID_KEY + "', '" + _escapeSqliteString(normalized) + "');"
    ].join(' '))
    return { success: true }
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    if (message.includes('系统未找到 sqlite3')) {
      return { success: false, error: '系统未找到 sqlite3，已跳过 state.vscdb 同步' }
    }
    return { success: false, error: message }
  }
}

function _getServiceMachineId () {
  const fromDb = _readStateServiceMachineIdValue()
  if (fromDb) return fromDb

  const fromFile = _readMachineIdFile()
  if (fromFile) {
    _syncStateServiceMachineIdValue(fromFile)
    return fromFile
  }

  const generated = _generateUuid()
  _writeMachineIdFile(generated)
  _syncStateServiceMachineIdValue(generated)
  return generated
}

function _readStorageJsonForDeviceProfile () {
  const storagePath = _getAntigravityStoragePath()
  const raw = fileUtils.readTextFile(storagePath)
  if (raw === null) {
    return { exists: false, json: {}, storagePath }
  }
  const trimmed = String(raw).trim()
  if (!trimmed) {
    return { exists: true, json: {}, storagePath }
  }
  try {
    const json = JSON.parse(trimmed)
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return { exists: true, error: 'storage.json 顶层不是对象', json: null, storagePath }
    }
    return { exists: true, json, storagePath }
  } catch (err) {
    return {
      exists: true,
      error: '解析 storage.json 失败: ' + (err && err.message ? err.message : String(err)),
      json: null,
      storagePath
    }
  }
}

function _extractStorageTelemetryField (json, key) {
  if (!json || typeof json !== 'object') return ''
  const telemetry = json.telemetry
  if (telemetry && typeof telemetry === 'object' && !Array.isArray(telemetry)) {
    const nested = telemetry[key]
    if (typeof nested === 'string' && nested.trim()) {
      return nested.trim()
    }
  }
  const flat = json['telemetry.' + key]
  if (typeof flat === 'string' && flat.trim()) {
    return flat.trim()
  }
  return ''
}

function _captureCurrentDeviceProfile (options = {}) {
  const result = _readStorageJsonForDeviceProfile()
  if (result.error) {
    return { success: false, error: result.error, profile: null }
  }

  if (!result.exists) {
    if (options.allowGenerateFallback) {
      return { success: true, profile: _generateDeviceProfile(), source: 'generated' }
    }
    return { success: false, error: '未找到 Antigravity storage.json', profile: null }
  }

  const normalized = _normalizeDeviceProfile({
    machine_id: _extractStorageTelemetryField(result.json, 'machineId'),
    mac_machine_id: _extractStorageTelemetryField(result.json, 'macMachineId'),
    dev_device_id: _extractStorageTelemetryField(result.json, 'devDeviceId'),
    sqm_id: _extractStorageTelemetryField(result.json, 'sqmId'),
    service_machine_id: _getServiceMachineId()
  }, { allowGenerate: true })

  if (!normalized) {
    return { success: false, error: '当前设备身份数据无效', profile: null }
  }

  if (options.autofillMissing) {
    const writeResult = _applyDeviceProfile(normalized)
    if (!writeResult.success) {
      return { success: false, error: writeResult.error, profile: null }
    }
  }

  return { success: true, profile: normalized, source: 'captured' }
}

function _loadOriginalDeviceProfile () {
  return _normalizeDeviceProfile(fileUtils.readJsonFile(getPlatformOriginalDevicePath()), { allowGenerate: false })
}

function _saveOriginalDeviceProfile (profile) {
  const normalized = _normalizeDeviceProfile(profile, { allowGenerate: false })
  if (!normalized) return false
  return fileUtils.writeJsonFile(getPlatformOriginalDevicePath(), normalized)
}

function _ensureOriginalDeviceProfileCaptured () {
  const existing = _loadOriginalDeviceProfile()
  if (existing) return existing
  const captured = _captureCurrentDeviceProfile({ autofillMissing: false, allowGenerateFallback: false })
  if (!captured.success || !captured.profile) return null
  _saveOriginalDeviceProfile(captured.profile)
  return captured.profile
}

function _bindDeviceProfileToAccount (account, options = {}) {
  const normalizedExisting = _normalizeDeviceProfile(account && account.device_profile, { allowGenerate: false })
  if (normalizedExisting) {
    return {
      account: Object.assign({}, account, {
        device_profile: normalizedExisting,
        device_profile_source: String(account.device_profile_source || '').trim() || 'imported'
      }),
      profile: normalizedExisting,
      changed: false
    }
  }

  let resolved = null
  if (options.captureCurrent) {
    if (options.captureOriginalBaseline !== false) {
      _ensureOriginalDeviceProfileCaptured()
    }
    const captured = _captureCurrentDeviceProfile({ autofillMissing: true, allowGenerateFallback: true })
    if (captured.success && captured.profile) {
      resolved = {
        profile: captured.profile,
        source: captured.source || 'captured'
      }
    }
  }

  if (!resolved) {
    resolved = {
      profile: _generateDeviceProfile(),
      source: options.defaultSource || 'generated'
    }
  }

  return {
    account: Object.assign({}, account, {
      device_profile: resolved.profile,
      device_profile_source: resolved.source
    }),
    profile: resolved.profile,
    changed: true
  }
}

function _applyDeviceProfile (profile) {
  const normalized = _normalizeDeviceProfile(profile, { allowGenerate: true })
  if (!normalized) {
    return { success: false, error: '设备身份数据无效' }
  }

  const readResult = _readStorageJsonForDeviceProfile()
  if (readResult.error) {
    return { success: false, error: readResult.error }
  }

  const json = readResult.json && typeof readResult.json === 'object' && !Array.isArray(readResult.json)
    ? Object.assign({}, readResult.json)
    : {}

  const telemetry = json.telemetry && typeof json.telemetry === 'object' && !Array.isArray(json.telemetry)
    ? Object.assign({}, json.telemetry)
    : {}

  telemetry.machineId = normalized.machine_id
  telemetry.macMachineId = normalized.mac_machine_id
  telemetry.devDeviceId = normalized.dev_device_id
  telemetry.sqmId = normalized.sqm_id
  json.telemetry = telemetry

  json['telemetry.machineId'] = normalized.machine_id
  json['telemetry.macMachineId'] = normalized.mac_machine_id
  json['telemetry.devDeviceId'] = normalized.dev_device_id
  json['telemetry.sqmId'] = normalized.sqm_id

  const storagePath = readResult.storagePath
  fileUtils.ensureDir(path.dirname(storagePath))
  if (!fileUtils.writeJsonFile(storagePath, json)) {
    return { success: false, error: '写入 storage.json 失败' }
  }

  if (!_writeMachineIdFile(normalized.service_machine_id)) {
    return { success: false, error: '写入 machineid 失败' }
  }

  const syncResult = _syncStateServiceMachineIdValue(normalized.service_machine_id)
  return {
    success: true,
    warning: syncResult.success ? '' : syncResult.error
  }
}

/**
 * 列出所有 Antigravity 账号
 * @returns {Array}
 */
function list () {
  const accounts = storage.listAccounts(PLATFORM)
  if (!Array.isArray(accounts) || accounts.length === 0) return []

  let changed = false
  const hydratedAccounts = accounts.map((account) => {
    if (!account || typeof account !== 'object') return account

    let nextAccount = account
    const updates = {}

    const cleanedTags = _stripAutoSourceTags(account.tags)
    if (!_sameTagList(account.tags, cleanedTags)) {
      updates.tags = cleanedTags
    }

    const addedVia = _inferAntigravityAddedVia(account)
    if (!String(account.added_via || '').trim() && addedVia) {
      updates.added_via = addedVia
    }

    const addedAt = Number(account.added_at || 0)
    const createdAt = Number(account.created_at || 0)
    if (!(addedAt > 0) && createdAt > 0) {
      updates.added_at = createdAt
    }

    if (Object.keys(updates).length > 0) {
      nextAccount = Object.assign({}, nextAccount, updates)
      changed = true
    }

    const normalizedQuota = _normalizeQuotaShape(account.quota)
    if (normalizedQuota && normalizedQuota !== account.quota) {
      nextAccount = Object.assign({}, nextAccount, { quota: normalizedQuota })
      changed = true
    }

    const hasToken = !!(nextAccount.token && (nextAccount.token.access_token || nextAccount.token.refresh_token))
    const hasQuotaModels = !!(nextAccount.quota && Array.isArray(nextAccount.quota.models) && nextAccount.quota.models.length > 0)
    if (hasToken && hasQuotaModels) return nextAccount

    const hydrated = _hydrateAccountFromLocalFiles(nextAccount)
    if (!hydrated.updated) return nextAccount

    changed = true
    return Object.assign({}, nextAccount, hydrated.updates)
  })

  if (changed) {
    storage.saveAccounts(PLATFORM, hydratedAccounts)
    return hydratedAccounts
  }

  return accounts
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
    const dbPath = _getAntigravityStateDbPath()
    if (!fileUtils.fileExists(dbPath)) {
      return { success: true, hasLocalState: false, imported: false, matchedId: null, email: '', account: null }
    }

    const legacyState = _queryStateDbValue(dbPath, 'jetskiStateSync.agentManagerInitState')
    const unifiedState = _queryStateDbValue(dbPath, 'antigravityUnifiedStateSync.oauthToken')
    let tokenPayload = _extractTokensFromLegacyState(legacyState)
    if (!tokenPayload) {
      tokenPayload = _extractTokensFromUnifiedState(unifiedState)
    }

    if (!tokenPayload || (!tokenPayload.refresh_token && !tokenPayload.access_token)) {
      return { success: true, hasLocalState: false, imported: false, matchedId: null, email: '', account: null }
    }

    const refreshToken = String(tokenPayload.refresh_token || '').trim()
    const accessToken = String(tokenPayload.access_token || '').trim()
    const localDetail = _findLocalAccountDetailByToken(refreshToken, accessToken)
    const localEmail = String(
      (localDetail && localDetail.email) || _extractEmailFromToken(accessToken) || ''
    ).trim().toLowerCase()
    const localProjectId = String(
      (localDetail && localDetail.token && localDetail.token.project_id) || ''
    ).trim()

    const accounts = storage.listAccounts(PLATFORM)
    const matched = _findAntigravityAccountByLocalState(accounts, {
      refreshToken,
      accessToken,
      email: localEmail,
      projectId: localProjectId
    })

    return {
      success: true,
      hasLocalState: true,
      imported: !!matched,
      matchedId: matched ? matched.id : null,
      email: localEmail || (matched && matched.email) || '',
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
    const dbPath = _getAntigravityStateDbPath()
    if (!fileUtils.fileExists(dbPath)) {
      return { success: true, changed: false, currentId: storage.getCurrentId(PLATFORM) || null }
    }

    const legacyState = _queryStateDbValue(dbPath, 'jetskiStateSync.agentManagerInitState')
    const unifiedState = _queryStateDbValue(dbPath, 'antigravityUnifiedStateSync.oauthToken')

    let tokenPayload = _extractTokensFromLegacyState(legacyState)
    if (!tokenPayload) {
      tokenPayload = _extractTokensFromUnifiedState(unifiedState)
    }

    const previousId = storage.getCurrentId(PLATFORM)
    if (!tokenPayload || (!tokenPayload.refresh_token && !tokenPayload.access_token)) {
      if (previousId) {
        storage.clearCurrentId(PLATFORM)
        return { success: true, changed: true, currentId: null, account: null }
      }
      return { success: true, changed: false, currentId: null, account: null }
    }

    const refreshToken = String(tokenPayload.refresh_token || '').trim()
    const accessToken = String(tokenPayload.access_token || '').trim()
    const localDetail = _findLocalAccountDetailByToken(refreshToken, accessToken)
    const localEmail = String(
      (localDetail && localDetail.email) || _extractEmailFromToken(accessToken) || ''
    ).trim().toLowerCase()
    const localProjectId = String(
      (localDetail && localDetail.token && localDetail.token.project_id) || ''
    ).trim()

    let accounts = storage.listAccounts(PLATFORM)
    let matched = _findAntigravityAccountByLocalState(accounts, {
      refreshToken,
      accessToken,
      email: localEmail,
      projectId: localProjectId
    })
    let importedAny = false

    if (!matched && allowAutoImport) {
      const fingerprint = _buildAntigravityLocalFingerprint({
        refreshToken,
        accessToken,
        email: localEmail,
        projectId: localProjectId
      })
      if (_shouldTryAutoImportByFingerprint(fingerprint)) {
        const imported = await importFromLocal()
        importedAny = _countImportedArray(imported && imported.imported) > 0
        if (importedAny) {
          accounts = storage.listAccounts(PLATFORM)
          matched = _findAntigravityAccountByLocalState(accounts, {
            refreshToken,
            accessToken,
            email: localEmail,
            projectId: localProjectId
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

/**
 * 从本机 Antigravity 客户端本地数据库导入当前登录账号
 * 数据源固定：state.vscdb
 * @returns {Promise<{ imported: Array, error: string|null }>}
 */
async function importFromLocal () {
  try {
    const dbPath = _getAntigravityStateDbPath()
    if (!fileUtils.fileExists(dbPath)) {
      return { imported: [], error: '未找到 Antigravity 本地数据库: ' + dbPath }
    }

    const legacyState = _queryStateDbValue(dbPath, 'jetskiStateSync.agentManagerInitState')
    const unifiedState = _queryStateDbValue(dbPath, 'antigravityUnifiedStateSync.oauthToken')

    let tokenPayload = _extractTokensFromLegacyState(legacyState)
    if (!tokenPayload) {
      tokenPayload = _extractTokensFromUnifiedState(unifiedState)
    }
    if (!tokenPayload || !tokenPayload.refresh_token) {
      return { imported: [], error: '未在本机数据库中找到有效登录状态，请先在 Antigravity 客户端登录' }
    }

    let accessToken = tokenPayload.access_token || ''
    const refreshToken = tokenPayload.refresh_token || ''
    const tokenType = tokenPayload.token_type || 'Bearer'
    const nowSec = Math.floor(Date.now() / 1000)
    let expiresIn = Number(tokenPayload.expires_in || 0) || 0
    let expiryTimestamp = Number(tokenPayload.expiry_timestamp || 0) || 0
    const warnings = []

    if (!accessToken || (expiryTimestamp > 0 && expiryTimestamp < nowSec + 120)) {
      const refreshed = await _refreshAntigravityToken(refreshToken)
      if (refreshed.ok && refreshed.access_token) {
        accessToken = refreshed.access_token
        expiresIn = Number(refreshed.expires_in || 3600) || 3600
        expiryTimestamp = nowSec + Math.max(0, expiresIn)
      } else if (!accessToken) {
        return { imported: [], error: 'refresh_token 刷新 access_token 失败: ' + (refreshed.error || '未知错误') }
      } else {
        warnings.push('刷新 Token 失败，已使用现有 access_token 继续导入: ' + (refreshed.error || '未知错误'))
      }
    }

    const localDetail = _findLocalAccountDetailByToken(refreshToken, accessToken)
    const userInfo = accessToken ? await _fetchGoogleUserinfo(accessToken) : {}
    const codeAssistState = accessToken
      ? await _loadAntigravityCodeAssist(accessToken, String((localDetail && localDetail.token && localDetail.token.project_id) || '').trim())
      : { project_id: '', subscription_tier: '', credits: [], error: '' }
    if (!userInfo.email) {
      const extractedEmail = _extractEmailFromToken(accessToken)
      if (extractedEmail) userInfo.email = extractedEmail
    }
    const importedQuota = _normalizeQuotaShape(localDetail && localDetail.quota ? localDetail.quota : null)
    const quotaPatch = {}
    if (String(codeAssistState.subscription_tier || '').trim()) {
      quotaPatch.subscription_tier = String(codeAssistState.subscription_tier || '').trim()
    }
    if (Array.isArray(codeAssistState.credits) && codeAssistState.credits.length > 0) {
      quotaPatch.credits = codeAssistState.credits
    }
    const mergedQuota = Object.keys(quotaPatch).length > 0
      ? (_normalizeQuotaShape(Object.assign({}, importedQuota || {}, quotaPatch)) || Object.assign({}, importedQuota || {}, quotaPatch))
      : importedQuota
    const account = {
      id: fileUtils.generateId(),
      email: userInfo.email || (localDetail && localDetail.email) || 'local@antigravity',
      name: userInfo.name || (localDetail && localDetail.name) || '',
      tags: [],
      token: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiresIn > 0 ? expiresIn : Number((localDetail && localDetail.token && localDetail.token.expires_in) || 0) || 3600,
        expiry_timestamp: expiryTimestamp > 0
          ? expiryTimestamp
          : (Number((localDetail && localDetail.token && localDetail.token.expiry_timestamp) || 0) || (nowSec + 3600)),
        token_type: tokenType,
        project_id: String((localDetail && localDetail.token && localDetail.token.project_id) || codeAssistState.project_id || '').trim()
      },
      quota: mergedQuota,
      created_at: Date.now(),
      last_used: 0
    }
    _stampPluginAddedMeta(account, 'local')

    const prepared = _bindDeviceProfileToAccount(account, {
      captureCurrent: true,
      defaultSource: 'captured'
    }).account
    const saved = storage.addAccount(PLATFORM, prepared)
    if (saved && saved.id) {
      storage.setCurrentId(PLATFORM, saved.id)
    }
    return {
      imported: [saved || account],
      error: null,
      warning: [warnings.length > 0 ? warnings.join('；') : '', codeAssistState.error || ''].filter(Boolean).join('；') || null
    }
  } catch (err) {
    return { imported: [], error: err.message || String(err) }
  }
}

function _getAntigravityStateDbPath () {
  return getLocalStatePaths().stateDbPath
}

function _queryStateDbValue (dbPath, key) {
  if (!dbPath || !key) return ''
  const safeKey = _escapeSqliteString(key)
  const sql = "SELECT value FROM ItemTable WHERE key = '" + safeKey + "' LIMIT 1;"

  try {
    const output = _execSqliteStatement(dbPath, sql)
    return String(output || '').trim()
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    if (message.includes('系统未找到 sqlite3')) {
      throw new Error('系统未找到 sqlite3 命令，无法读取 Antigravity 本地数据库')
    }
    throw new Error('读取 Antigravity 本地数据库失败: ' + message)
  }
}

function _extractTokensFromLegacyState (encodedValue) {
  const payload = _decodeBase64Safe(encodedValue)
  if (!payload || payload.length === 0) return null

  const oauthInfo = _extractLenDelimitedField(payload, 6)
  if (!oauthInfo || oauthInfo.length === 0) return null
  return _extractTokenPayloadFromOauthInfo(oauthInfo)
}

function _extractTokensFromUnifiedState (encodedValue) {
  const outer = _decodeBase64Safe(encodedValue)
  if (!outer || outer.length === 0) return null

  const inner = _extractLenDelimitedField(outer, 1)
  if (!inner || inner.length === 0) return null

  const inner2 = _extractLenDelimitedField(inner, 2)
  if (!inner2 || inner2.length === 0) return null

  const oauthInfoBase64 = _extractStringField(inner2, 1)
  const oauthInfo = _decodeBase64Safe(oauthInfoBase64)
  if (!oauthInfo || oauthInfo.length === 0) return null

  return _extractTokenPayloadFromOauthInfo(oauthInfo)
}

function _extractTokenPayloadFromOauthInfo (oauthInfo) {
  const accessToken = _extractStringField(oauthInfo, 1)
  const tokenType = _extractStringField(oauthInfo, 2)
  const refreshToken = _extractStringField(oauthInfo, 3)
  const expiryMsg = _extractLenDelimitedField(oauthInfo, 4)
  const expirySeconds = _extractVarintField(expiryMsg, 1)

  const expiresIn = expirySeconds > 0 ? Math.max(0, expirySeconds - Math.floor(Date.now() / 1000)) : 0
  return {
    access_token: accessToken || '',
    refresh_token: refreshToken || '',
    token_type: tokenType || 'Bearer',
    expiry_timestamp: expirySeconds > 0 ? expirySeconds : 0,
    expires_in: expiresIn > 0 ? expiresIn : 0
  }
}

function _decodeBase64Safe (value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  try {
    return Buffer.from(raw, 'base64')
  } catch {
    return null
  }
}

function _escapeSqliteString (value) {
  return String(value || '').replace(/'/g, "''")
}

function _execSqliteStatement (dbPath, sql) {
  try {
    return cp.execFileSync('sqlite3', [dbPath, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error('系统未找到 sqlite3 命令')
    }
    const stderr = err && err.stderr ? String(err.stderr).trim() : ''
    throw new Error(stderr || (err && err.message ? err.message : String(err)))
  }
}

function _extractStringField (buffer, targetField) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  if (!buf || buf.length === 0) return ''
  const payload = _extractLenDelimitedField(buf, targetField)
  if (!payload || payload.length === 0) return ''
  try {
    return payload.toString('utf8')
  } catch {
    return ''
  }
}

function _extractVarintField (buffer, targetField) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  if (!buf || buf.length === 0) return 0
  let offset = 0
  while (offset < buf.length) {
    const tagData = _readVarint(buf, offset)
    if (!tagData) return 0
    const tag = tagData.value
    const wireType = tag & 7
    const fieldNum = tag >> 3
    offset = tagData.next

    if (fieldNum === targetField && wireType === 0) {
      const varintData = _readVarint(buf, offset)
      return varintData ? varintData.value : 0
    }

    const skipped = _skipField(buf, offset, wireType)
    if (skipped < 0) return 0
    offset = skipped
  }
  return 0
}

function _extractLenDelimitedField (buffer, targetField) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  if (!buf || buf.length === 0) return null

  let offset = 0
  while (offset < buf.length) {
    const tagData = _readVarint(buf, offset)
    if (!tagData) return null
    const tag = tagData.value
    const wireType = tag & 7
    const fieldNum = tag >> 3
    offset = tagData.next

    if (fieldNum === targetField && wireType === 2) {
      const lengthData = _readVarint(buf, offset)
      if (!lengthData) return null
      const length = lengthData.value
      const start = lengthData.next
      const end = start + length
      if (end > buf.length) return null
      return buf.slice(start, end)
    }

    const skipped = _skipField(buf, offset, wireType)
    if (skipped < 0) return null
    offset = skipped
  }

  return null
}

function _readVarint (buffer, start) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  let result = 0
  let shift = 0
  let pos = Number(start) || 0

  while (pos < buf.length) {
    const byte = buf[pos]
    result |= (byte & 0x7F) << shift
    pos += 1
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, next: pos }
    }
    shift += 7
    if (shift > 35) return null
  }

  return null
}

function _skipField (buffer, offset, wireType) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  const off = Number(offset) || 0

  if (wireType === 0) {
    const data = _readVarint(buf, off)
    return data ? data.next : -1
  }
  if (wireType === 1) {
    const next = off + 8
    return next <= buf.length ? next : -1
  }
  if (wireType === 2) {
    const lengthData = _readVarint(buf, off)
    if (!lengthData) return -1
    const next = lengthData.next + lengthData.value
    return next <= buf.length ? next : -1
  }
  if (wireType === 5) {
    const next = off + 4
    return next <= buf.length ? next : -1
  }
  return -1
}

function _encodeVarint (value) {
  let num = Math.max(0, Number(value) || 0)
  const bytes = []
  while (num >= 0x80) {
    bytes.push((num & 0x7F) | 0x80)
    num >>>= 7
  }
  bytes.push(num)
  return Buffer.from(bytes)
}

function _encodeStringField (fieldNum, value) {
  const payload = Buffer.from(String(value || ''), 'utf8')
  return _encodeLenDelimitedField(fieldNum, payload)
}

function _encodeLenDelimitedField (fieldNum, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || [])
  return Buffer.concat([
    _encodeVarint((Number(fieldNum) << 3) | 2),
    _encodeVarint(body.length),
    body
  ])
}

function _createOauthInfoBuffer (accessToken, refreshToken, expiryTimestamp, tokenType) {
  const expiry = Math.max(0, Number(expiryTimestamp) || 0)
  const expiryMsg = Buffer.concat([
    _encodeVarint((1 << 3) | 0),
    _encodeVarint(expiry)
  ])
  return Buffer.concat([
    _encodeStringField(1, accessToken || ''),
    _encodeStringField(2, tokenType || 'Bearer'),
    _encodeStringField(3, refreshToken || ''),
    _encodeLenDelimitedField(4, expiryMsg)
  ])
}

function _removeFieldFromProto (buffer, targetField) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  if (!buf.length) return Buffer.alloc(0)

  const chunks = []
  let offset = 0
  while (offset < buf.length) {
    const tagData = _readVarint(buf, offset)
    if (!tagData) return Buffer.from(buf)
    const tag = tagData.value
    const wireType = tag & 7
    const fieldNum = tag >> 3
    const nextOffset = _skipField(buf, tagData.next, wireType)
    if (nextOffset < 0) return Buffer.from(buf)
    if (fieldNum !== Number(targetField)) {
      chunks.push(buf.slice(offset, nextOffset))
    }
    offset = nextOffset
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0)
}

function _injectLegacyOauthTokenToPath (dbPath, accessToken, refreshToken, expiryTimestamp, tokenType) {
  const currentData = _queryStateDbValue(dbPath, 'jetskiStateSync.agentManagerInitState')
  if (!currentData) return

  const blob = _decodeBase64Safe(currentData)
  if (!blob || !blob.length) return

  const clean = _removeFieldFromProto(blob, 6)
  const oauthInfo = _createOauthInfoBuffer(accessToken, refreshToken, expiryTimestamp, tokenType)
  const field = _encodeLenDelimitedField(6, oauthInfo)
  const finalData = Buffer.concat([clean, field]).toString('base64')
  _execSqliteStatement(
    dbPath,
    "UPDATE ItemTable SET value = '" + _escapeSqliteString(finalData) + "' WHERE key = 'jetskiStateSync.agentManagerInitState';"
  )
}

function _injectUnifiedOauthTokenToPath (dbPath, accessToken, refreshToken, expiryTimestamp, tokenType) {
  const oauthInfo = _createOauthInfoBuffer(accessToken, refreshToken, expiryTimestamp, tokenType)
  const oauthInfoBase64 = oauthInfo.toString('base64')
  const inner2 = _encodeStringField(1, oauthInfoBase64)
  const inner = Buffer.concat([
    _encodeStringField(1, 'oauthTokenInfoSentinelKey'),
    _encodeLenDelimitedField(2, inner2)
  ])
  const outer = _encodeLenDelimitedField(1, inner).toString('base64')
  _execSqliteStatement(
    dbPath,
    "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravityUnifiedStateSync.oauthToken', '" + _escapeSqliteString(outer) + "');"
  )
}

function _injectAntigravityOnboardingFlag (dbPath) {
  _execSqliteStatement(
    dbPath,
    "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravityOnboarding', 'true');"
  )
}

function _injectAntigravityAuthStatus (dbPath, account, accessToken) {
  const payload = {
    name: String((account && account.name) || '').trim(),
    apiKey: String(accessToken || '').trim(),
    email: String((account && account.email) || '').trim()
  }
  _execSqliteStatement(
    dbPath,
    "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravityAuthStatus', '" + _escapeSqliteString(JSON.stringify(payload)) + "');"
  )
}

function _injectAntigravityProfileUrl (dbPath, account) {
  const profileUrl = String((account && (account.avatar_url || account.picture || account.profile_url)) || '').trim()
  if (!profileUrl) {
    _execSqliteStatement(
      dbPath,
      "DELETE FROM ItemTable WHERE key = 'antigravity.profileUrl';"
    )
    return
  }
  _execSqliteStatement(
    dbPath,
    "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravity.profileUrl', '" + _escapeSqliteString(profileUrl) + "');"
  )
}

function _clearStaleAntigravityIdentityCache (dbPath) {
  _execSqliteStatement(
    dbPath,
    [
      "DELETE FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.userStatus';",
      "DELETE FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.modelCredits';"
    ].join(' ')
  )
}

function _writeOfficialAntigravityRuntime (account) {
  const token = account && account.token && typeof account.token === 'object' ? account.token : {}
  const accessToken = String(token.access_token || '').trim()
  const refreshToken = String(token.refresh_token || '').trim()
  if (!accessToken || !refreshToken) {
    return { success: false, error: '目标账号缺少有效 token，无法写入官方运行态', stage: 'runtime_write_failed', error_code: 'runtime_write_failed' }
  }

  const expiryTimestamp = Math.max(0, Number(token.expiry_timestamp || 0) || 0)
  const tokenType = String(token.token_type || 'Bearer').trim() || 'Bearer'
  const dbPath = _getAntigravityStateDbPath()
  fileUtils.ensureDir(path.dirname(dbPath))

  try {
    _execSqliteStatement(dbPath, 'CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT);')
    _injectUnifiedOauthTokenToPath(dbPath, accessToken, refreshToken, expiryTimestamp, tokenType)
    _injectLegacyOauthTokenToPath(dbPath, accessToken, refreshToken, expiryTimestamp, tokenType)
    _injectAntigravityOnboardingFlag(dbPath)
    _injectAntigravityAuthStatus(dbPath, account, accessToken)
    _injectAntigravityProfileUrl(dbPath, account)
    _clearStaleAntigravityIdentityCache(dbPath)
    return { success: true, dbPath }
  } catch (err) {
    return {
      success: false,
      error: '写入官方运行态失败: ' + (err && err.message ? err.message : String(err)),
      stage: 'runtime_write_failed',
      error_code: 'runtime_write_failed'
    }
  }
}

/**
 * 从 JSON 字符串导入账号
 * @param {string} jsonContent
 * @returns {Promise<{ imported: Array, error: string|null }>}
 */
async function importFromJson (jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent)
    const rawList = Array.isArray(parsed) ? parsed : [parsed]
    const imported = []

    for (let i = 0; i < rawList.length; i++) {
      let account = normalizeAccount(rawList[i])
      if (!account) continue

      const token = account.token || {}
      const hasAccessToken = !!String(token.access_token || '').trim()
      const hasRefreshToken = !!String(token.refresh_token || '').trim()
      if (hasRefreshToken) {
        const refreshed = await _refreshAntigravityToken(token.refresh_token)
        if (refreshed.ok && refreshed.access_token) {
          const now = Math.floor(Date.now() / 1000)
          account = Object.assign({}, account, {
            token: Object.assign({}, token, {
              access_token: refreshed.access_token,
              expires_in: refreshed.expires_in || 3600,
              expiry_timestamp: now + (refreshed.expires_in || 3600)
            })
          })
        } else if (!hasAccessToken) {
          return { imported: [], error: 'refresh_token 刷新 access_token 失败: ' + (refreshed.error || '未知错误') }
        }
      }

      const usableAccessToken = String(account.token && account.token.access_token ? account.token.access_token : '').trim()
      if (usableAccessToken) {
        const userInfo = await _fetchGoogleUserinfo(usableAccessToken)
        if (userInfo && (userInfo.email || userInfo.name)) {
          account = Object.assign({}, account, {
            email: userInfo.email || account.email,
            name: userInfo.name || account.name || ''
          })
        }
      }

      _stampPluginAddedMeta(account, 'json')
      account = _bindDeviceProfileToAccount(account, {
        captureCurrent: false,
        defaultSource: 'generated'
      }).account
      const saved = storage.addAccount(PLATFORM, account)
      imported.push(saved || account)
    }

    if (imported.length === 0) {
      return { imported: [], error: '未找到有效的账号数据' }
    }
    return { imported: imported, error: null }
  } catch (err) {
    return { imported: [], error: 'JSON 解析失败: ' + err.message }
  }
}

/**
 * 通过 refresh_token 添加账号
 * @param {string} refreshToken
 * @returns {Promise<object>} 新增的账号
 */
async function addWithToken (refreshToken) {
  const refresh = String(refreshToken || '').trim()
  if (!refresh) {
    throw new Error('refresh_token 不能为空')
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const refreshed = await _refreshAntigravityToken(refresh)
  if (!refreshed.ok || !refreshed.access_token) {
    throw new Error('refresh_token 刷新 access_token 失败: ' + (refreshed.error || '未知错误'))
  }

  const accessToken = refreshed.access_token
  const expiresIn = Number(refreshed.expires_in || 3600) || 3600
  const userInfo = accessToken ? await _fetchGoogleUserinfo(accessToken) : {}
  const account = {
    email: userInfo.email || _extractEmailFromToken(accessToken) || 'token-import@antigravity',
    name: userInfo.name || '',
    token: {
      access_token: accessToken,
      refresh_token: refresh,
      expires_in: expiresIn,
      expiry_timestamp: expiresIn > 0 ? (nowSec + expiresIn) : 0,
      token_type: 'Bearer'
    },
    tags: [],
    created_at: Date.now(),
    last_used: 0
  }
  _stampPluginAddedMeta(account, 'token')
  const prepared = _bindDeviceProfileToAccount(account, {
    captureCurrent: false,
    defaultSource: 'generated'
  }).account
  return storage.addAccount(PLATFORM, prepared) || prepared
}

/**
 * 准备 OAuth 会话：生成授权链接并监听本地回调端口
 * @param {number} [port]
 * @returns {{success:boolean, session?:{sessionId:string,authUrl:string,redirectUri:string}, error?:string}}
 */
async function prepareOAuthSession (port) {
  try {
    const { clientId, clientSecret } = _resolveAntigravityOAuthCredentials()
    if (!clientId) {
      return { success: false, error: _getAntigravityOAuthCredentialError('发起 OAuth') }
    }
    if (!clientSecret) {
      return { success: false, error: _getAntigravityOAuthCredentialError('发起 OAuth') }
    }

    storage.cleanupOAuthPending(PLATFORM, ANTIGRAVITY_OAUTH_SESSION_TTL_MS)
    _cleanupActiveOAuthSessions()
    const callbackPort = _resolveOAuthPort(port)
    const redirectUri = 'http://localhost:' + callbackPort + ANTIGRAVITY_OAUTH_CALLBACK_PATH
    const state = _randomBase64Url()
    const authUrl = _buildAntigravityAuthorizeUrl(redirectUri, state, clientId)
    const sessionId = 'antigravity-oauth-' + fileUtils.generateId()

    _cleanupExpiredOAuthSessions()
    const session = {
      sessionId,
      state,
      redirectUri,
      authUrl,
      createdAt: Date.now(),
      expiresAt: Date.now() + ANTIGRAVITY_OAUTH_SESSION_TTL_MS // 10 分钟后过期
    }
    oauthSessions.set(sessionId, session)

    const startRes = await _startOAuthCallbackServer(session)
    if (!startRes.success) {
      oauthSessions.delete(sessionId)
      storage.clearOAuthPending(PLATFORM, sessionId)
      return { success: false, error: startRes.error || '启动本地回调监听失败' }
    }
    _saveOAuthSession(session)

    // 设置超时自动关闭定时器
    session.timeoutTimer = setTimeout(() => {
      requestLogger.info('antigravity.oauth', 'OAuth 会话超时，自动关闭', {
        sessionId,
        timeoutMinutes: ANTIGRAVITY_OAUTH_SESSION_TTL_MS / 60 / 1000
      })
      cancelOAuthSession(sessionId)
    }, ANTIGRAVITY_OAUTH_SESSION_TTL_MS)

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

/**
 * 查询 OAuth 会话状态（用于前端轮询）
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
 * 提交回调并完成 OAuth：code 换 token + 入库
 * @param {string} sessionId
 * @param {string} callbackUrl
 * @returns {Promise<{success:boolean,account?:object,error?:string}>}
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

  const authError = parsedUrl.searchParams.get('error')
  if (authError) {
    const desc = parsedUrl.searchParams.get('error_description') || ''
    return {
      success: false,
      error: desc ? ('Google OAuth 错误: ' + authError + ' (' + desc + ')') : ('Google OAuth 错误: ' + authError)
    }
  }

  const code = parsedUrl.searchParams.get('code')
  if (!code) {
    return { success: false, error: '回调地址缺少 code 参数' }
  }

  const exchanged = await _exchangeCodeForTokens(code, session.redirectUri)
  if (!exchanged.ok) {
    return { success: false, error: exchanged.error || 'Token 交换失败' }
  }

  const tokens = exchanged.tokens || {}
  const userInfo = await _fetchGoogleUserinfo(tokens.access_token || '')
  const nowSec = Math.floor(Date.now() / 1000)
  const expiresIn = Number(tokens.expires_in || 3600) || 3600
  const account = {
    id: fileUtils.generateId(),
    email: userInfo.email || _extractEmailFromToken(tokens.id_token || tokens.access_token) || 'oauth@antigravity',
    name: userInfo.name || '',
    tags: [],
    token: {
      access_token: tokens.access_token || '',
      refresh_token: tokens.refresh_token || '',
      expires_in: expiresIn,
      expiry_timestamp: nowSec + Math.max(0, expiresIn),
      token_type: tokens.token_type || 'Bearer',
      project_id: ''
    },
    quota: null,
    created_at: Date.now(),
    last_used: 0
  }
  _stampPluginAddedMeta(account, 'oauth')
  const prepared = _bindDeviceProfileToAccount(account, {
    captureCurrent: false,
    defaultSource: 'generated'
  }).account

  _closeOAuthSessionServer(session)
  oauthSessions.delete(sid)
  storage.clearOAuthPending(PLATFORM, sid)
  const savedAccount = storage.addAccount(PLATFORM, prepared)

  // 新 OAuth 账号添加后立即刷新额度，保证卡片即时显示
  let quotaRefreshError = ''
  try {
    if (savedAccount && savedAccount.id) {
      const quotaResult = await _refreshQuotaAsync(savedAccount, savedAccount.id)
      if (!quotaResult || !quotaResult.success) {
        quotaRefreshError = (quotaResult && quotaResult.error) || '首次刷新配额失败'
      }
    }
  } catch (err) {
    quotaRefreshError = err && err.message ? err.message : '首次刷新配额失败'
  }

  return {
    success: true,
    account: storage.getAccount(PLATFORM, savedAccount.id) || savedAccount,
    quotaRefreshError: quotaRefreshError || null
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
 * 探测 Antigravity 启动路径
 * @param {string} [customPath]
 * @returns {string}
 */
function detectAntigravityAppPath (customPath, runtime) {
  const custom = String(customPath || '').trim()
  if (custom && fileUtils.fileExists(custom)) {
    return custom
  }

  const candidates = getAntigravityAppPathCandidates(runtime)
  for (let i = 0; i < candidates.length; i++) {
    if (fileUtils.fileExists(candidates[i])) {
      return candidates[i]
    }
  }
  return ''
}

function _resolveAntigravityLaunchPath (customPath) {
  const custom = String(customPath || '').trim()
  if (custom) {
    return fileUtils.fileExists(custom) ? custom : ''
  }
  return detectAntigravityAppPath('')
}

function _readAdvancedSettingsFromStorage () {
  try {
    const saved = sharedSettingsStore.readValue('antigravity_advanced_settings', {})
    if (saved && typeof saved === 'object') return saved
  } catch {}

  return {}
}

function _resolveAdvancedSettings (options) {
  const stored = _readAdvancedSettingsFromStorage()
  const merged = options && typeof options === 'object'
    ? Object.assign({}, DEFAULT_ADVANCED_SETTINGS, stored, options)
    : Object.assign({}, DEFAULT_ADVANCED_SETTINGS, stored)

  if (typeof merged.autoRestartAntigravityApp === 'undefined' && typeof merged.autoStartAntigravityApp !== 'undefined') {
    merged.autoRestartAntigravityApp = Boolean(merged.autoStartAntigravityApp)
  }
  merged.startupPath = typeof merged.startupPath === 'string' ? merged.startupPath.trim() : ''
  merged.oauthClientId = typeof merged.oauthClientId === 'string' ? merged.oauthClientId.trim() : ''
  merged.oauthClientSecret = typeof merged.oauthClientSecret === 'string' ? merged.oauthClientSecret.trim() : ''
  merged.autoRestartAntigravityApp = Boolean(merged.autoRestartAntigravityApp)
  merged.autoStartAntigravityAppWhenClosed = Boolean(merged.autoStartAntigravityAppWhenClosed)
  return merged
}

function _buildAntigravityOAuthClientRegistry () {
  const clients = [{
    key: 'antigravity_enterprise',
    label: 'Antigravity Enterprise',
    clientId: ANTIGRAVITY_CLIENT_ID,
    clientSecret: ANTIGRAVITY_CLIENT_SECRET,
    isBuiltin: true
  }]

  // 从环境变量加载额外 Client
  const OAUTH_CLIENTS_ENV = process.env.ANTIGRAVITY_OAUTH_CLIENTS || ''
  if (OAUTH_CLIENTS_ENV) {
    const entries = OAUTH_CLIENTS_ENV.split(';')
    for (const entry of entries) {
      const [key, clientId, clientSecret, label] = entry.split('|').map(v => v.trim())
      if (key && clientId && clientSecret) {
        clients.push({
          key,
          label: label || key,
          clientId,
          clientSecret,
          isBuiltin: false
        })
      }
    }
  }

  return clients
}

function _resolveAntigravityOAuthCredentials () {
  const settings = _readAdvancedSettingsFromStorage()
  const activeKey = process.env.ANTIGRAVITY_OAUTH_CLIENT_KEY || 'antigravity_enterprise'
  
  const registry = _buildAntigravityOAuthClientRegistry()
  const activeClient = registry.find(c => c.key === activeKey)
  
  return {
    clientId: String(activeClient?.clientId || ANTIGRAVITY_CLIENT_ID || settings.oauthClientId || '').trim(),
    clientSecret: String(activeClient?.clientSecret || ANTIGRAVITY_CLIENT_SECRET || settings.oauthClientSecret || '').trim(),
    clientKey: activeClient?.key || 'antigravity_enterprise'
  }
}

function _getAntigravityOAuthCredentialError (action) {
  const actionText = String(action || '执行操作').trim() || '执行操作'
  return `未配置 Antigravity 的 Google OAuth 凭证，无法${actionText}。请先到 Antigravity 设置中填写 Client ID 和 Client Secret。`
}

function _isAntigravityAppRunning () {
  try {
    if (process.platform === 'darwin') return _listAntigravityPids().length > 0
    if (process.platform === 'win32') {
      const output = cp.execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe'], { encoding: 'utf8' })
      return /Antigravity\.exe/i.test(String(output || ''))
    }
    if (process.platform === 'linux') {
      cp.execFileSync('pgrep', ['-f', 'antigravity'], { stdio: 'ignore' })
      return true
    }
  } catch {}
  return false
}

function _listAntigravityPids () {
  if (process.platform !== 'darwin') return []
  try {
    const output = cp.execFileSync('pgrep', ['-f', 'Antigravity.app/Contents/MacOS/Electron'], { encoding: 'utf8' })
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

function _ensureAntigravityLaunchPathConfigured (settings) {
  const appPath = _resolveAntigravityLaunchPath(settings && settings.startupPath)
  if (!appPath) {
    return {
      success: false,
      error: '未配置有效的 Antigravity 启动路径',
      stage: 'app_path_missing',
      error_code: 'app_path_missing'
    }
  }
  return { success: true, path: appPath }
}

function _closeAntigravityApp () {
  if (process.platform === 'darwin') {
    const pids = _listAntigravityPids()
    for (const pid of pids) {
      try {
        const script = [
          'tell application "System Events" to set frontmost of (first process whose unix id is ' + pid + ') to true',
          'tell application "System Events" to keystroke "q" using command down'
        ].join('\n')
        cp.execFileSync('osascript', ['-e', script], { stdio: 'ignore' })
      } catch {}
    }
    if (pids.length > 0) {
      _sleepSync(2000)
    }
    if (_isAntigravityAppRunning()) {
      try {
        cp.execFileSync('pkill', ['-f', 'Antigravity.app/Contents/MacOS/Electron'], { stdio: 'ignore' })
      } catch {}
    }
    return { success: true }
  }

  if (process.platform === 'win32') {
    try {
      cp.execFileSync('taskkill', ['/IM', 'Antigravity.exe'], { stdio: 'ignore' })
    } catch {}
    _sleepSync(1500)
    if (_isAntigravityAppRunning()) {
      try {
        cp.execFileSync('taskkill', ['/IM', 'Antigravity.exe', '/F'], { stdio: 'ignore' })
      } catch {}
    }
    return { success: true }
  }

  if (process.platform === 'linux') {
    try {
      cp.execFileSync('pkill', ['-15', '-f', 'antigravity'], { stdio: 'ignore' })
    } catch {}
    _sleepSync(1500)
    if (_isAntigravityAppRunning()) {
      try {
        cp.execFileSync('pkill', ['-f', 'antigravity'], { stdio: 'ignore' })
      } catch {}
    }
  }
  return { success: true }
}

function _waitForAntigravityExit (timeoutMs = 20000) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 20000)
  while (Date.now() < deadline) {
    if (!_isAntigravityAppRunning()) {
      return { success: true }
    }
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    } catch {}
  }
  return {
    success: false,
    error: '等待 Antigravity 退出超时',
    stage: 'close_app_failed',
    error_code: 'close_app_failed'
  }
}

function _restartAntigravityApp (customPath) {
  _closeAntigravityApp()
  const waited = _waitForAntigravityExit(20000)
  if (!waited.success) return waited
  return _launchAntigravityApp(customPath)
}

function _launchAntigravityApp (customPath) {
  const appPath = _resolveAntigravityLaunchPath(customPath)
  if (!appPath) {
    return { success: false, error: '未找到 Antigravity 启动路径', stage: 'launch_failed', error_code: 'app_path_missing' }
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
    return { success: false, error: '当前系统不支持自动启动 Antigravity', stage: 'launch_failed', error_code: 'launch_failed' }
  } catch (err) {
    return {
      success: false,
      error: err && err.message ? err.message : String(err),
      stage: 'launch_failed',
      error_code: 'launch_failed'
    }
  }
}

function _applySwitchIntegrations (settings, appWasRunning) {
  const warnings = []
  if (!settings.autoRestartAntigravityApp) return warnings

  if (appWasRunning) {
    const launchRes = _launchAntigravityApp(settings.startupPath)
    if (!launchRes.success) {
      warnings.push('Antigravity App 重启失败: ' + launchRes.error)
    }
  } else if (settings.autoStartAntigravityAppWhenClosed) {
    const launchRes = _launchAntigravityApp(settings.startupPath)
    if (!launchRes.success) {
      warnings.push('Antigravity App 启动失败: ' + launchRes.error)
    }
  }

  return warnings
}

/**
 * 切换账号：将当前运行态凭证快照写入平台数据目录，并按需切换设备身份
 * @param {string} accountId
 * @param {object} [_options]
 * @returns {object} { success: boolean, error: string|null }
 */
async function switchAccount (accountId, options) {
  let account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    requestLogger.warn('antigravity.switch', '切号失败：账号不存在', { accountId })
    return { success: false, error: '账号不存在', stage: 'account_not_found', error_code: 'account_not_found' }
  }

  const settings = _resolveAdvancedSettings(options)
  const switchDeviceIdentity = !options || options.switchDeviceIdentity !== false
  let switchWarning = ''
  requestLogger.info('antigravity.switch', '开始切换账号', {
    account: account.email || account.id,
    switchDeviceIdentity,
    autoRestartAntigravityApp: settings.autoRestartAntigravityApp
  })

  if (settings.autoRestartAntigravityApp) {
    const pathCheck = _ensureAntigravityLaunchPathConfigured(settings)
    if (!pathCheck.success) {
      requestLogger.warn('antigravity.switch', '切号失败：启动路径无效', {
        account: account.email || account.id,
        error: pathCheck.error
      })
      return pathCheck
    }
  }

  const token = account && account.token && typeof account.token === 'object' ? account.token : {}
  const refreshToken = String(token.refresh_token || '').trim()
  if (!refreshToken) {
    requestLogger.warn('antigravity.switch', '切号失败：缺少 refresh_token', {
      account: account.email || account.id
    })
    return { success: false, error: '目标账号缺少 refresh_token，无法切换', stage: 'token_refresh_failed', error_code: 'token_refresh_failed' }
  }

  const refreshed = await _refreshAntigravityToken(refreshToken, {
    account: account.email || account.id,
    source: 'switch'
  })
  if (!refreshed.ok || !refreshed.access_token) {
    requestLogger.warn('antigravity.switch', '切号失败：Token 刷新失败', {
      account: account.email || account.id,
      error: refreshed.error || '未知错误'
    })
    return {
      success: false,
      error: 'Token 刷新失败: ' + (refreshed.error || '未知错误'),
      stage: 'token_refresh_failed',
      error_code: 'token_refresh_failed'
    }
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const expiresIn = Number(refreshed.expires_in || 3600) || 3600
  const userInfo = refreshed.access_token ? await _fetchGoogleUserinfo(refreshed.access_token) : {}
  const nextToken = Object.assign({}, token, {
    access_token: refreshed.access_token,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    expiry_timestamp: nowSec + Math.max(0, expiresIn),
    token_type: String(token.token_type || 'Bearer').trim() || 'Bearer'
  })
  const accountPatch = { token: nextToken }
  if (userInfo.email) accountPatch.email = userInfo.email
  if (userInfo.name) accountPatch.name = userInfo.name
  if (userInfo.picture) accountPatch.avatar_url = userInfo.picture
  storage.updateAccount(PLATFORM, accountId, accountPatch)
  account = Object.assign({}, account, accountPatch)

  const antigravityCurrentlyRunning = _isAntigravityAppRunning()
  const appWasRunning = settings.autoRestartAntigravityApp ? antigravityCurrentlyRunning : false
  if (antigravityCurrentlyRunning && !settings.autoRestartAntigravityApp) {
    switchWarning = 'Antigravity 当前仍在运行，切号结果将在你手动重启客户端后生效'
  }
  if (appWasRunning) {
    _closeAntigravityApp()
    const waited = _waitForAntigravityExit(20000)
    if (!waited.success) {
      requestLogger.warn('antigravity.switch', '切号失败：等待客户端退出超时', {
        account: account.email || account.id
      })
      return waited
    }
  }

  if (switchDeviceIdentity) {
    _ensureOriginalDeviceProfileCaptured()
    const binding = _bindDeviceProfileToAccount(account, {
      captureCurrent: false,
      defaultSource: 'generated'
    })
    if (binding.changed) {
      storage.updateAccount(PLATFORM, accountId, {
        device_profile: binding.profile,
        device_profile_source: binding.account.device_profile_source || 'generated'
      })
      account = Object.assign({}, account, {
        device_profile: binding.profile,
        device_profile_source: binding.account.device_profile_source || 'generated'
      })
    }

    const deviceResult = _applyDeviceProfile(binding.profile)
    if (!deviceResult.success) {
      requestLogger.warn('antigravity.switch', '切号失败：设备身份写入失败', {
        account: account.email || account.id,
        error: deviceResult.error || '切换设备身份失败'
      })
      return {
        success: false,
        error: deviceResult.error || '切换设备身份失败',
        stage: 'device_profile_failed',
        error_code: 'device_profile_failed'
      }
    }
    switchWarning = deviceResult.warning || ''
  }

  const officialWrite = _writeOfficialAntigravityRuntime(account)
  if (!officialWrite.success) {
    requestLogger.warn('antigravity.switch', '切号失败：写入官方运行态失败', {
      account: account.email || account.id,
      error: officialWrite.error
    })
    return officialWrite
  }

  const tokenFile = getPlatformTokenPath()
  const tokenData = {
    access_token: account.token.access_token,
    refresh_token: account.token.refresh_token,
    expires_in: account.token.expires_in,
    expiry_timestamp: account.token.expiry_timestamp,
    token_type: account.token.token_type,
    email: account.email
  }

  const written = fileUtils.writeJsonFile(tokenFile, tokenData)
  if (!written) {
    requestLogger.warn('antigravity.switch', '切号失败：写入凭证文件失败', {
      account: account.email || account.id,
      tokenFile
    })
    return { success: false, error: '写入凭证文件失败', stage: 'runtime_write_failed', error_code: 'runtime_write_failed' }
  }

  // 更新 last_used 时间戳
  storage.updateAccount(PLATFORM, accountId, { last_used: Date.now() })
  storage.setCurrentId(PLATFORM, accountId)

  _sleepSync(appWasRunning ? 400 : 200)
  const warnings = _applySwitchIntegrations(settings, appWasRunning)
  if (warnings.length > 0) {
    const combined = warnings.join('；')
    switchWarning = switchWarning
      ? `${switchWarning}；${combined}`
      : combined
  }

  requestLogger.info('antigravity.switch', '切号成功', {
    account: account.email || account.id,
    warning: switchWarning || ''
  })

  return { success: true, error: null, warning: switchWarning || null }
}

function restoreOriginalDeviceIdentity () {
  const original = _loadOriginalDeviceProfile()
  if (!original) {
    return {
      success: false,
      error: '未找到原始设备身份备份，请先完成一次本地导入或开启更换设备身份后切号'
    }
  }

  const result = _applyDeviceProfile(original)
  if (!result.success) {
    return { success: false, error: result.error || '恢复原始设备身份失败' }
  }

  return {
    success: true,
    warning: result.warning || null
  }
}

function getCurrentDeviceIdentity () {
  const readResult = _readStorageJsonForDeviceProfile()
  if (readResult.error) {
    return { success: false, error: readResult.error }
  }
  if (!readResult.exists) {
    return { success: false, error: '未找到 Antigravity storage.json，请先启动官方客户端一次' }
  }

  const profile = {
    machine_id: _extractStorageTelemetryField(readResult.json, 'machineId') || '',
    mac_machine_id: _extractStorageTelemetryField(readResult.json, 'macMachineId') || '',
    dev_device_id: _extractStorageTelemetryField(readResult.json, 'devDeviceId') || '',
    sqm_id: _extractStorageTelemetryField(readResult.json, 'sqmId') || '',
    service_machine_id: _getServiceMachineId()
  }

  const missingFields = Object.entries(profile)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key)

  return {
    success: true,
    profile,
    missingFields,
    hasOriginalBackup: !!_loadOriginalDeviceProfile()
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
 * 批量删除账号
 * @param {string[]} accountIds
 * @returns {number}
 */
function deleteAccounts (accountIds) {
  return storage.deleteAccounts(PLATFORM, accountIds)
}

/**
 * 刷新账号配额 — 调用 Google Cloud Code API
 * @param {string} accountId
 * @returns {object} { success: boolean, quota: object|null, error: string|null }
 */
function refreshQuota (accountId) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    requestLogger.warn('antigravity.quota', '刷新配额失败：账号不存在', { accountId })
    return { success: false, quota: null, error: '账号不存在' }
  }
  requestLogger.info('antigravity.quota', '开始刷新配额', {
    account: account.email || account.id
  })

  // 异步执行，返回 Promise
  return _refreshQuotaAsync(account, accountId)
}

function refreshQuotaOrUsage (accountId) {
  return refreshQuota(accountId)
}

async function activateAccount (accountId, options) {
  const result = await switchAccount(accountId, options)
  const warnings = []
  if (result?.warning) warnings.push(result.warning)
  if (Array.isArray(result?.warnings)) warnings.push(...result.warnings)
  return {
    success: !!result?.success,
    error: result?.error || null,
    warnings,
    stage: result?.stage || '',
    changed: !!result?.success
  }
}

async function refreshToken (accountId) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    requestLogger.warn('antigravity.token', '刷新失败：账号不存在', { accountId })
    return { success: false, error: '账号不存在' }
  }

  const token = (account.token && typeof account.token === 'object') ? account.token : {}
  const accessToken = String(token.access_token || '').trim()
  const refreshTokenValue = String(token.refresh_token || '').trim()
  const nowSec = Math.floor(Date.now() / 1000)
  const expiryTimestamp = Math.max(0, Number(token.expiry_timestamp || 0) || 0)
  const shouldRefresh = !accessToken || (expiryTimestamp > 0 && expiryTimestamp <= nowSec + 600)

  if (!shouldRefresh) {
    return { success: true, refreshed: false, error: null, message: 'Token 仍然有效' }
  }
  if (!refreshTokenValue) {
    requestLogger.warn('antigravity.token', '刷新失败：缺少 refresh_token', {
      account: account.email || account.id
    })
    return { success: false, error: '缺少 refresh_token，无法刷新 Token' }
  }

  const refreshed = await _refreshAntigravityToken(refreshTokenValue, {
    account: account.email || account.id,
    source: 'token-refresh'
  })
  if (!refreshed.ok || !refreshed.access_token) {
    requestLogger.warn('antigravity.token', '刷新失败：Token 刷新失败', {
      account: account.email || account.id,
      error: refreshed.error || '未知错误'
    })
    return {
      success: false,
      error: 'Token 刷新失败: ' + (refreshed.error || '未知错误')
    }
  }

  const expiresIn = Number(refreshed.expires_in || 3600) || 3600
  const userInfo = refreshed.access_token ? await _fetchGoogleUserinfo(refreshed.access_token) : {}
  const nextToken = Object.assign({}, token, {
    access_token: refreshed.access_token,
    refresh_token: refreshTokenValue,
    expires_in: expiresIn,
    expiry_timestamp: nowSec + Math.max(0, expiresIn),
    token_type: String(token.token_type || 'Bearer').trim() || 'Bearer'
  })
  const accountPatch = {
    token: nextToken,
    last_used: Date.now()
  }
  if (userInfo.email) accountPatch.email = userInfo.email
  if (userInfo.name) accountPatch.name = userInfo.name
  if (userInfo.picture) accountPatch.avatar_url = userInfo.picture
  storage.updateAccount(PLATFORM, accountId, accountPatch)
  requestLogger.info('antigravity.token', '刷新 Token 成功', {
    account: accountPatch.email || account.email || account.id
  })
  return {
    success: true,
    refreshed: true,
    error: null,
    message: 'Token 刷新成功'
  }
}

/**
 * 内部异步配额刷新
 */
async function _refreshQuotaAsync (account, accountId) {
  const http = require('./httpClient')

  try {
    // 0. 先尝试从本地详情文件补全 token/quota（兼容老版本导入的“仅元数据账号”）
    let hydrated = _hydrateAccountFromLocalFiles(account)
    let token = hydrated.token || account.token || {}
    if (hydrated.updated) {
      storage.updateAccount(PLATFORM, accountId, hydrated.updates)
      account = Object.assign({}, account, hydrated.updates)
      token = account.token || token
    }

    const persistTokenUpdate = (nextAccessToken, expiresIn, extraTokenPatch = {}) => {
      const tokenUpdate = {
        token: Object.assign({}, token, {
          access_token: nextAccessToken,
          expires_in: expiresIn,
          expiry_timestamp: now + (expiresIn || 3600)
        }, extraTokenPatch)
      }
      storage.updateAccount(PLATFORM, accountId, tokenUpdate)
      account = Object.assign({}, account, tokenUpdate)
      token = account.token || token
    }

    const fetchQuotaResponse = async (requestAccessToken, requestProjectId) => {
      const payload = requestProjectId ? { project: requestProjectId } : {}
      return http.postJSON(
        CLOUD_CODE_BASE_URL + '/' + FETCH_MODELS_PATH,
        {
          Authorization: 'Bearer ' + requestAccessToken,
          'User-Agent': 'antigravity/1.20.5 windows/amd64',
          'Accept-Encoding': 'gzip'
        },
        payload
      )
    }

    // 1. 确保 access_token 有效
    let accessToken = token.access_token

    // 检查是否过期（预留 15 分钟缓冲，避免配额刷新过程中 Token 过期）
    const now = Math.floor(Date.now() / 1000)
    const TOKEN_REFRESH_SKEW_SECONDS = 900 // 15 分钟
    if (!accessToken || (token.expiry_timestamp && token.expiry_timestamp < now + TOKEN_REFRESH_SKEW_SECONDS)) {
      if (!token.refresh_token) {
        const quotaError = _extractAntigravityQuotaError(0, 'Token 已过期且无 refresh_token')
        const fallback = _tryApplyLocalQuotaFallback(account, accountId, quotaError)
        if (fallback) return fallback
        const persisted = _persistAntigravityQuotaError(accountId, quotaError)
        requestLogger.warn('antigravity.quota', '刷新配额失败：Token 已过期且无 refresh_token', {
          account: account.email || account.id
        })
        return { success: false, quota: null, error: quotaError.message, quota_error: persisted.quotaError }
      }
      const refreshed = await _refreshAntigravityToken(token.refresh_token, {
        account: account.email || account.id,
        source: 'quota-refresh'
      })
      if (!refreshed.ok) {
        // 检查是否需要禁用账号
        if (refreshed.should_disable_account) {
          requestLogger.warn('antigravity.quota', '禁用账号（Token 失效）', {
            account: account.email || account.id
          })
          storage.updateAccount(PLATFORM, accountId, {
            disabled: true,
            disabled_at: Date.now(),
            disabled_reason: refreshed.error
          })
        }
        
        const quotaError = _extractAntigravityQuotaError(0, '刷新 Token 失败: ' + refreshed.error)
        const fallback = _tryApplyLocalQuotaFallback(account, accountId, quotaError)
        if (fallback) return fallback
        const persisted = _persistAntigravityQuotaError(accountId, quotaError)
        requestLogger.warn('antigravity.quota', '刷新配额失败：刷新 Token 失败', {
          account: account.email || account.id,
          error: refreshed.error
        })
        return { success: false, quota: null, error: quotaError.message, quota_error: persisted.quotaError }
      }
      // 更新 token 信息
      accessToken = refreshed.access_token
      persistTokenUpdate(refreshed.access_token, refreshed.expires_in)
    }

    // 2. 尝试补全 project_id，再调用 fetchAvailableModels API
    let projectId = String(token.project_id || '').trim()
    let codeAssistState = { project_id: '', subscription_tier: '', credits: [], error: '' }
    if (!projectId && accessToken) {
      codeAssistState = await _loadAntigravityCodeAssist(accessToken, '')
      projectId = String(codeAssistState.project_id || '').trim()
      if (projectId) {
        const tokenUpdate = {
          token: Object.assign({}, account.token || token, { project_id: projectId })
        }
        storage.updateAccount(PLATFORM, accountId, tokenUpdate)
        account = Object.assign({}, account, tokenUpdate)
        token = account.token || token
      }
    }
    let res = await fetchQuotaResponse(accessToken, projectId)

    if ((!res || !res.ok) && Number(res && res.status) === 401 && token.refresh_token) {
      requestLogger.warn('antigravity.quota', '配额接口返回 401，尝试强制刷新 Token 后重试一次', {
        account: account.email || account.id
      })
      const refreshed = await _refreshAntigravityToken(token.refresh_token, {
        account: account.email || account.id,
        source: 'quota-refresh-reauth'
      })
      if (refreshed.ok && refreshed.access_token) {
        accessToken = refreshed.access_token
        persistTokenUpdate(refreshed.access_token, refreshed.expires_in)
        res = await fetchQuotaResponse(accessToken, projectId)
      }
    }

    if (!res.ok) {
      const quotaError = _extractAntigravityQuotaError(res.status, res.raw || ('API 返回 ' + res.status))
      const fallback = _tryApplyLocalQuotaFallback(account, accountId, quotaError)
      if (fallback) return fallback
      const persisted = _persistAntigravityQuotaError(accountId, quotaError)
      return {
        success: false,
        quota: null,
        error: quotaError.message,
        quota_error: persisted.quotaError
      }
    }

    // 3. 解析配额数据（合并保留旧字段，如 subscription_tier / credits）
    const parsedQuota = _parseAntigravityQuota(res.data)
    const currentQuota = _normalizeQuotaShape(account.quota) || {}
    if (parsedQuota && Array.isArray(parsedQuota.models) && parsedQuota.models.length === 0) {
      if (Array.isArray(currentQuota.models) && currentQuota.models.length > 0) {
        parsedQuota.models = currentQuota.models
      } else {
        const localDetail = _findLocalAccountDetailByEmail(account && account.email)
        const localModels = _normalizeQuotaModels(
          localDetail && localDetail.quota ? localDetail.quota.models : null
        )
        if (localModels.length > 0) {
          parsedQuota.models = localModels
        }
      }
    }
    const quotaBase = Object.assign(
      {},
      currentQuota,
      String(codeAssistState.subscription_tier || '').trim() ? { subscription_tier: String(codeAssistState.subscription_tier || '').trim() } : {},
      Array.isArray(codeAssistState.credits) && codeAssistState.credits.length > 0 ? { credits: codeAssistState.credits } : {},
      parsedQuota,
      {
        error: null,
        error_code: '',
        invalid: false
      }
    )
    const nextQuota = _clearAntigravityQuotaError(
      accountId,
      _normalizeQuotaShape(quotaBase) || quotaBase
    )
    requestLogger.info('antigravity.quota', '刷新配额成功', {
      account: account.email || account.id,
      models: Array.isArray(nextQuota.models) ? nextQuota.models.length : 0
    })

    const hasQuotaModels = _normalizeQuotaModels(nextQuota && nextQuota.models).length > 0
    return {
      success: true,
      quota: nextQuota,
      error: null,
      quota_error: null,
      message: hasQuotaModels ? '' : '刷新完成，但未获取到可展示的配额数据'
    }
  } catch (err) {
    const quotaError = _extractAntigravityQuotaError(0, err && err.message ? err.message : String(err))
    const fallback = _tryApplyLocalQuotaFallback(account, accountId, quotaError)
    if (fallback) return fallback
    const persisted = _persistAntigravityQuotaError(accountId, quotaError)
    requestLogger.error('antigravity.quota', '刷新配额异常', {
      account: account.email || account.id,
      error: err && err.message ? err.message : String(err)
    })
    return { success: false, quota: null, error: quotaError.message, quota_error: persisted.quotaError }
  }
}

/**
 * 从本地详情文件补全账号 token/quota
 */
function _hydrateAccountFromLocalFiles (account) {
  const fallback = { updated: false, updates: {}, token: account.token || {} }
  const id = String(account && account.id ? account.id : '').trim()

  let detail = null
  if (id) {
    const detailPath = path.join(getPlatformAccountsDir(), id + '.json')
    detail = fileUtils.readJsonFile(detailPath)
  }

  // 兼容账号 ID 变更场景：按邮箱在本地详情目录兜底回填
  if (!detail || typeof detail !== 'object') {
    detail = _findLocalAccountDetailByEmail(account && account.email)
  }
  if (!detail || typeof detail !== 'object') {
    detail = _findLocalAccountDetailByToken(
      account && account.token ? account.token.refresh_token : '',
      account && account.token ? account.token.access_token : ''
    )
  }

  if (!detail || typeof detail !== 'object') return fallback

  const next = normalizeAccount(Object.assign({}, account, detail))
  if (!next) return fallback

  const updates = {}
  if (next.token && (next.token.access_token || next.token.refresh_token)) {
    updates.token = next.token
  }
  const normalizedQuota = _normalizeQuotaShape(next.quota)
  if (normalizedQuota && Array.isArray(normalizedQuota.models) && normalizedQuota.models.length > 0) {
    updates.quota = normalizedQuota
  }

  const updated = Object.keys(updates).length > 0
  return {
    updated,
    updates,
    token: updated && updates.token ? updates.token : (account.token || {})
  }
}

function _findLocalAccountDetailByEmail (email) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return null

  const accountsDir = getPlatformAccountsDir()
  const files = fileUtils.listFiles(accountsDir)
  if (!Array.isArray(files) || files.length === 0) return null

  for (let i = 0; i < files.length; i++) {
    const file = String(files[i] || '')
    if (!file.endsWith('.json')) continue
    const detail = fileUtils.readJsonFile(path.join(accountsDir, file))
    if (!detail || typeof detail !== 'object') continue
    const localEmail = String(detail.email || '').trim().toLowerCase()
    if (localEmail && localEmail === target) {
      return detail
    }
  }

  return null
}

function _findLocalAccountDetailByToken (refreshToken, accessToken) {
  const refresh = String(refreshToken || '').trim()
  const access = String(accessToken || '').trim()
  if (!refresh && !access) return null

  const accountsDir = getPlatformAccountsDir()
  const files = fileUtils.listFiles(accountsDir)
  if (!Array.isArray(files) || files.length === 0) return null

  for (let i = 0; i < files.length; i++) {
    const file = String(files[i] || '')
    if (!file.endsWith('.json')) continue
    const detail = fileUtils.readJsonFile(path.join(accountsDir, file))
    if (!detail || typeof detail !== 'object') continue
    const localToken = (detail && detail.token && typeof detail.token === 'object') ? detail.token : {}
    const localRefresh = String(localToken.refresh_token || '').trim()
    const localAccess = String(localToken.access_token || '').trim()

    if (refresh && localRefresh && refresh === localRefresh) {
      return detail
    }
    if (access && localAccess && access === localAccess) {
      return detail
    }
  }

  return null
}

function _tryApplyLocalQuotaFallback (account, accountId, quotaErrorOrReason) {
  const quotaError = quotaErrorOrReason && typeof quotaErrorOrReason === 'object'
    ? quotaErrorOrReason
    : _extractAntigravityQuotaError(0, quotaErrorOrReason)
  const localDetail = _findLocalAccountDetailByToken(
    account && account.token ? account.token.refresh_token : '',
    account && account.token ? account.token.access_token : ''
  ) || _findLocalAccountDetailByEmail(account && account.email)

  const normalizedQuota = _normalizeQuotaShape(localDetail && localDetail.quota ? localDetail.quota : null)
  if (!normalizedQuota || !_normalizeQuotaModels(normalizedQuota.models).length) {
    return null
  }

  // 检查缓存是否"新鲜"（24 小时内）
  const cacheAge = Date.now() - (localDetail.quota?.last_updated || 0)
  const isCacheStale = cacheAge > 24 * 60 * 60 * 1000 // 24 小时

  if (isCacheStale) {
    requestLogger.warn('antigravity.quota', '缓存配额已过时，降级使用', {
      account: account.email,
      cacheAge: Math.round(cacheAge / 1000 / 60) + '分钟'
    })
  }

  const currentQuota = _normalizeQuotaShape(account && account.quota ? account.quota : null) || {}
  const mergedQuotaBase = _normalizeQuotaShape(Object.assign({}, currentQuota, normalizedQuota)) || Object.assign({}, currentQuota, normalizedQuota)
  const persisted = _persistAntigravityQuotaError(accountId, quotaError, mergedQuotaBase, { 
    fallback: true,
    cache_age_ms: cacheAge
  })
  return {
    success: true,
    quota: persisted.quota,
    error: null,
    warning: isCacheStale
      ? '网络异常，已回退使用本地缓存配额（缓存已过时）'
      : '网络异常，已回退使用本地缓存配额',
    is_fallback: true,
    cache_age_ms: cacheAge,
    quota_error: persisted.quotaError
  }
}

function _extractAntigravityQuotaError (status, raw) {
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

function _persistAntigravityQuotaError (accountId, quotaError, quotaOverride, options) {
  if (!accountId || !quotaError || typeof quotaError !== 'object') {
    return {
      quota: quotaOverride && typeof quotaOverride === 'object' ? quotaOverride : null,
      quotaError: null
    }
  }

  const existing = storage.getAccount(PLATFORM, accountId) || {}
  const currentQuota = (existing.quota && typeof existing.quota === 'object') ? existing.quota : {}
  const quotaBase = quotaOverride && typeof quotaOverride === 'object' ? quotaOverride : currentQuota
  const nowSec = Math.floor(Date.now() / 1000)
  const nextQuota = Object.assign({}, quotaBase, {
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
    fallback: Boolean(options && options.fallback),
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
  const results = []
  let completed = 0
  
  const tasks = accountIds.map(async (accountId) => {
    await semaphore.acquire()
    
    try {
      const account = storage.getAccount(PLATFORM, accountId)
      if (!account) {
        return { id: accountId, success: false, error: '账号不存在' }
      }
      
      const result = await _refreshQuotaAsync(account, accountId)
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
  
  await Promise.all(tasks)
  return results
}

function _clearAntigravityQuotaError (accountId, quotaOverride) {
  const existing = storage.getAccount(PLATFORM, accountId) || {}
  const currentQuota = (existing.quota && typeof existing.quota === 'object') ? existing.quota : {}
  const quotaBase = quotaOverride && typeof quotaOverride === 'object' ? quotaOverride : currentQuota
  const nextQuota = Object.assign({}, quotaBase, {
    error: null,
    error_code: '',
    invalid: false
  })

  storage.updateAccount(PLATFORM, accountId, {
    quota: nextQuota,
    invalid: false,
    quota_error: null
  })

  return nextQuota
}

/**
 * 将索引元数据转换为可展示账号（允许无 token）
 */
function _normalizeIndexOnlyAccount (raw, tokenFallback) {
  if (!raw || typeof raw !== 'object') return null

  const id = String(raw.id || '').trim()
  const email = String(raw.email || raw.username || raw.name || '').trim()
  if (!id && !email) return null

  const token = (raw.token && typeof raw.token === 'object') ? raw.token : {}
  const fallbackMatch =
    tokenFallback &&
    typeof tokenFallback === 'object' &&
    (tokenFallback.access_token || tokenFallback.refresh_token) &&
    (!tokenFallback.email || !email || String(tokenFallback.email).trim() === email)

  const accessToken = token.access_token || (fallbackMatch ? String(tokenFallback.access_token || '') : '')
  const refreshToken = token.refresh_token || (fallbackMatch ? String(tokenFallback.refresh_token || '') : '')

  return {
    id: id || fileUtils.generateId(),
    email: email || 'unknown@antigravity',
    name: String(raw.name || ''),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    token: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: token.expires_in || (fallbackMatch ? Number(tokenFallback.expires_in || 0) : 0) || 3600,
      expiry_timestamp: token.expiry_timestamp || (fallbackMatch ? Number(tokenFallback.expiry_timestamp || 0) : 0) || 0,
      token_type: token.token_type || (fallbackMatch ? String(tokenFallback.token_type || 'Bearer') : 'Bearer'),
      project_id: token.project_id || raw.project_id || ''
    },
    quota: raw.quota || null,
    quota_error: raw.quota_error || null,
    created_at: raw.created_at || Date.now(),
    last_used: raw.last_used || 0,
    added_via: raw.added_via || '',
    added_at: raw.added_at || 0
  }
}

function _findAntigravityAccountByLocalState (accounts, localState) {
  const refreshToken = String(localState && localState.refreshToken ? localState.refreshToken : '').trim()
  const accessToken = String(localState && localState.accessToken ? localState.accessToken : '').trim()
  const email = String(localState && localState.email ? localState.email : '').trim().toLowerCase()
  const projectId = String(localState && localState.projectId ? localState.projectId : '').trim()

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i] || {}
    const token = (account.token && typeof account.token === 'object') ? account.token : {}
    const localRefresh = String(token.refresh_token || '').trim()
    const localAccess = String(token.access_token || '').trim()
    if (refreshToken && localRefresh && refreshToken === localRefresh) return account
    if (accessToken && localAccess && accessToken === localAccess) return account
  }

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i] || {}
    const accountEmail = String(account.email || '').trim().toLowerCase()
    if (!email || !accountEmail || email !== accountEmail) continue
    if (!projectId) return account
    const token = (account.token && typeof account.token === 'object') ? account.token : {}
    const accountProjectId = String(token.project_id || '').trim()
    if (!accountProjectId || accountProjectId === projectId) return account
  }

  return null
}

function _buildAntigravityLocalFingerprint (localState) {
  const refreshToken = String(localState && localState.refreshToken ? localState.refreshToken : '').trim()
  const accessToken = String(localState && localState.accessToken ? localState.accessToken : '').trim()
  const email = String(localState && localState.email ? localState.email : '').trim().toLowerCase()
  const projectId = String(localState && localState.projectId ? localState.projectId : '').trim()
  const raw = [refreshToken, accessToken, email, projectId].join('|')
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

/**
 * 刷新 Antigravity access_token
 * Google OAuth2: https://oauth2.googleapis.com/token
 */
async function _refreshAntigravityToken (refreshToken, context = {}) {
  const http = require('./httpClient')
  const clients = _buildAntigravityOAuthClientRegistry()
  const activeKey = process.env.ANTIGRAVITY_OAUTH_CLIENT_KEY || 'antigravity_enterprise'

  let attemptErrors = []

  // 优先使用活跃 Client
  const preferredClient = clients.find(c => c.key === activeKey)
  const candidates = preferredClient
    ? [preferredClient, ...clients.filter(c => c.key !== activeKey)]
    : clients

  for (const client of candidates) {
    try {
      requestLogger.info('antigravity.token', `开始刷新 Token (Client: ${client.key})`, context)
      const res = await http.postForm(GOOGLE_TOKEN_URL, {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })

      if (res.ok && res.data && res.data.access_token) {
        if (client.key !== 'antigravity_enterprise') {
          requestLogger.info('antigravity.token', `降级 Client 刷新成功：${client.key}`, context)
        }
        return {
          ok: true,
          access_token: res.data.access_token,
          expires_in: res.data.expires_in || 3600,
          oauth_client_key: client.key
        }
      }

      const rawError = res.raw || ''
      attemptErrors.push(`${client.key}: ${rawError}`)

      // 检测 invalid_grant 错误（Token 已失效）
      if (rawError.includes('invalid_grant')) {
        requestLogger.error('antigravity.token', 'Token 已失效（invalid_grant），建议禁用账号', {
          ...context,
          should_disable_account: true
        })
        
        return {
          ok: false,
          error: 'invalid_grant: Token 已失效或已被撤销',
          should_disable_account: true  // 新增标记
        }
      }

      // 检查是否是 Client 不匹配错误
      const isClientMismatch = 
        rawError.includes('unauthorized_client') ||
        rawError.includes('invalid_client')
      
      // 如果不是 Client 问题，直接返回错误
      if (!isClientMismatch) {
        requestLogger.warn('antigravity.token', '刷新 Token 失败', {
          ...context,
          error: rawError.slice(0, 200)
        })
        return { ok: false, error: rawError.slice(0, 200) }
      }
      // 否则尝试下一个 Client
    } catch (err) {
      const errorMsg = err.message || String(err)
      const isClientMismatch = 
        errorMsg.includes('unauthorized_client') ||
        errorMsg.includes('invalid_client')
      
      attemptErrors.push(`${client.key}: ${errorMsg}`)
      
      // 如果不是 Client 问题，直接返回错误
      if (!isClientMismatch) {
        requestLogger.error('antigravity.token', '刷新 Token 异常', {
          ...context,
          error: errorMsg
        })
        return {
          ok: false,
          error: errorMsg
        }
      }
      // 否则尝试下一个 Client
    }
  }

  return {
    ok: false,
    error: `所有 Client 刷新失败：${attemptErrors.join(' | ')}`
  }
}

function _buildAntigravityAuthorizeUrl (redirectUri, state, clientId) {
  const resolvedClientId = String(clientId || _resolveAntigravityOAuthCredentials().clientId || '').trim()
  return (
    GOOGLE_AUTH_URL +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(resolvedClientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&scope=' + encodeURIComponent(ANTIGRAVITY_OAUTH_SCOPES) +
    '&access_type=offline' +
    '&prompt=consent' +
    '&state=' + encodeURIComponent(state)
  )
}

function _resolveOAuthPort (port) {
  if (typeof port === 'number' && Number.isFinite(port) && port > 0 && port < 65536) {
    return Math.floor(port)
  }
  return ANTIGRAVITY_OAUTH_CALLBACK_PORT
}

function _cleanupExpiredOAuthSessions () {
  storage.cleanupOAuthPending(PLATFORM, ANTIGRAVITY_OAUTH_SESSION_TTL_MS)
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
    if (now - session.createdAt > ANTIGRAVITY_OAUTH_SESSION_TTL_MS) {
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
    const redirect = new URL(session.redirectUri)
    const port = Number(redirect.port || ANTIGRAVITY_OAUTH_CALLBACK_PORT)
    const expectedPath = redirect.pathname || ANTIGRAVITY_OAUTH_CALLBACK_PATH

    const server = require('http').createServer(function (req, res) {
      try {
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
        _saveOAuthSession(session)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(_oauthCallbackSuccessHtml())
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
          requestLogger.info('antigravity.oauth', `启动 OAuth 回调服务器失败，正在重试 (${attempt}/5)`, {
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
  return '<!doctype html><html><head><meta charset="utf-8"><title>Antigravity 授权成功</title>' +
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

    const samePath = url.pathname === expected.pathname
    const samePort = Number(url.port || 80) === Number(expected.port || 80)
    const sameHost = url.hostname === expected.hostname || (_isLocalHost(url.hostname) && _isLocalHost(expected.hostname))
    const sameProtocol = url.protocol === expected.protocol
    if (!samePath || !samePort || !sameHost || !sameProtocol) {
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

function _isLocalHost (hostname) {
  const host = String(hostname || '').trim().toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

async function _exchangeCodeForTokens (code, redirectUri) {
  const http = require('./httpClient')
  try {
    const { clientId, clientSecret } = _resolveAntigravityOAuthCredentials()
    if (!clientId) {
      return { ok: false, error: _getAntigravityOAuthCredentialError('完成 OAuth') }
    }
    if (!clientSecret) {
      return { ok: false, error: _getAntigravityOAuthCredentialError('完成 OAuth') }
    }
    const res = await http.postForm(GOOGLE_TOKEN_URL, {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret
    })
    if (!res.ok || !res.data || !res.data.access_token) {
      return {
        ok: false,
        error: 'Token 交换失败: ' + ((res.raw || '').slice(0, 220) || ('HTTP ' + res.status))
      }
    }
    return {
      ok: true,
      tokens: {
        access_token: res.data.access_token || '',
        refresh_token: res.data.refresh_token || '',
        id_token: res.data.id_token || '',
        token_type: res.data.token_type || 'Bearer',
        expires_in: Number(res.data.expires_in || 3600) || 3600
      }
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

async function _fetchGoogleUserinfo (accessToken) {
  const token = (accessToken || '').trim()
  if (!token) return {}

  const http = require('./httpClient')
  try {
    const res = await http.getJSON(
      GOOGLE_USERINFO_URL,
      { Authorization: 'Bearer ' + token }
    )
    if (!res.ok || !res.data || typeof res.data !== 'object') return {}
    return {
      email: String(res.data.email || '').trim(),
      name: String(res.data.name || '').trim(),
      picture: String(res.data.picture || '').trim()
    }
  } catch {
    return {}
  }
}

async function _loadAntigravityCodeAssist (accessToken, preferredProjectId) {
  const token = String(accessToken || '').trim()
  const projectId = String(preferredProjectId || '').trim()
  if (!token) {
    return { project_id: '', subscription_tier: '', credits: [], error: 'access_token 为空' }
  }

  const http = require('./httpClient')
  const payload = {
    metadata: _buildAntigravityCloudCodeMetadata(projectId),
    mode: 'FULL_ELIGIBILITY_CHECK'
  }
  if (projectId) {
    payload.cloudaicompanionProject = projectId
  }

  try {
    const res = await http.postJSON(
      CLOUD_CODE_BASE_URL + '/' + LOAD_CODE_ASSIST_PATH,
      {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity/1.20.5 windows/amd64',
        'Accept-Encoding': 'gzip'
      },
      payload
    )

    if (!res.ok || !res.data || typeof res.data !== 'object') {
      return {
        project_id: '',
        subscription_tier: '',
        credits: [],
        error: (res.raw || ('HTTP ' + res.status) || '').slice(0, 240)
      }
    }

    const paidTier = (res.data.paidTier && typeof res.data.paidTier === 'object') ? res.data.paidTier : {}
    const currentTier = (res.data.currentTier && typeof res.data.currentTier === 'object') ? res.data.currentTier : {}
    const directCredits = _normalizeCreditsList(res.data.credits)
    const paidCredits = _normalizeCreditsList(paidTier.availableCredits)
    const currentCredits = _normalizeCreditsList(currentTier.availableCredits)
    return {
      project_id: _extractProjectIdFromCloudCode(res.data.cloudaicompanionProject || res.data.project),
      subscription_tier: String(
        paidTier.id || paidTier.quotaTier || paidTier.name ||
        currentTier.id || currentTier.quotaTier || currentTier.name || ''
      ).trim(),
      credits: directCredits.length > 0 ? directCredits : (paidCredits.length > 0 ? paidCredits : currentCredits),
      error: ''
    }
  } catch (err) {
    return {
      project_id: '',
      subscription_tier: '',
      credits: [],
      error: err && err.message ? err.message : String(err)
    }
  }
}

function _buildAntigravityCloudCodeMetadata (projectId) {
  const metadata = {
    ideName: 'antigravity',
    ideType: 'ANTIGRAVITY',
    pluginType: 'GEMINI',
    platform: 'PLATFORM_UNSPECIFIED',
    updateChannel: 'stable'
  }
  const duetProject = String(projectId || '').trim()
  if (duetProject) {
    metadata.duetProject = duetProject
  }
  return metadata
}

function _extractProjectIdFromCloudCode (value) {
  if (!value) return ''
  if (typeof value === 'string') return String(value || '').trim()
  if (typeof value === 'object') {
    const id = String(value.id || value.projectId || value.name || '').trim()
    if (!id) return ''
    const marker = 'projects/'
    const idx = id.indexOf(marker)
    if (idx < 0) return id
    const rest = id.slice(idx + marker.length)
    const slash = rest.indexOf('/')
    return slash >= 0 ? rest.slice(0, slash) : rest
  }
  return ''
}

function _extractEmailFromToken (token) {
  const payload = _decodeJwtPayload(token)
  if (!payload || typeof payload !== 'object') return ''
  const email = payload.email || payload.preferred_username || ''
  return typeof email === 'string' ? email.trim() : ''
}

function _decodeJwtPayload (token) {
  const raw = String(token || '').trim()
  if (!raw) return null
  try {
    const parts = raw.split('.')
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

function _randomBase64Url () {
  const base64 = crypto.randomBytes(24).toString('base64')
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

/**
 * 解析 fetchAvailableModels API 响应为配额数据
 * @param {object} data - API 响应 { models: { "model-name": { quotaInfo: { remainingFraction, resetTime } } } }
 * @returns {object} 配额对象
 */
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

function _normalizeCreditsList (items) {
  if (!Array.isArray(items)) return []
  const credits = []

  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {}
    const creditType = it.credit_type || it.creditType || ''
    const creditAmount = it.credit_amount || it.creditAmount
    const minimum = it.minimum_credit_amount_for_usage || it.minimumCreditAmountForUsage
    if (!creditType || creditAmount === undefined || creditAmount === null || creditAmount === '') continue
    credits.push({
      credit_type: String(creditType),
      credit_amount: String(creditAmount),
      minimum_credit_amount_for_usage: minimum === undefined || minimum === null ? '' : String(minimum)
    })
  }

  return credits
}

function _normalizeQuotaModels (source) {
  const items = []
  let entries = []
  if (Array.isArray(source)) {
    entries = source.map((item, index) => {
      const info = item && typeof item === 'object' ? item : {}
      const name = info.name || info.model || info.id || String(index)
      return [name, info]
    })
  } else if (source && typeof source === 'object') {
    entries = Object.entries(source)
  }

  for (let i = 0; i < entries.length; i++) {
    const name = entries[i][0]
    const info = entries[i][1] && typeof entries[i][1] === 'object' ? entries[i][1] : {}
    const modelName = String(name || info.name || info.model || '').trim()
    if (!modelName) continue

    const displayName = info.displayName || info.display_name || modelName
    const qi = info.quotaInfo || info.quota_info || info.quota || {}
    const fractionRaw = qi.remainingFraction ?? qi.remaining_fraction ?? info.remainingFraction ?? info.remaining_fraction
    const percentageRaw = info.percentage ?? info.remaining_percentage ?? fractionRaw
    let percentage = Number(percentageRaw)
    if (!Number.isFinite(percentage)) {
      percentage = 0
    } else if (percentage <= 1) {
      percentage = Math.round(percentage * 100)
    } else {
      percentage = Math.round(percentage)
    }

    const resetRaw = info.reset_time ?? info.resetTime ?? qi.resetTime ?? qi.reset_time
    items.push({
      name: modelName,
      display_name: String(displayName || modelName),
      percentage,
      reset_time: _toUnixSeconds(resetRaw)
    })
  }

  return items
}

function _normalizeQuotaShape (quota) {
  if (!quota || typeof quota !== 'object') return quota || null
  if (!Object.prototype.hasOwnProperty.call(quota, 'models')) return quota

  const normalizedModels = _normalizeQuotaModels(quota.models)
  const sameLength = Array.isArray(quota.models) && quota.models.length === normalizedModels.length
  if (sameLength) {
    let same = true
    for (let i = 0; i < normalizedModels.length; i++) {
      const left = normalizedModels[i] || {}
      const right = quota.models[i] || {}
      if (
        String(left.name || '') !== String(right.name || '') ||
        String(left.display_name || '') !== String(right.display_name || right.displayName || '') ||
        Number(left.percentage || 0) !== Number(right.percentage || 0) ||
        _toUnixSeconds(left.reset_time) !== _toUnixSeconds(right.reset_time || right.resetTime)
      ) {
        same = false
        break
      }
    }
    if (same) return quota
  }

  return Object.assign({}, quota, { models: normalizedModels })
}

function _parseAntigravityQuota (data) {
  const models = _normalizeQuotaModels(data && data.models)

  const next = {
    models: models,
    updated_at: Math.floor(Date.now() / 1000)
  }

  // 尽量从返回体中提取订阅档位（不同版本字段名可能不同）
  const subscriptionTier = (data && (data.subscription_tier || data.subscriptionTier)) || ''
  if (subscriptionTier) {
    next.subscription_tier = String(subscriptionTier)
  }

  // 尽量从返回体中提取积分信息（结构兼容 paidTier.availableCredits / credits）
  const directCredits = _normalizeCreditsList(data && data.credits)
  const paidTierCredits = _normalizeCreditsList(data && data.paidTier && data.paidTier.availableCredits)
  const currentTierCredits = _normalizeCreditsList(data && data.currentTier && data.currentTier.availableCredits)
  const mergedCredits = directCredits.length > 0
    ? directCredits
    : (paidTierCredits.length > 0 ? paidTierCredits : currentTierCredits)

  if (mergedCredits.length > 0) {
    next.credits = mergedCredits
  }

  return next
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
 * 更新账号标签
 * @param {string} accountId
 * @param {string[]} tags
 * @returns {object|null}
 */
function updateTags (accountId, tags) {
  return storage.updateAccount(PLATFORM, accountId, { tags: tags })
}

/**
 * 标准化账号数据格式
 * @param {object} raw 原始数据
 * @returns {object|null} 标准化后的账号对象
 */
function normalizeAccount (raw) {
  if (!raw) return null

  // 兼容多种导入格式
  const email = raw.email || raw.username || raw.name || ''
  const token = raw.token || {}
  const accessToken = token.access_token || raw.access_token || ''
  const refreshToken = token.refresh_token || raw.refresh_token || ''
  const quota = raw.quota || raw.quota_data || raw.usage || null

  if (!accessToken && !refreshToken) {
    return null
  }

  const normalizedDeviceProfile = _normalizeDeviceProfile(raw.device_profile || raw.deviceProfile, { allowGenerate: false })

  return {
    id: raw.id || fileUtils.generateId(),
    email: email,
    name: raw.name || '',
    tags: raw.tags || [],
    token: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: token.expires_in || raw.expires_in || 3600,
      expiry_timestamp: token.expiry_timestamp || raw.expiry_timestamp || 0,
      token_type: token.token_type || raw.token_type || 'Bearer',
      project_id: token.project_id || raw.project_id || ''
    },
    quota: quota,
    quota_error: raw.quota_error || null,
    device_profile: normalizedDeviceProfile || undefined,
    device_profile_source: normalizedDeviceProfile ? String(raw.device_profile_source || raw.deviceProfileSource || 'imported').trim().toLowerCase() || 'imported' : '',
    created_at: raw.created_at || Date.now(),
    last_used: raw.last_used || 0,
    added_via: raw.added_via || '',
    added_at: raw.added_at || 0
  }
}

function _pickExistingPath (paths) {
  for (let i = 0; i < paths.length; i++) {
    const candidate = String(paths[i] || '').trim()
    if (!candidate) continue
    if (fileUtils.fileExists(candidate)) return candidate
  }
  return ''
}

function _pushUniquePath (arr, val) {
  const next = String(val || '').trim()
  if (!next) return
  if (arr.indexOf(next) >= 0) return
  arr.push(next)
}

function _uniquePathList (paths) {
  const out = []
  for (let i = 0; i < paths.length; i++) {
    _pushUniquePath(out, paths[i])
  }
  return out
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
  detectAntigravityAppPath,
  switchAccount,
  activateAccount,
  getCurrentDeviceIdentity,
  restoreOriginalDeviceIdentity,
  deleteAccount,
  deleteAccounts,
  refreshToken,
  refreshQuota,
  refreshQuotaOrUsage,
  refreshQuotasBatch, // 新增批量刷新
  exportAccounts,
  updateTags,
  getConfigDir,
  getAntigravityAppPathCandidates,
  getDefaultAntigravityAppPath,
  getStoragePathCandidates,
  getMachineIdPathCandidates,
  getStateDbPathCandidates,
  getLocalStatePaths,
  getLocalStateWatchTargets
}
