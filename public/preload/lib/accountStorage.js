/**
 * accountStorage.js — 基于 uTools dbStorage 的账号存储层
 *
 * 存储键规范：
 *   aideck:{platform}:accounts   -> 账号列表 (Array)
 *   aideck:{platform}:current    -> 当前激活账号 ID (string)
 *
 * 支持的 platform：antigravity, codex, gemini
 */

/**
 * 获取某平台的全部账号
 * @param {string} platform
 * @returns {Array}
 */
function listAccounts (platform) {
  const key = 'aideck:' + platform + ':accounts'
  const data = window.utools.dbStorage.getItem(key)
  if (!data || !Array.isArray(data)) return []
  return data
}

/**
 * 保存某平台的全部账号（覆盖写入）
 * @param {string} platform
 * @param {Array} accounts
 */
function saveAccounts (platform, accounts) {
  const key = 'aideck:' + platform + ':accounts'
  window.utools.dbStorage.setItem(key, accounts)
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
 * 添加账号（如果 id 或 email 重复则更新）
 * @param {string} platform
 * @param {object} account
 * @returns {object} 保存后的账号
 */
function addAccount (platform, account) {
  const accounts = listAccounts(platform)
  const existingIndex = accounts.findIndex(function (a) {
    return a.id === account.id || a.email === account.email
  })
  if (existingIndex >= 0) {
    // 合并更新：保留原有字段，用新字段覆盖
    accounts[existingIndex] = Object.assign({}, accounts[existingIndex], account, {
      last_used: accounts[existingIndex].last_used
    })
  } else {
    accounts.push(account)
  }
  saveAccounts(platform, accounts)
  return existingIndex >= 0 ? accounts[existingIndex] : account
}

/**
 * 批量添加账号
 * @param {string} platform
 * @param {Array} newAccounts
 * @returns {number} 成功添加的数量
 */
function addAccounts (platform, newAccounts) {
  let count = 0
  for (let i = 0; i < newAccounts.length; i++) {
    addAccount(platform, newAccounts[i])
    count++
  }
  return count
}

/**
 * 更新账号
 * @param {string} platform
 * @param {string} accountId
 * @param {object} updates 要更新的字段
 * @returns {object|null} 更新后的账号
 */
function updateAccount (platform, accountId, updates) {
  const accounts = listAccounts(platform)
  const index = accounts.findIndex(function (a) { return a.id === accountId })
  if (index < 0) return null
  accounts[index] = Object.assign({}, accounts[index], updates)
  saveAccounts(platform, accounts)
  return accounts[index]
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
  saveAccounts(platform, filtered)
  // 如果删除的是当前账号，清除 current
  const currentId = getCurrentId(platform)
  if (currentId === accountId) {
    clearCurrentId(platform)
  }
  return true
}

/**
 * 批量删除账号
 * @param {string} platform
 * @param {string[]} accountIds
 * @returns {number} 删除的数量
 */
function deleteAccounts (platform, accountIds) {
  const accounts = listAccounts(platform)
  const idSet = new Set(accountIds)
  const filtered = accounts.filter(function (a) { return !idSet.has(a.id) })
  const deletedCount = accounts.length - filtered.length
  if (deletedCount > 0) {
    saveAccounts(platform, filtered)
    // 检查当前账号是否被删除
    const currentId = getCurrentId(platform)
    if (currentId && idSet.has(currentId)) {
      clearCurrentId(platform)
    }
  }
  return deletedCount
}

/**
 * 获取当前激活账号 ID
 * @param {string} platform
 * @returns {string|null}
 */
function getCurrentId (platform) {
  const key = 'aideck:' + platform + ':current'
  return window.utools.dbStorage.getItem(key) || null
}

/**
 * 设置当前激活账号 ID
 * @param {string} platform
 * @param {string} accountId
 */
function setCurrentId (platform, accountId) {
  const key = 'aideck:' + platform + ':current'
  window.utools.dbStorage.setItem(key, accountId)
}

/**
 * 清除当前激活账号
 * @param {string} platform
 */
function clearCurrentId (platform) {
  const key = 'aideck:' + platform + ':current'
  window.utools.dbStorage.removeItem(key)
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
  const idSet = new Set(accountIds)
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

module.exports = {
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
  getAccountCount
}
