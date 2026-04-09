/**
 * geminiService.js — Gemini CLI 账号管理服务
 *
 * Gemini CLI 本地凭证文件位于 ~/.gemini/ 目录：
 *   - oauth_creds.json     (OAuth 凭证)
 *   - google_accounts.json (Google 账号信息)
 *   - settings.json        (配置)
 */

const path = require('node:path')
const fileUtils = require('./fileUtils')
const storage = require('./accountStorage')

const PLATFORM = 'gemini'

// Gemini OAuth2 凭证（提取自 cockpit-tools）
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GEMINI_CLIENT_ID = process.env.GEMINI_CLIENT_ID || 'YOUR_CLIENT_ID'
const GEMINI_CLIENT_SECRET = process.env.GEMINI_CLIENT_SECRET || 'YOUR_CLIENT_SECRET'

/**
 * 获取 Gemini CLI 配置目录
 * @returns {string}
 */
function getConfigDir () {
  return path.join(fileUtils.getHomeDir(), '.gemini')
}

/**
 * 列出所有 Gemini 账号
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
 * 从本地 ~/.gemini/ 目录导入账号
 * @returns {object} { imported: Array, error: string|null }
 */
function importFromLocal () {
  const configDir = getConfigDir()
  if (!fileUtils.dirExists(configDir)) {
    return { imported: [], error: '未找到 Gemini CLI 配置目录: ' + configDir }
  }

  const imported = []

  // 1. 尝试读取 oauth_creds.json
  const oauthFile = path.join(configDir, 'oauth_creds.json')
  const oauthData = fileUtils.readJsonFile(oauthFile)

  // 2. 尝试读取 google_accounts.json
  const googleAccountsFile = path.join(configDir, 'google_accounts.json')
  const googleAccounts = fileUtils.readJsonFile(googleAccountsFile)

  if (oauthData && oauthData.access_token) {
    const email = extractEmailFromGoogleAccounts(googleAccounts) ||
                  extractEmailFromToken(oauthData.id_token) ||
                  'local@gemini'

    const account = {
      id: fileUtils.generateId(),
      email: email,
      access_token: oauthData.access_token,
      refresh_token: oauthData.refresh_token || '',
      id_token: oauthData.id_token || '',
      token_type: oauthData.token_type || 'Bearer',
      scope: oauthData.scope || '',
      expiry_date: oauthData.expiry_date || null,
      tags: ['本地导入'],
      created_at: Date.now(),
      last_used: 0
    }
    storage.addAccount(PLATFORM, account)
    imported.push(account)
  }

  // 3. 如果 google_accounts.json 中有多个账号
  if (googleAccounts && Array.isArray(googleAccounts)) {
    for (let i = 0; i < googleAccounts.length; i++) {
      const ga = googleAccounts[i]
      if (!ga || !ga.access_token) continue
      // 避免重复导入（跟 oauth_creds 中的同一个）
      const email = ga.email || ga.name || 'account-' + i + '@gemini'
      const existing = storage.listAccounts(PLATFORM).find(function (a) {
        return a.email === email
      })
      if (existing) continue

      const account = {
        id: fileUtils.generateId(),
        email: email,
        access_token: ga.access_token,
        refresh_token: ga.refresh_token || '',
        id_token: ga.id_token || '',
        token_type: ga.token_type || 'Bearer',
        scope: ga.scope || '',
        expiry_date: ga.expiry_date || null,
        tier_id: ga.tier_id || '',
        plan_name: ga.plan_name || '',
        tags: ['本地导入'],
        created_at: Date.now(),
        last_used: 0
      }
      storage.addAccount(PLATFORM, account)
      imported.push(account)
    }
  }

  if (imported.length === 0) {
    return { imported: [], error: '未找到有效的 Gemini 账号数据' }
  }
  return { imported: imported, error: null }
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
      return { imported: [], error: '未找到有效的 Gemini 账号数据' }
    }
    return { imported: imported, error: null }
  } catch (err) {
    return { imported: [], error: 'JSON 解析失败: ' + err.message }
  }
}

/**
 * 注入账号到 ~/.gemini/ 目录
 * @param {string} accountId
 * @returns {object} { success: boolean, error: string|null }
 */
function inject (accountId) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    return { success: false, error: '账号不存在' }
  }

  const configDir = getConfigDir()
  fileUtils.ensureDir(configDir)

  // 写入 oauth_creds.json
  const oauthData = {
    access_token: account.access_token || '',
    refresh_token: account.refresh_token || '',
    id_token: account.id_token || '',
    token_type: account.token_type || 'Bearer',
    scope: account.scope || '',
    expiry_date: account.expiry_date || null
  }
  const oauthFile = path.join(configDir, 'oauth_creds.json')
  fileUtils.writeJsonFile(oauthFile, oauthData)

  // 更新 settings.json 中的 selected_auth_type
  const settingsFile = path.join(configDir, 'settings.json')
  const settings = fileUtils.readJsonFile(settingsFile) || {}
  settings.selected_auth_type = account.selected_auth_type || 'oauth'
  fileUtils.writeJsonFile(settingsFile, settings)

  // 更新状态
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
 * 批量删除
 * @param {string[]} accountIds
 * @returns {number}
 */
function deleteAccounts (accountIds) {
  return storage.deleteAccounts(PLATFORM, accountIds)
}

/**
 * 刷新 Gemini Token — 调用 Google OAuth2 API
 * @param {string} accountId
 * @returns {Promise<object>}
 */
function refreshToken (accountId) {
  const account = storage.getAccount(PLATFORM, accountId)
  if (!account) {
    return { success: false, error: '账号不存在' }
  }
  return _refreshGeminiTokenAsync(account, accountId)
}

async function _refreshGeminiTokenAsync (account, accountId) {
  const http = require('./httpClient')

  const refreshTokenValue = account.refresh_token
  if (!refreshTokenValue) {
    return { success: false, error: '账号无 refresh_token，无法刷新' }
  }

  try {
    const res = await http.postForm(GOOGLE_TOKEN_URL, {
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      refresh_token: refreshTokenValue,
      grant_type: 'refresh_token'
    })

    if (!res.ok || !res.data || !res.data.access_token) {
      return {
        success: false,
        error: 'Token 刷新失败: ' + (res.raw || '').slice(0, 200)
      }
    }

    // 更新账号信息
    const nowMs = Date.now()
    const expiresIn = res.data.expires_in || 3600
    const updates = {
      access_token: res.data.access_token,
      expiry_date: nowMs + expiresIn * 1000,
      last_used: nowMs
    }
    if (res.data.id_token) {
      updates.id_token = res.data.id_token
    }
    if (res.data.token_type) {
      updates.token_type = res.data.token_type
    }
    if (res.data.scope) {
      updates.scope = res.data.scope
    }

    storage.updateAccount(PLATFORM, accountId, updates)

    return { success: true, error: null, message: 'Token 刷新成功' }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
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
 * 更新标签
 * @param {string} accountId
 * @param {string[]} tags
 * @returns {object|null}
 */
function updateTags (accountId, tags) {
  return storage.updateAccount(PLATFORM, accountId, { tags: tags })
}

/**
 * 获取 Gemini Plan 显示名称
 * @param {object} account
 * @returns {string}
 */
function getPlanBadge (account) {
  const raw = (account.plan_name || account.tier_id || '').trim().toLowerCase()
  if (!raw) return 'UNKNOWN'
  if (raw.includes('ultra')) return 'ULTRA'
  if (raw.includes('pro') || raw.includes('premium')) return 'PRO'
  if (raw.includes('free') || raw === 'standard-tier') return 'FREE'
  return 'UNKNOWN'
}

// ---- 内部工具函数 ----

/**
 * 从 google_accounts.json 提取第一个邮箱
 * @param {*} data
 * @returns {string|null}
 */
function extractEmailFromGoogleAccounts (data) {
  if (!data) return null
  if (Array.isArray(data) && data.length > 0) {
    return data[0].email || data[0].name || null
  }
  if (data.email) return data.email
  return null
}

/**
 * 从 JWT/ID Token 提取邮箱
 * @param {string} token
 * @returns {string|null}
 */
function extractEmailFromToken (token) {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    const data = JSON.parse(decoded)
    return data.email || null
  } catch {
    return null
  }
}

/**
 * 标准化 Gemini 账号数据
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeAccount (raw) {
  if (!raw) return null

  const accessToken = raw.access_token || ''
  const refreshToken = raw.refresh_token || ''

  if (!accessToken && !refreshToken) return null

  return {
    id: raw.id || fileUtils.generateId(),
    email: raw.email || extractEmailFromToken(raw.id_token) || 'unknown@gemini',
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: raw.id_token || '',
    token_type: raw.token_type || 'Bearer',
    scope: raw.scope || '',
    expiry_date: raw.expiry_date || null,
    tier_id: raw.tier_id || '',
    plan_name: raw.plan_name || '',
    subscription_status: raw.subscription_status || '',
    quota: raw.quota || null,
    tags: raw.tags || [],
    created_at: raw.created_at || Date.now(),
    last_used: raw.last_used || 0
  }
}

module.exports = {
  list,
  getCurrent,
  importFromLocal,
  importFromJson,
  inject,
  deleteAccount,
  deleteAccounts,
  refreshToken,
  exportAccounts,
  updateTags,
  getPlanBadge,
  getConfigDir
}
