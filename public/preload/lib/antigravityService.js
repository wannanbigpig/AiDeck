/**
 * antigravityService.js — Antigravity 账号管理服务
 *
 * 数据存储位置：
 *   - 本地凭证：~/.antigravity_cockpit/
 *   - 索引数据：uTools dbStorage (aideck:antigravity:*)
 *
 * 核心能力：
 *   - 账号导入（本地 / JSON）
 *   - 账号切换（写入本地凭证文件）
 *   - 配额查询
 */

const path = require('node:path')
const fileUtils = require('./fileUtils')
const storage = require('./accountStorage')

const PLATFORM = 'antigravity'

// Google Cloud Code API（配额查询）
const CLOUD_CODE_BASE_URL = 'https://cloudcode-pa.googleapis.com'
const FETCH_MODELS_PATH = 'v1internal:fetchAvailableModels'

// Antigravity OAuth2 凭证（提取自 cockpit-tools）
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || 'YOUR_CLIENT_ID'
const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || 'YOUR_CLIENT_SECRET'

/**
 * 获取 Antigravity 配置目录路径
 * @returns {string}
 */
function getConfigDir () {
  return path.join(fileUtils.getHomeDir(), '.antigravity_cockpit')
}

/**
 * 列出所有 Antigravity 账号
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
 * 从本地 ~/.antigravity_cockpit 目录导入账号
 * @returns {object} { imported: Array, error: string|null }
 */
function importFromLocal () {
  const configDir = getConfigDir()
  if (!fileUtils.dirExists(configDir)) {
    return { imported: [], error: '未找到 Antigravity 配置目录: ' + configDir }
  }

  // 尝试读取 accounts.json 或遍历目录
  const accountsFile = path.join(configDir, 'accounts.json')
  const accountsData = fileUtils.readJsonFile(accountsFile)

  if (accountsData && Array.isArray(accountsData)) {
    const imported = []
    for (let i = 0; i < accountsData.length; i++) {
      const raw = accountsData[i]
      if (!raw || !raw.token) continue
      const account = normalizeAccount(raw)
      if (account) {
        storage.addAccount(PLATFORM, account)
        imported.push(account)
      }
    }
    return { imported: imported, error: null }
  }

  // 尝试从当前凭证文件导入
  const tokenFile = path.join(configDir, 'token.json')
  const tokenData = fileUtils.readJsonFile(tokenFile)
  if (tokenData && tokenData.access_token) {
    const account = {
      id: fileUtils.generateId(),
      email: tokenData.email || 'local@antigravity',
      token: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || '',
        expires_in: tokenData.expires_in || 3600,
        expiry_timestamp: tokenData.expiry_timestamp || 0,
        token_type: tokenData.token_type || 'Bearer'
      },
      tags: ['本地导入'],
      created_at: Date.now(),
      last_used: 0
    }
    storage.addAccount(PLATFORM, account)
    return { imported: [account], error: null }
  }

  return { imported: [], error: '未找到有效的账号数据' }
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
 * @returns {object} 新增的账号
 */
function addWithToken (refreshToken) {
  const account = {
    id: fileUtils.generateId(),
    email: 'token-import@antigravity',
    token: {
      access_token: '',
      refresh_token: refreshToken,
      expires_in: 0,
      expiry_timestamp: 0,
      token_type: 'Bearer'
    },
    tags: ['Token 导入'],
    created_at: Date.now(),
    last_used: 0
  }
  storage.addAccount(PLATFORM, account)
  return account
}

/**
 * 切换账号：将凭证写入本地文件
 * @param {string} accountId
 * @returns {object} { success: boolean, error: string|null }
 */
function switchAccount (accountId) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    return { success: false, error: '账号不存在' }
  }

  // 写入本地凭证文件
  const configDir = getConfigDir()
  fileUtils.ensureDir(configDir)

  const tokenFile = path.join(configDir, 'token.json')
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
    return { success: false, error: '写入凭证文件失败' }
  }

  // 更新 last_used 时间戳
  storage.updateAccount(PLATFORM, accountId, { last_used: Date.now() })
  storage.setCurrentId(PLATFORM, accountId)

  return { success: true, error: null }
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
    return { success: false, quota: null, error: '账号不存在' }
  }

  // 异步执行，返回 Promise
  return _refreshQuotaAsync(account, accountId)
}

/**
 * 内部异步配额刷新
 */
async function _refreshQuotaAsync (account, accountId) {
  const http = require('./httpClient')

  try {
    // 1. 确保 access_token 有效
    const token = account.token || {}
    let accessToken = token.access_token

    // 检查是否过期（预留 5 分钟缓冲）
    const now = Math.floor(Date.now() / 1000)
    if (!accessToken || (token.expiry_timestamp && token.expiry_timestamp < now + 300)) {
      if (!token.refresh_token) {
        return { success: false, quota: null, error: 'Token 已过期且无 refresh_token' }
      }
      const refreshed = await _refreshAntigravityToken(token.refresh_token)
      if (!refreshed.ok) {
        return { success: false, quota: null, error: '刷新 Token 失败: ' + refreshed.error }
      }
      // 更新 token 信息
      accessToken = refreshed.access_token
      const tokenUpdate = {
        token: Object.assign({}, token, {
          access_token: refreshed.access_token,
          expires_in: refreshed.expires_in,
          expiry_timestamp: now + (refreshed.expires_in || 3600)
        })
      }
      storage.updateAccount(PLATFORM, accountId, tokenUpdate)
    }

    // 2. 调用 fetchAvailableModels API
    const projectId = token.project_id || ''
    const payload = projectId ? { project: projectId } : {}
    const res = await http.postJSON(
      CLOUD_CODE_BASE_URL + '/' + FETCH_MODELS_PATH,
      {
        Authorization: 'Bearer ' + accessToken,
        'User-Agent': 'antigravity/1.20.5 windows/amd64',
        'Accept-Encoding': 'gzip'
      },
      payload
    )

    if (!res.ok) {
      return {
        success: false,
        quota: null,
        error: 'API 返回 ' + res.status + ': ' + (res.raw || '').slice(0, 200)
      }
    }

    // 3. 解析配额数据
    const quota = _parseAntigravityQuota(res.data)
    storage.updateAccount(PLATFORM, accountId, { quota: quota })

    return { success: true, quota: quota, error: null }
  } catch (err) {
    return { success: false, quota: null, error: err.message || String(err) }
  }
}

/**
 * 刷新 Antigravity access_token
 * Google OAuth2: https://oauth2.googleapis.com/token
 */
async function _refreshAntigravityToken (refreshToken) {
  const http = require('./httpClient')
  const res = await http.postForm(GOOGLE_TOKEN_URL, {
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })

  if (!res.ok || !res.data || !res.data.access_token) {
    return { ok: false, error: (res.raw || '').slice(0, 200) }
  }

  return {
    ok: true,
    access_token: res.data.access_token,
    expires_in: res.data.expires_in || 3600
  }
}

/**
 * 解析 fetchAvailableModels API 响应为配额数据
 * @param {object} data - API 响应 { models: { "model-name": { quotaInfo: { remainingFraction, resetTime } } } }
 * @returns {object} 配额对象
 */
function _parseAntigravityQuota (data) {
  const models = []
  if (data && data.models) {
    const entries = Object.entries(data.models)
    for (let i = 0; i < entries.length; i++) {
      const name = entries[i][0]
      const info = entries[i][1]
      // 只保留 gemini/claude 模型（与 cockpit-tools 行为一致）
      if (!name.includes('gemini') && !name.includes('claude')) continue
      const qi = info.quotaInfo || {}
      const fraction = qi.remainingFraction
      const percentage = typeof fraction === 'number' ? Math.round(fraction * 100) : 0
      models.push({
        name: name,
        display_name: info.displayName || name,
        percentage: percentage,
        reset_time: qi.resetTime || ''
      })
    }
  }
  return {
    models: models,
    updated_at: Math.floor(Date.now() / 1000)
  }
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

  if (!accessToken && !refreshToken) {
    return null
  }

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
    quota: raw.quota || null,
    created_at: raw.created_at || Date.now(),
    last_used: raw.last_used || 0
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
  getConfigDir
}
