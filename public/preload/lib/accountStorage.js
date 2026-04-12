/**
 * accountStorage.js — Aideck 文件化账号存储层
 *
 * 目录规范：
 *   ~/.ai_deck/meta.json
 *   ~/.ai_deck/{platform}/accounts-index.json
 *   ~/.ai_deck/{platform}/accounts/{id}.json
 *   ~/.ai_deck/{platform}/current.json
 *   ~/.ai_deck/{platform}/oauth_pending/{sessionId}.json
 *   ~/.ai_deck/sync/
 *
 * 支持 platform：antigravity, codex, gemini
 */

const crypto = require('node:crypto')
const path = require('node:path')
const fileUtils = require('./fileUtils')

const SUPPORTED_PLATFORMS = ['antigravity', 'codex', 'gemini']
const DATA_ROOT_NAME = '.ai_deck'
const DATA_SCHEMA_VERSION = 1
const INDEX_FILE = 'accounts-index.json'
const CURRENT_FILE = 'current.json'
const ACCOUNTS_DIR = 'accounts'
const OAUTH_PENDING_DIR = 'oauth_pending'
const META_FILE = 'meta.json'

const SYNC_AAD = 'aideck-sync-v1'
const SYNC_SCHEMA_VERSION = 1
const DEFAULT_SCRYPT = {
  N: 16384,
  r: 8,
  p: 1,
  keyLen: 32,
  maxmem: 64 * 1024 * 1024
}

function nowMs () {
  return Date.now()
}

function _assertPlatform (platform) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error('不支持的平台: ' + platform)
  }
}

function getDataRootDir () {
  const root = path.join(fileUtils.getHomeDir(), DATA_ROOT_NAME)
  fileUtils.ensureDir(root)
  _ensureMetaFile(root)
  return root
}

function _platformDirPath (platform) {
  _assertPlatform(platform)
  return path.join(getDataRootDir(), platform)
}

function getPlatformDataDir (platform) {
  const dir = _platformDirPath(platform)
  const accountsDir = path.join(dir, ACCOUNTS_DIR)
  const pendingDir = path.join(dir, OAUTH_PENDING_DIR)
  fileUtils.ensureDir(dir)
  fileUtils.ensureDir(accountsDir)
  fileUtils.ensureDir(pendingDir)
  _ensureIndexFile(platform)
  return dir
}

function getOAuthPendingDir (platform) {
  return path.join(getPlatformDataDir(platform), OAUTH_PENDING_DIR)
}

function initStorage () {
  const root = getDataRootDir()
  for (let i = 0; i < SUPPORTED_PLATFORMS.length; i++) {
    const platform = SUPPORTED_PLATFORMS[i]
    getPlatformDataDir(platform)
  }
  fileUtils.ensureDir(path.join(root, 'sync'))
  return { success: true, root }
}

function _metaPath () {
  return path.join(getDataRootDir(), META_FILE)
}

function _ensureMetaFile (rootDir) {
  const metaPath = path.join(rootDir, META_FILE)
  if (fileUtils.fileExists(metaPath)) return
  fileUtils.writeJsonFile(metaPath, {
    schema_version: DATA_SCHEMA_VERSION,
    created_at: nowMs(),
    updated_at: nowMs()
  })
}

function _touchMeta () {
  const metaPath = _metaPath()
  const current = fileUtils.readJsonFile(metaPath) || {}
  const next = Object.assign({}, current, {
    schema_version: DATA_SCHEMA_VERSION,
    updated_at: nowMs()
  })
  if (!current.created_at) next.created_at = nowMs()
  fileUtils.writeJsonFile(metaPath, next)
}

function _indexPath (platform) {
  return path.join(_platformDirPath(platform), INDEX_FILE)
}

function _currentPath (platform) {
  return path.join(_platformDirPath(platform), CURRENT_FILE)
}

function _accountsDir (platform) {
  return path.join(_platformDirPath(platform), ACCOUNTS_DIR)
}

function _pendingPath (platform, sessionId) {
  const safe = _sanitizeFileStem(sessionId)
  return path.join(getOAuthPendingDir(platform), safe + '.json')
}

function _ensureIndexFile (platform) {
  const indexPath = _indexPath(platform)
  if (fileUtils.fileExists(indexPath)) return
  fileUtils.writeJsonFile(indexPath, {
    schema_version: DATA_SCHEMA_VERSION,
    updated_at: nowMs(),
    accounts: []
  })
}

function _isValidIndex (value) {
  if (!value || typeof value !== 'object') return false
  if (!Array.isArray(value.accounts)) return false
  return value.accounts.every(function (account) {
    return account &&
      typeof account === 'object' &&
      typeof account.id === 'string' &&
      typeof account.email === 'string'
  })
}

function repairIndex (platform) {
  _assertPlatform(platform)
  const accounts = _loadAccountsFromDetails(platform)
  const written = _writeIndexFromAccounts(platform, accounts)
  if (written) {
    const currentId = getCurrentId(platform)
    if (currentId && !accounts.some(a => a.id === currentId)) {
      clearCurrentId(platform)
    }
  }
  return {
    success: written,
    repaired_count: accounts.length
  }
}

function _readIndex (platform) {
  _assertPlatform(platform)
  const indexPath = _indexPath(platform)
  const index = fileUtils.readJsonFile(indexPath)
  if (_isValidIndex(index)) {
    return index
  }

  // 索引损坏时自动按详情文件重建
  repairIndex(platform)
  const repaired = fileUtils.readJsonFile(indexPath)
  if (_isValidIndex(repaired)) {
    return repaired
  }

  return {
    schema_version: DATA_SCHEMA_VERSION,
    updated_at: nowMs(),
    accounts: []
  }
}

function _buildIndexRecord (account) {
  const quota = account && account.quota
  const hasQuota = Boolean(
    quota &&
    typeof quota === 'object' &&
    (
      (Array.isArray(quota.models) && quota.models.length > 0) ||
      (quota.models && typeof quota.models === 'object' && Object.keys(quota.models).length > 0) ||
      typeof quota.hourly_percentage === 'number' ||
      typeof quota.weekly_percentage === 'number'
    )
  )

  return {
    id: account.id,
    email: String(account.email || ''),
    name: String(account.name || ''),
    auth_mode: String(account.auth_mode || ''),
    plan_type: String(account.plan_type || ''),
    plan_name: String(account.plan_name || ''),
    tier_id: String(account.tier_id || ''),
    tags: Array.isArray(account.tags) ? account.tags.slice(0, 50) : [],
    created_at: Number(account.created_at || nowMs()),
    last_used: Number(account.last_used || 0),
    updated_at: Number(account.updated_at || nowMs()),
    has_quota: hasQuota,
    quota_updated_at: Number((quota && quota.updated_at) || 0)
  }
}

function _writeIndexFromAccounts (platform, accounts) {
  const indexPath = _indexPath(platform)
  const index = {
    schema_version: DATA_SCHEMA_VERSION,
    updated_at: nowMs(),
    accounts: accounts.map(_buildIndexRecord)
  }
  return fileUtils.writeJsonFile(indexPath, index)
}

function _accountFilePath (platform, accountId) {
  const safeId = _sanitizeFileStem(accountId)
  return path.join(_accountsDir(platform), safeId + '.json')
}

function _sanitizeFileStem (value) {
  const raw = String(value || '').trim()
  if (!raw) return 'item_' + fileUtils.generateId()

  const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, '_')
  if (normalized && normalized !== '.' && normalized !== '..') {
    return normalized
  }
  return 'item_' + crypto.createHash('md5').update(raw).digest('hex')
}

function _loadAccountDetailById (platform, accountId) {
  if (!accountId) return null
  const detail = fileUtils.readJsonFile(_accountFilePath(platform, accountId))
  if (!detail || typeof detail !== 'object') return null
  return detail
}

function _loadAccountsFromDetails (platform) {
  const dir = _accountsDir(platform)
  const files = fileUtils.listFiles(dir)
  const accounts = []

  for (let i = 0; i < files.length; i++) {
    const file = String(files[i] || '')
    if (!file.endsWith('.json')) continue

    const detail = fileUtils.readJsonFile(path.join(dir, file))
    if (!detail || typeof detail !== 'object') continue
    const normalized = _prepareAccountForStorage(platform, detail)
    if (!normalized) continue
    accounts.push(normalized)
  }

  accounts.sort(function (left, right) {
    const lLast = Number(left.last_used || 0)
    const rLast = Number(right.last_used || 0)
    if (rLast !== lLast) return rLast - lLast

    const lCreated = Number(left.created_at || 0)
    const rCreated = Number(right.created_at || 0)
    if (rCreated !== lCreated) return rCreated - lCreated

    return String(left.id || '').localeCompare(String(right.id || ''))
  })

  return _dedupeByIdentity(platform, accounts)
}

function _dedupeByIdentity (platform, accounts) {
  const deduped = []

  for (let i = 0; i < accounts.length; i++) {
    const incoming = accounts[i]
    const idx = _findExistingAccountIndex(platform, deduped, incoming)
    if (idx < 0) {
      deduped.push(incoming)
      continue
    }

    const existing = deduped[idx]
    const merged = _mergeAccountForStorage(platform, existing, incoming)
    const exTs = Number(existing.updated_at || 0)
    const inTs = Number(incoming.updated_at || 0)
    merged.updated_at = Math.max(exTs, inTs, nowMs())
    deduped[idx] = merged
  }

  return deduped
}

function _persistAccounts (platform, accounts) {
  _assertPlatform(platform)

  const normalized = []
  for (let i = 0; i < accounts.length; i++) {
    const prepared = _prepareAccountForStorage(platform, accounts[i])
    if (prepared) {
      normalized.push(prepared)
    }
  }

  const deduped = _dedupeByIdentity(platform, normalized)
  const dir = _accountsDir(platform)
  const keep = new Set()

  for (let i = 0; i < deduped.length; i++) {
    const account = deduped[i]
    const filePath = _accountFilePath(platform, account.id)
    keep.add(path.basename(filePath))
    fileUtils.writeJsonFile(filePath, account)
  }

  const existingFiles = fileUtils.listFiles(dir)
  for (let i = 0; i < existingFiles.length; i++) {
    const file = String(existingFiles[i] || '')
    if (!file.endsWith('.json')) continue
    if (keep.has(file)) continue
    fileUtils.deleteFile(path.join(dir, file))
  }

  _writeIndexFromAccounts(platform, deduped)

  const currentId = getCurrentId(platform)
  if (currentId && !deduped.some(a => a.id === currentId)) {
    clearCurrentId(platform)
  }

  _touchMeta()
  return deduped
}

/**
 * 获取某平台的全部账号
 * @param {string} platform
 * @returns {Array}
 */
function listAccounts (platform) {
  _assertPlatform(platform)
  initStorage()

  const index = _readIndex(platform)
  const list = []
  let dirty = false

  for (let i = 0; i < index.accounts.length; i++) {
    const summary = index.accounts[i]
    if (!summary || !summary.id) {
      dirty = true
      continue
    }

    const detail = _loadAccountDetailById(platform, summary.id)
    if (!detail) {
      dirty = true
      continue
    }

    const prepared = _prepareAccountForStorage(platform, detail)
    if (!prepared) {
      dirty = true
      continue
    }

    list.push(prepared)
  }

  if (dirty) {
    return _persistAccounts(platform, list)
  }

  return list
}

/**
 * 保存某平台全部账号（覆盖写入）
 * @param {string} platform
 * @param {Array} accounts
 */
function saveAccounts (platform, accounts) {
  _persistAccounts(platform, Array.isArray(accounts) ? accounts : [])
}

/**
 * 获取单个账号
 * @param {string} platform
 * @param {string} accountId
 * @returns {object|null}
 */
function getAccount (platform, accountId) {
  const accounts = listAccounts(platform)
  return accounts.find(function (a) { return a.id === accountId }) || null
}

/**
 * 添加账号（如果命中身份则更新）
 * @param {string} platform
 * @param {object} account
 * @param {object} [options]
 * @returns {object|null}
 */
function addAccount (platform, account, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const prepared = _prepareAccountForStorage(platform, account)
  if (!prepared) return null

  const accounts = listAccounts(platform)
  const existingIndex = _findExistingAccountIndex(platform, accounts, prepared)

  if (existingIndex >= 0) {
    const existing = accounts[existingIndex]
    if (opts.mode === 'sync') {
      const localTs = Number(existing.updated_at || 0)
      const incomingTs = Number(prepared.updated_at || 0)
      if (localTs > incomingTs) {
        return existing
      }
    }

    const merged = _mergeAccountForStorage(platform, existing, prepared)
    merged.updated_at = Number(prepared.updated_at || nowMs())
    accounts[existingIndex] = merged
    const persisted = _persistAccounts(platform, accounts)
    return persisted[existingIndex] || merged
  }

  prepared.updated_at = Number(prepared.updated_at || nowMs())
  accounts.push(prepared)
  const persisted = _persistAccounts(platform, accounts)
  return persisted.find(a => a.id === prepared.id) || prepared
}

/**
 * 批量添加账号
 * @param {string} platform
 * @param {Array} newAccounts
 * @returns {number}
 */
function addAccounts (platform, newAccounts) {
  let count = 0
  const incoming = Array.isArray(newAccounts) ? newAccounts : []
  for (let i = 0; i < incoming.length; i++) {
    const saved = addAccount(platform, incoming[i])
    if (saved) count++
  }
  return count
}

/**
 * 更新账号
 * @param {string} platform
 * @param {string} accountId
 * @param {object} updates
 * @returns {object|null}
 */
function updateAccount (platform, accountId, updates) {
  const accounts = listAccounts(platform)
  const index = accounts.findIndex(function (a) { return a.id === accountId })
  if (index < 0) return null

  const existing = accounts[index]
  const incoming = Object.assign({}, existing, updates || {}, {
    id: existing.id,
    created_at: existing.created_at,
    updated_at: nowMs()
  })
  accounts[index] = _mergeAccountForStorage(platform, existing, incoming)
  accounts[index].updated_at = nowMs()

  const persisted = _persistAccounts(platform, accounts)
  return persisted.find(a => a.id === accountId) || null
}

/**
 * 删除单个账号
 * @param {string} platform
 * @param {string} accountId
 * @returns {boolean}
 */
function deleteAccount (platform, accountId) {
  const accounts = listAccounts(platform)
  const filtered = accounts.filter(function (a) { return a.id !== accountId })
  if (filtered.length === accounts.length) return false
  _persistAccounts(platform, filtered)

  if (getCurrentId(platform) === accountId) {
    clearCurrentId(platform)
  }

  _touchMeta()
  return true
}

/**
 * 批量删除账号
 * @param {string} platform
 * @param {string[]} accountIds
 * @returns {number}
 */
function deleteAccounts (platform, accountIds) {
  const idSet = new Set(Array.isArray(accountIds) ? accountIds : [])
  const accounts = listAccounts(platform)
  const filtered = accounts.filter(function (a) { return !idSet.has(a.id) })
  const deletedCount = accounts.length - filtered.length
  if (deletedCount <= 0) return 0

  _persistAccounts(platform, filtered)

  const currentId = getCurrentId(platform)
  if (currentId && idSet.has(currentId)) {
    clearCurrentId(platform)
  }

  _touchMeta()
  return deletedCount
}

/**
 * 获取当前激活账号 ID
 * @param {string} platform
 * @returns {string|null}
 */
function getCurrentId (platform) {
  _assertPlatform(platform)
  const current = fileUtils.readJsonFile(_currentPath(platform))
  if (!current || typeof current !== 'object') return null
  const id = String(current.id || '').trim()
  return id || null
}

/**
 * 设置当前激活账号 ID
 * @param {string} platform
 * @param {string} accountId
 */
function setCurrentId (platform, accountId) {
  _assertPlatform(platform)
  fileUtils.writeJsonFile(_currentPath(platform), {
    id: String(accountId || '').trim(),
    updated_at: nowMs()
  })
  _touchMeta()
}

/**
 * 清除当前激活账号
 * @param {string} platform
 */
function clearCurrentId (platform) {
  _assertPlatform(platform)
  fileUtils.deleteFile(_currentPath(platform))
  _touchMeta()
}

/**
 * 获取当前激活账号对象
 * @param {string} platform
 * @returns {object|null}
 */
function getCurrentAccount (platform) {
  const id = getCurrentId(platform)
  if (!id) return null
  return getAccount(platform, id)
}

/**
 * 导出指定账号为 JSON 字符串
 * @param {string} platform
 * @param {string[]} accountIds
 * @returns {string}
 */
function exportAccounts (platform, accountIds) {
  const accounts = listAccounts(platform)
  const idSet = new Set(Array.isArray(accountIds) ? accountIds : [])
  const selected = accounts.filter(function (a) { return idSet.has(a.id) })
  return JSON.stringify(selected, null, 2)
}

/**
 * 获取账号总数
 * @param {string} platform
 * @returns {number}
 */
function getAccountCount (platform) {
  return listAccounts(platform).length
}

// ---------------- OAuth Pending ----------------

function saveOAuthPending (platform, payload) {
  _assertPlatform(platform)
  if (!payload || typeof payload !== 'object') return false

  const sessionId = String(payload.sessionId || '').trim()
  if (!sessionId) return false

  const next = Object.assign({}, payload, {
    sessionId,
    updated_at: nowMs()
  })
  return fileUtils.writeJsonFile(_pendingPath(platform, sessionId), next)
}

function getOAuthPending (platform, sessionId) {
  _assertPlatform(platform)
  const sid = String(sessionId || '').trim()
  if (!sid) return null
  const data = fileUtils.readJsonFile(_pendingPath(platform, sid))
  if (!data || typeof data !== 'object') return null
  return data
}

function getLatestOAuthPending (platform, maxAgeMs) {
  _assertPlatform(platform)
  const ttl = Number(maxAgeMs || 0)
  const now = nowMs()
  const dir = getOAuthPendingDir(platform)
  const files = fileUtils.listFiles(dir)

  let latest = null
  let latestTs = 0

  for (let i = 0; i < files.length; i++) {
    const file = String(files[i] || '')
    if (!file.endsWith('.json')) continue

    const fullPath = path.join(dir, file)
    const data = fileUtils.readJsonFile(fullPath)
    if (!data || typeof data !== 'object') continue

    const ts = Number(data.updated_at || data.createdAt || 0)
    if (ttl > 0 && ts > 0 && now - ts > ttl) continue

    if (ts >= latestTs) {
      latestTs = ts
      latest = data
    }
  }

  return latest
}

function clearOAuthPending (platform, sessionId) {
  _assertPlatform(platform)
  const sid = String(sessionId || '').trim()
  if (!sid) return true
  return fileUtils.deleteFile(_pendingPath(platform, sid))
}

function cleanupOAuthPending (platform, ttlMs) {
  _assertPlatform(platform)
  const ttl = Number(ttlMs || 0)
  if (!(ttl > 0)) return 0

  const now = nowMs()
  const dir = getOAuthPendingDir(platform)
  const files = fileUtils.listFiles(dir)
  let deleted = 0

  for (let i = 0; i < files.length; i++) {
    const file = String(files[i] || '')
    if (!file.endsWith('.json')) continue

    const fullPath = path.join(dir, file)
    const data = fileUtils.readJsonFile(fullPath)
    const ts = Number(data && (data.updated_at || data.createdAt) ? (data.updated_at || data.createdAt) : 0)
    if (ts > 0 && now - ts <= ttl) continue

    if (fileUtils.deleteFile(fullPath)) {
      deleted++
    }
  }

  return deleted
}

// ---------------- 同步加密预埋 ----------------

function _snapshotAllPlatforms () {
  const snapshot = {
    version: SYNC_SCHEMA_VERSION,
    created_at: nowMs(),
    schema_version: DATA_SCHEMA_VERSION,
    platforms: {}
  }

  for (let i = 0; i < SUPPORTED_PLATFORMS.length; i++) {
    const platform = SUPPORTED_PLATFORMS[i]
    snapshot.platforms[platform] = {
      current_id: getCurrentId(platform),
      accounts: listAccounts(platform)
    }
  }

  return snapshot
}

function _deriveSyncKey (passphrase, salt, kdfConfig) {
  const pass = String(passphrase || '')
  const cfg = Object.assign({}, DEFAULT_SCRYPT, kdfConfig || {})

  return crypto.scryptSync(pass, salt, Number(cfg.keyLen || 32), {
    N: Number(cfg.N || DEFAULT_SCRYPT.N),
    r: Number(cfg.r || DEFAULT_SCRYPT.r),
    p: Number(cfg.p || DEFAULT_SCRYPT.p),
    maxmem: Number(cfg.maxmem || DEFAULT_SCRYPT.maxmem)
  })
}

function buildEncryptedSyncPayload (passphrase) {
  const pass = String(passphrase || '')
  if (!pass) {
    return { success: false, error: '同步口令不能为空' }
  }

  try {
    initStorage()
    const plaintextObj = _snapshotAllPlatforms()
    const plaintext = Buffer.from(JSON.stringify(plaintextObj), 'utf8')

    const salt = crypto.randomBytes(16)
    const iv = crypto.randomBytes(12)
    const key = _deriveSyncKey(pass, salt, DEFAULT_SCRYPT)

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(SYNC_AAD, 'utf8'))
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()

    const envelope = {
      version: SYNC_SCHEMA_VERSION,
      aad: SYNC_AAD,
      cipher: {
        algorithm: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: tag.toString('base64')
      },
      kdf: {
        name: 'scrypt',
        salt: salt.toString('base64'),
        N: DEFAULT_SCRYPT.N,
        r: DEFAULT_SCRYPT.r,
        p: DEFAULT_SCRYPT.p,
        keyLen: DEFAULT_SCRYPT.keyLen
      },
      ciphertext: encrypted.toString('base64'),
      created_at: nowMs()
    }

    const syncDir = path.join(getDataRootDir(), 'sync')
    fileUtils.ensureDir(syncDir)
    fileUtils.writeJsonFile(path.join(syncDir, 'last-payload.json'), envelope)

    return {
      success: true,
      payload: envelope
    }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

function applyEncryptedSyncPayload (payload, passphrase) {
  const pass = String(passphrase || '')
  if (!pass) {
    return { success: false, error: '同步口令不能为空' }
  }

  try {
    const env = (typeof payload === 'string') ? JSON.parse(payload) : payload
    if (!env || typeof env !== 'object') {
      return { success: false, error: '无效的同步数据格式' }
    }

    const kdf = env.kdf || {}
    const cipherMeta = env.cipher || {}
    if (String(cipherMeta.algorithm || '').toLowerCase() !== 'aes-256-gcm') {
      return { success: false, error: '不支持的加密算法' }
    }

    const salt = Buffer.from(String(kdf.salt || ''), 'base64')
    const iv = Buffer.from(String(cipherMeta.iv || ''), 'base64')
    const tag = Buffer.from(String(cipherMeta.tag || ''), 'base64')
    const ciphertext = Buffer.from(String(env.ciphertext || ''), 'base64')
    if (!salt.length || !iv.length || !tag.length || !ciphertext.length) {
      return { success: false, error: '同步密文结构不完整' }
    }

    const key = _deriveSyncKey(pass, salt, {
      N: Number(kdf.N || DEFAULT_SCRYPT.N),
      r: Number(kdf.r || DEFAULT_SCRYPT.r),
      p: Number(kdf.p || DEFAULT_SCRYPT.p),
      keyLen: Number(kdf.keyLen || DEFAULT_SCRYPT.keyLen)
    })

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(String(env.aad || SYNC_AAD), 'utf8'))
    decipher.setAuthTag(tag)

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const snapshot = JSON.parse(plaintext.toString('utf8'))

    if (!snapshot || typeof snapshot !== 'object' || !snapshot.platforms || typeof snapshot.platforms !== 'object') {
      return { success: false, error: '解密成功但数据结构无效' }
    }

    let mergedAccounts = 0
    for (let i = 0; i < SUPPORTED_PLATFORMS.length; i++) {
      const platform = SUPPORTED_PLATFORMS[i]
      const platformSnapshot = snapshot.platforms[platform]
      if (!platformSnapshot || typeof platformSnapshot !== 'object') continue

      const incomingAccounts = Array.isArray(platformSnapshot.accounts)
        ? platformSnapshot.accounts
        : []

      for (let j = 0; j < incomingAccounts.length; j++) {
        const saved = addAccount(platform, incomingAccounts[j], { mode: 'sync' })
        if (saved) mergedAccounts++
      }

      const nextCurrent = String(platformSnapshot.current_id || '').trim()
      if (nextCurrent) {
        const currentExists = !!getAccount(platform, nextCurrent)
        if (currentExists) {
          setCurrentId(platform, nextCurrent)
        }
      }
    }

    _touchMeta()
    return {
      success: true,
      merged_accounts: mergedAccounts
    }
  } catch (err) {
    return { success: false, error: '同步数据解密失败: ' + (err.message || String(err)) }
  }
}

// ---------------- 身份去重与合并 ----------------

function _prepareAccountForStorage (platform, account) {
  if (!account || typeof account !== 'object') return null

  const next = Object.assign({}, account)
  next.created_at = Number(next.created_at || nowMs())
  next.last_used = Number(next.last_used || 0)
  next.updated_at = Number(next.updated_at || nowMs())
  next.added_via = _normalizeString(next.added_via).toLowerCase()
  next.added_at = Number(next.added_at || 0)
  delete next.added_meta_override

  if (typeof next.email === 'string') {
    next.email = next.email.trim()
  }

  if (platform === 'codex') {
    const identity = _extractCodexIdentity(next)
    const email = _normalizeEmail(next.email || identity.email || '')
    if (!email) return null
    next.email = email
    next.account_id = identity.accountId || next.account_id || ''
    next.organization_id = identity.organizationId || next.organization_id || ''
    next.id = _buildCodexStorageId(next.email, next.account_id, next.organization_id)
    return next
  }

  if (platform === 'antigravity') {
    next.email = _normalizeEmail(next.email || '') || (next.email || 'unknown@antigravity')
    const token = (next.token && typeof next.token === 'object') ? Object.assign({}, next.token) : {}
    token.project_id = _normalizeString(token.project_id)
    next.token = token
    next.id = _buildAntigravityStorageId(next)
    return next
  }

  if (platform === 'gemini') {
    next.email = _normalizeEmail(next.email || '') || (next.email || 'unknown@gemini')
    next.auth_id = _normalizeString(next.auth_id)
    next.id = _buildGeminiStorageId(next)
    return next
  }

  return next
}

function _findExistingAccountIndex (platform, accounts, account) {
  if (platform === 'codex') return _findExistingCodexAccountIndex(accounts, account)
  if (platform === 'antigravity') return _findExistingAntigravityAccountIndex(accounts, account)
  if (platform === 'gemini') return _findExistingGeminiAccountIndex(accounts, account)

  return accounts.findIndex(function (a) {
    return a.id === account.id || _normalizeEmail(a.email) === _normalizeEmail(account.email)
  })
}

function _findExistingCodexAccountIndex (accounts, incomingAccount) {
  if (!Array.isArray(accounts) || !incomingAccount) return -1

  const incomingId = _normalizeString(incomingAccount.id)
  if (!incomingId) return -1
  return accounts.findIndex(function (existing) {
    return _normalizeString(existing && existing.id) === incomingId
  })
}

function _findExistingAntigravityAccountIndex (accounts, incomingAccount) {
  if (!Array.isArray(accounts) || !incomingAccount) return -1

  const incomingId = _normalizeString(incomingAccount.id)
  const incomingEmail = _normalizeEmail(incomingAccount.email)
  const incomingToken = (incomingAccount && incomingAccount.token) || {}
  const incomingRefresh = _normalizeString(incomingToken.refresh_token)
  const incomingAccess = _normalizeString(incomingToken.access_token)
  const incomingProject = _normalizeString(incomingToken.project_id)

  let firstEmailMatchIndex = -1
  let emailMatchCount = 0

  for (let i = 0; i < accounts.length; i++) {
    const existing = accounts[i] || {}
    const existingId = _normalizeString(existing.id)
    if (incomingId && existingId && incomingId === existingId) return i

    const existingToken = (existing && existing.token) || {}
    const existingRefresh = _normalizeString(existingToken.refresh_token)
    const existingAccess = _normalizeString(existingToken.access_token)
    const existingProject = _normalizeString(existingToken.project_id)

    if (incomingRefresh && existingRefresh && incomingRefresh === existingRefresh) return i
    if (incomingAccess && existingAccess && incomingAccess === existingAccess) return i

    const existingEmail = _normalizeEmail(existing.email)
    if (!incomingEmail || !existingEmail || incomingEmail !== existingEmail) continue

    emailMatchCount++
    if (firstEmailMatchIndex < 0) firstEmailMatchIndex = i

    if (incomingProject && existingProject && incomingProject === existingProject) return i
  }

  if (emailMatchCount === 1) {
    return firstEmailMatchIndex
  }
  return -1
}

function _findExistingGeminiAccountIndex (accounts, incomingAccount) {
  if (!Array.isArray(accounts) || !incomingAccount) return -1

  const incomingId = _normalizeString(incomingAccount.id)
  const incomingEmail = _normalizeEmail(incomingAccount.email)
  const incomingAuthId = _normalizeString(incomingAccount.auth_id)
  const incomingRefresh = _normalizeString(incomingAccount.refresh_token || (incomingAccount.tokens && incomingAccount.tokens.refresh_token))
  const incomingAccess = _normalizeString(incomingAccount.access_token || (incomingAccount.tokens && incomingAccount.tokens.access_token))
  let firstEmailMatchIndex = -1
  let emailMatchCount = 0

  for (let i = 0; i < accounts.length; i++) {
    const existing = accounts[i] || {}
    if (incomingId && _normalizeString(existing.id) === incomingId) return i

    const existingAuthId = _normalizeString(existing.auth_id)
    if (incomingAuthId && existingAuthId && incomingAuthId === existingAuthId) return i

    const existingRefresh = _normalizeString(existing.refresh_token || (existing.tokens && existing.tokens.refresh_token))
    const existingAccess = _normalizeString(existing.access_token || (existing.tokens && existing.tokens.access_token))
    if (incomingRefresh && existingRefresh && incomingRefresh === existingRefresh) return i
    if (incomingAccess && existingAccess && incomingAccess === existingAccess) return i

    const existingEmail = _normalizeEmail(existing.email)
    if (!incomingEmail || !existingEmail || incomingEmail !== existingEmail) continue

    emailMatchCount++
    if (firstEmailMatchIndex < 0) firstEmailMatchIndex = i
  }

  if (emailMatchCount === 1) {
    return firstEmailMatchIndex
  }
  return -1
}

function _mergeAccountForStorage (platform, existing, incoming) {
  if (platform === 'antigravity') {
    return _mergeAntigravityAccount(existing, incoming)
  }
  if (platform === 'codex') {
    return _mergeCodexAccount(existing, incoming)
  }
  if (platform === 'gemini') {
    return _mergeGeminiAccount(existing, incoming)
  }

  return Object.assign({}, existing, incoming, {
    id: existing.id || incoming.id,
    created_at: existing.created_at || incoming.created_at || nowMs(),
    last_used: Number(existing.last_used || incoming.last_used || 0)
  })
}

function _mergeCodexAccount (existing, incoming) {
  const existingTokens = (existing && existing.tokens && typeof existing.tokens === 'object')
    ? existing.tokens
    : {}
  const incomingTokens = (incoming && incoming.tokens && typeof incoming.tokens === 'object')
    ? incoming.tokens
    : {}

  const mergedTokens = Object.assign({}, existingTokens, incomingTokens)
  if (!_normalizeString(incomingTokens.access_token) && _normalizeString(existingTokens.access_token)) {
    mergedTokens.access_token = existingTokens.access_token
  }
  if (!_normalizeString(incomingTokens.refresh_token) && _normalizeString(existingTokens.refresh_token)) {
    mergedTokens.refresh_token = existingTokens.refresh_token
  }
  if (!_normalizeString(incomingTokens.id_token) && _normalizeString(existingTokens.id_token)) {
    mergedTokens.id_token = existingTokens.id_token
  }

  const merged = Object.assign({}, existing, incoming, {
    id: existing.id || incoming.id,
    email: _normalizeEmail(incoming.email || existing.email) || incoming.email || existing.email,
    created_at: Number(existing.created_at || incoming.created_at || nowMs()),
    last_used: Number(existing.last_used || incoming.last_used || 0),
    tokens: mergedTokens
  })

  const existingAddedAt = Number(existing && existing.added_at ? existing.added_at : 0)
  const incomingAddedAt = Number(incoming && incoming.added_at ? incoming.added_at : 0)
  const defaultAddedAt = Number(existing.created_at || incoming.created_at || 0)
  const existingAddedVia = _normalizeString(existing && existing.added_via).toLowerCase()
  const incomingAddedVia = _normalizeString(incoming && incoming.added_via).toLowerCase()
  const overrideAddedMeta = Boolean(incoming && incoming.added_meta_override === true)

  if (overrideAddedMeta) {
    merged.added_via = incomingAddedVia || existingAddedVia || ''
    merged.added_at = incomingAddedAt || existingAddedAt || defaultAddedAt || 0
  } else {
    merged.added_via = existingAddedVia || incomingAddedVia || ''
    merged.added_at = existingAddedAt || incomingAddedAt || defaultAddedAt || 0
  }
  delete merged.added_meta_override

  return merged
}

function _mergeGeminiAccount (existing, incoming) {
  const merged = Object.assign({}, existing, incoming, {
    id: existing.id || incoming.id,
    email: _normalizeEmail(incoming.email || existing.email) || incoming.email || existing.email,
    created_at: Number(existing.created_at || incoming.created_at || nowMs()),
    last_used: Number(existing.last_used || incoming.last_used || 0)
  })

  if (!_normalizeString(incoming.access_token) && _normalizeString(existing.access_token)) {
    merged.access_token = existing.access_token
  }
  if (!_normalizeString(incoming.refresh_token) && _normalizeString(existing.refresh_token)) {
    merged.refresh_token = existing.refresh_token
  }
  if (!_normalizeString(incoming.id_token) && _normalizeString(existing.id_token)) {
    merged.id_token = existing.id_token
  }
  if (!_normalizeString(incoming.auth_id) && _normalizeString(existing.auth_id)) {
    merged.auth_id = existing.auth_id
  }

  return merged
}

function _mergeAntigravityAccount (existing, incoming) {
  const existingToken = (existing && existing.token && typeof existing.token === 'object')
    ? existing.token
    : {}
  const incomingToken = (incoming && incoming.token && typeof incoming.token === 'object')
    ? incoming.token
    : {}

  const mergedToken = Object.assign({}, existingToken, incomingToken)
  if (!_normalizeString(incomingToken.access_token) && _normalizeString(existingToken.access_token)) {
    mergedToken.access_token = existingToken.access_token
  }
  if (!_normalizeString(incomingToken.refresh_token) && _normalizeString(existingToken.refresh_token)) {
    mergedToken.refresh_token = existingToken.refresh_token
  }
  if (!_normalizeString(incomingToken.token_type) && _normalizeString(existingToken.token_type)) {
    mergedToken.token_type = existingToken.token_type
  }
  if (!_normalizeString(incomingToken.project_id) && _normalizeString(existingToken.project_id)) {
    mergedToken.project_id = existingToken.project_id
  }
  if (!Number.isFinite(Number(incomingToken.expiry_timestamp)) && Number.isFinite(Number(existingToken.expiry_timestamp))) {
    mergedToken.expiry_timestamp = existingToken.expiry_timestamp
  }

  const existingQuota = existing && existing.quota
  const incomingQuota = incoming && incoming.quota
  const existingHasModels = _hasQuotaModels(existingQuota)
  const incomingHasModels = _hasQuotaModels(incomingQuota)
  const incomingHasTags = Array.isArray(incoming && incoming.tags)

  let mergedQuota = incomingQuota
  if (!incomingHasModels && existingHasModels) {
    if (incomingQuota && typeof incomingQuota === 'object') {
      mergedQuota = Object.assign({}, incomingQuota, { models: existingQuota.models })
    } else {
      mergedQuota = existingQuota
    }
  } else if (!incomingQuota && existingQuota) {
    mergedQuota = existingQuota
  }

  return Object.assign({}, existing, incoming, {
    id: existing.id || incoming.id,
    email: _normalizeEmail(incoming.email || existing.email) || incoming.email || existing.email,
    name: incoming.name || existing.name || '',
    tags: incomingHasTags ? incoming.tags : (existing.tags || []),
    token: mergedToken,
    quota: mergedQuota,
    created_at: Number(existing.created_at || incoming.created_at || nowMs()),
    last_used: Number(existing.last_used || incoming.last_used || 0)
  })
}

function _hasQuotaModels (quota) {
  if (!quota || typeof quota !== 'object') return false
  if (Array.isArray(quota.models)) return quota.models.length > 0
  if (quota.models && typeof quota.models === 'object') return Object.keys(quota.models).length > 0
  return false
}

function _extractCodexIdentity (account) {
  const tokens = (account && account.tokens) || {}
  const accessToken = _normalizeString(tokens.access_token || account.access_token || account.token || '')
  const refreshToken = _normalizeString(tokens.refresh_token || account.refresh_token || '')
  const idToken = _normalizeString(tokens.id_token || account.id_token || '')
  const accessPayload = _decodeJwtPayload(accessToken)
  const idPayload = _decodeJwtPayload(idToken)
  const accessAuth = (accessPayload && accessPayload['https://api.openai.com/auth']) || {}
  const idAuth = (idPayload && idPayload['https://api.openai.com/auth']) || {}
  const accessData = (accessPayload && typeof accessPayload === 'object') ? accessPayload : {}
  const idData = (idPayload && typeof idPayload === 'object') ? idPayload : {}

  const email = _normalizeEmail(account.email || idData.email || accessData.email)
  const accountId = _normalizeString(
    account.account_id ||
    account.accountId ||
    tokens.account_id ||
    tokens.accountId ||
    accessAuth.chatgpt_account_id ||
    accessAuth.account_id ||
    idAuth.chatgpt_account_id ||
    idAuth.account_id ||
    accessData.account_id ||
    idData.account_id
  )
  const organizationId = _normalizeString(
    account.organization_id ||
    account.organizationId ||
    tokens.organization_id ||
    tokens.organizationId ||
    accessAuth.organization_id ||
    accessAuth.chatgpt_organization_id ||
    accessAuth.chatgpt_org_id ||
    accessAuth.org_id ||
    idAuth.organization_id ||
    idAuth.chatgpt_organization_id ||
    idAuth.chatgpt_org_id ||
    idAuth.org_id
  )

  return {
    email,
    accountId,
    organizationId,
    accessToken,
    refreshToken
  }
}

function _buildCodexStorageId (email, accountId, organizationId) {
  const seed = [
    _normalizeEmail(email) || 'unknown@codex',
    _normalizeString(accountId),
    _normalizeString(organizationId)
  ].filter(Boolean).join('|')
  return 'codex_' + crypto.createHash('md5').update(seed).digest('hex')
}

function _buildAntigravityStorageId (account) {
  const token = (account && account.token) || {}
  const refreshToken = _normalizeString(token.refresh_token)
  const accessToken = _normalizeString(token.access_token)
  const seed = [
    _normalizeEmail(account && account.email),
    _normalizeString(token.project_id),
    refreshToken || accessToken
  ].filter(Boolean).join('|')

  if (!seed) {
    return 'antigravity_' + fileUtils.generateId()
  }
  return 'antigravity_' + crypto.createHash('md5').update(seed).digest('hex')
}

function _buildGeminiStorageId (account) {
  const refreshToken = _normalizeString(account && account.refresh_token)
  const accessToken = _normalizeString(account && account.access_token)
  const seed = [
    _normalizeString(account && account.auth_id),
    _normalizeEmail(account && account.email),
    refreshToken || accessToken
  ].filter(Boolean).join('|')

  if (!seed) {
    return 'gemini_' + fileUtils.generateId()
  }
  return 'gemini_' + crypto.createHash('md5').update(seed).digest('hex')
}

function _decodeJwtPayload (token) {
  const raw = _normalizeString(token)
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

function _normalizeString (value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed || ''
}

function _normalizeEmail (value) {
  const trimmed = _normalizeString(value)
  return trimmed ? trimmed.toLowerCase() : ''
}

module.exports = {
  initStorage,
  getDataRootDir,
  getPlatformDataDir,
  getOAuthPendingDir,
  repairIndex,

  listAccounts,
  saveAccounts,
  getAccount,
  addAccount,
  addAccounts,
  updateAccount,
  deleteAccount,
  deleteAccounts,
  getCurrentId,
  setCurrentId,
  clearCurrentId,
  getCurrentAccount,
  exportAccounts,
  getAccountCount,

  saveOAuthPending,
  getOAuthPending,
  getLatestOAuthPending,
  clearOAuthPending,
  cleanupOAuthPending,

  buildEncryptedSyncPayload,
  applyEncryptedSyncPayload
}
