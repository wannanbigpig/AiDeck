/**
 * services.js — uTools preload 入口文件
 *
 * 将所有后端服务挂载到 window.services 对象上，
 * 供前端 React 组件直接调用。
 */

const antigravityService = require('./lib/antigravityService')
const codexService = require('./lib/codexService')
const geminiService = require('./lib/geminiService')
const accountStorage = require('./lib/accountStorage')
const fileUtils = require('./lib/fileUtils')
const requestLogStore = require('./lib/requestLogStore')
const fs = require('node:fs')
const path = require('node:path')

try {
  accountStorage.initStorage()
} catch (err) {
  console.error('[services] initStorage failed:', err && err.message ? err.message : String(err))
}

const LOCAL_STATE_EVENT = 'aideck:local-state-change'
const WATCH_DEBOUNCE_MS = 180
const watchHandles = []
const emitTimerMap = new Map()

function emitLocalStateChange (platform, reason) {
  const key = String(platform || 'all')
  if (emitTimerMap.has(key)) {
    clearTimeout(emitTimerMap.get(key))
  }
  const timer = setTimeout(() => {
    emitTimerMap.delete(key)
    if (typeof window !== 'undefined' && window && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(LOCAL_STATE_EVENT, {
        detail: {
          platform: key,
          reason: String(reason || ''),
          ts: Date.now()
        }
      }))
    }
  }, WATCH_DEBOUNCE_MS)
  emitTimerMap.set(key, timer)
}

function trackWatchHandle (handle) {
  if (handle && typeof handle.close === 'function') {
    watchHandles.push(handle)
    return true
  }
  return false
}

function safeWatch (targetPath, options, onChange) {
  try {
    const handle = fs.watch(targetPath, options, onChange)
    return trackWatchHandle(handle)
  } catch (e) {
    return false
  }
}

function createFilenameFilter (names) {
  const set = new Set((Array.isArray(names) ? names : []).map(item => String(item || '').trim().toLowerCase()).filter(Boolean))
  return function matchFilename (filename) {
    const val = String(filename || '').trim().toLowerCase()
    if (!val) return true
    return set.has(val)
  }
}

function normalizePathList (values) {
  const input = Array.isArray(values) ? values : [values]
  const out = []
  for (let i = 0; i < input.length; i++) {
    const val = String(input[i] || '').trim()
    if (!val || out.includes(val)) continue
    out.push(val)
  }
  return out
}

function setupPlatformWatcher (platform, config) {
  const dirPaths = normalizePathList(config && (config.dirPaths || config.dirPath))
  const homeFallbackPaths = normalizePathList(config && (config.fallbackPaths || config.homeFallbackPath))
  const fileNames = Array.isArray(config && config.fileNames) ? config.fileNames : []
  const shouldWatchWholeDir = !!(config && config.watchWholeDir)
  const filenameMatch = createFilenameFilter(fileNames)
  const dirBasenames = dirPaths.map(item => path.basename(item).toLowerCase()).filter(Boolean)

  const onDirChange = (_eventType, filename) => {
    if (!shouldWatchWholeDir && !filenameMatch(filename)) return
    emitLocalStateChange(platform, String(filename || 'dir'))
  }
  const onFileChange = (_eventType, filename) => {
    if (!filenameMatch(filename)) return
    emitLocalStateChange(platform, String(filename || 'file'))
  }
  const onHomeFallbackChange = (_eventType, filename) => {
    const val = String(filename || '').trim().toLowerCase()
    if (!val) return
    for (let i = 0; i < dirBasenames.length; i++) {
      const targetDir = dirBasenames[i]
      if (!targetDir) continue
      if (val === targetDir || val.endsWith(path.sep + targetDir)) {
        emitLocalStateChange(platform, `dir:${targetDir}`)
        return
      }
    }
    for (let i = 0; i < fileNames.length; i++) {
      const name = String(fileNames[i] || '').trim().toLowerCase()
      if (name && val === name) {
        emitLocalStateChange(platform, `file:${val}`)
        return
      }
    }
  }

  let watchedAnyDir = false
  for (let i = 0; i < dirPaths.length; i++) {
    const watched = safeWatch(dirPaths[i], { persistent: false }, onDirChange)
    watchedAnyDir = watchedAnyDir || watched
  }
  if (!watchedAnyDir) {
    for (let i = 0; i < homeFallbackPaths.length; i++) {
      safeWatch(homeFallbackPaths[i], { persistent: false }, onHomeFallbackChange)
    }
  }

  for (let i = 0; i < dirPaths.length; i++) {
    const dirPath = dirPaths[i]
    for (let j = 0; j < fileNames.length; j++) {
      const fileName = String(fileNames[j] || '').trim()
      if (!fileName || !dirPath) continue
      const filePath = path.join(dirPath, fileName)
      safeWatch(filePath, { persistent: false }, onFileChange)
    }
  }
}

function setupLocalStateWatchers () {
  const codexWatchTargets = typeof codexService.getLocalStateWatchTargets === 'function'
    ? codexService.getLocalStateWatchTargets()
    : { dirPaths: [codexService.getConfigDir()], fileNames: ['auth.json'], fallbackPaths: [fileUtils.getHomeDir()] }
  const geminiWatchTargets = typeof geminiService.getLocalStateWatchTargets === 'function'
    ? geminiService.getLocalStateWatchTargets()
    : { dirPaths: [geminiService.getConfigDir()], fileNames: ['oauth_creds.json', 'google_accounts.json'], fallbackPaths: [fileUtils.getHomeDir()] }
  const antigravityWatchTargets = typeof antigravityService.getLocalStateWatchTargets === 'function'
    ? antigravityService.getLocalStateWatchTargets()
    : {
        dirPaths: [path.dirname(antigravityService.getLocalStatePaths().stateDbPath)],
        fileNames: ['state.vscdb'],
        watchWholeDir: true,
        fallbackPaths: [path.dirname(path.dirname(antigravityService.getLocalStatePaths().stateDbPath))]
      }

  setupPlatformWatcher('codex', codexWatchTargets)
  setupPlatformWatcher('gemini', geminiWatchTargets)
  setupPlatformWatcher('antigravity', antigravityWatchTargets)
}

setupLocalStateWatchers()

if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    for (let i = 0; i < watchHandles.length; i++) {
      const handle = watchHandles[i]
      try {
        handle.close()
      } catch (e) {}
    }
    watchHandles.length = 0
    for (const timer of emitTimerMap.values()) {
      clearTimeout(timer)
    }
    emitTimerMap.clear()
  })
}

window.services = {
  // ===== Antigravity =====
  antigravity: {
    list: function () { return antigravityService.list() },
    getCurrent: function () { return antigravityService.getCurrent() },
    getLocalImportStatus: function () { return antigravityService.getLocalImportStatus() },
    syncCurrentFromLocal: function (options) { return antigravityService.syncCurrentFromLocal(options) },
    importFromLocal: function () { return antigravityService.importFromLocal() },
    importFromJson: function (json) { return antigravityService.importFromJson(json) },
    addWithToken: function (token) { return antigravityService.addWithToken(token) },
    prepareOAuthSession: function (port) { return antigravityService.prepareOAuthSession(port) },
    getOAuthSessionStatus: function (sessionId) { return antigravityService.getOAuthSessionStatus(sessionId) },
    completeOAuthSession: function (sessionId, callbackUrl) { return antigravityService.completeOAuthSession(sessionId, callbackUrl) },
    cancelOAuthSession: function (sessionId) { return antigravityService.cancelOAuthSession(sessionId) },
    getPendingOAuthSession: function (sessionId) { return antigravityService.getPendingOAuthSession(sessionId) },
    savePendingOAuthSession: function (payload) { return antigravityService.savePendingOAuthSession(payload) },
    clearPendingOAuthSession: function (sessionId) { return antigravityService.clearPendingOAuthSession(sessionId) },
    openExternalUrl: function (url) { return antigravityService.openExternalUrl(url) },
    detectAntigravityAppPath: function (customPath) { return antigravityService.detectAntigravityAppPath(customPath) },
    getDefaultAntigravityAppPath: function () { return antigravityService.getDefaultAntigravityAppPath() },
    getCurrentDeviceIdentity: function () { return antigravityService.getCurrentDeviceIdentity() },
    restoreOriginalDeviceIdentity: function () { return antigravityService.restoreOriginalDeviceIdentity() },
    switchAccount: function (id, options) { return antigravityService.switchAccount(id, options) },
    deleteAccount: function (id) { return antigravityService.deleteAccount(id) },
    deleteAccounts: function (ids) { return antigravityService.deleteAccounts(ids) },
    refreshQuota: function (id) { return antigravityService.refreshQuota(id) },
    exportAccounts: function (ids) { return antigravityService.exportAccounts(ids) },
    updateTags: function (id, tags) { return antigravityService.updateTags(id, tags) },
    getConfigDir: function () { return antigravityService.getConfigDir() }
  },

  // ===== Codex =====
  codex: {
    list: function () { return codexService.list() },
    getCurrent: function () { return codexService.getCurrent() },
    getLocalImportStatus: function () { return codexService.getLocalImportStatus() },
    syncCurrentFromLocal: function (options) { return codexService.syncCurrentFromLocal(options) },
    importFromLocal: function () { return codexService.importFromLocal() },
    importFromJson: function (json) { return codexService.importFromJson(json) },
    addWithToken: function (idToken, accessToken, refreshToken) {
      return codexService.addWithToken(idToken, accessToken, refreshToken)
    },
    prepareOAuthSession: function (port) { return codexService.prepareOAuthSession(port) },
    getOAuthSessionStatus: function (sessionId) { return codexService.getOAuthSessionStatus(sessionId) },
    completeOAuthSession: function (sessionId, callbackUrl) { return codexService.completeOAuthSession(sessionId, callbackUrl) },
    cancelOAuthSession: function (sessionId) { return codexService.cancelOAuthSession(sessionId) },
    getPendingOAuthSession: function (sessionId) { return codexService.getPendingOAuthSession(sessionId) },
    savePendingOAuthSession: function (payload) { return codexService.savePendingOAuthSession(payload) },
    clearPendingOAuthSession: function (sessionId) { return codexService.clearPendingOAuthSession(sessionId) },
    openExternalUrl: function (url) { return codexService.openExternalUrl(url) },
    switchAccount: function (id, options) { return codexService.switchAccount(id, options) },
    deleteAccount: function (id) { return codexService.deleteAccount(id) },
    deleteAccounts: function (ids) { return codexService.deleteAccounts(ids) },
    refreshQuota: function (id) { return codexService.refreshQuota(id) },
    exportAccounts: function (ids) { return codexService.exportAccounts(ids) },
    updateTags: function (id, tags) { return codexService.updateTags(id, tags) },
    getPlanDisplayName: function (plan) { return codexService.getPlanDisplayName(plan) },
    getConfigDir: function () { return codexService.getConfigDir() },
    detectCodexAppPath: function (customPath) { return codexService.detectCodexAppPath(customPath) },
    detectOpenCodeAppPath: function (customPath) { return codexService.detectOpenCodeAppPath(customPath) },
    getDefaultCodexAppPath: function () { return codexService.getDefaultCodexAppPath() },
    getDefaultOpenCodeAppPath: function () { return codexService.getDefaultOpenCodeAppPath() }
  },

  // ===== Gemini CLI =====
  gemini: {
    list: function () { return geminiService.list() },
    getCurrent: function () { return geminiService.getCurrent() },
    getLocalImportStatus: function () { return geminiService.getLocalImportStatus() },
    syncCurrentFromLocal: function (options) { return geminiService.syncCurrentFromLocal(options) },
    importFromLocal: function () { return geminiService.importFromLocal() },
    importFromJson: function (json) { return geminiService.importFromJson(json) },
    addWithToken: function (idToken, accessToken, refreshToken) {
      return geminiService.addWithToken(idToken, accessToken, refreshToken)
    },
    prepareOAuthSession: function (port) { return geminiService.prepareOAuthSession(port) },
    completeOAuthSession: function (sessionId, callbackUrl) { return geminiService.completeOAuthSession(sessionId, callbackUrl) },
    cancelOAuthSession: function (sessionId) { return geminiService.cancelOAuthSession(sessionId) },
    getPendingOAuthSession: function (sessionId) { return geminiService.getPendingOAuthSession(sessionId) },
    savePendingOAuthSession: function (payload) { return geminiService.savePendingOAuthSession(payload) },
    clearPendingOAuthSession: function (sessionId) { return geminiService.clearPendingOAuthSession(sessionId) },
    openExternalUrl: function (url) { return geminiService.openExternalUrl(url) },
    inject: function (id) { return geminiService.inject(id) },
    deleteAccount: function (id) { return geminiService.deleteAccount(id) },
    deleteAccounts: function (ids) { return geminiService.deleteAccounts(ids) },
    refreshToken: function (id) { return geminiService.refreshToken(id) },
    exportAccounts: function (ids) { return geminiService.exportAccounts(ids) },
    updateTags: function (id, tags) { return geminiService.updateTags(id, tags) },
    getPlanBadge: function (account) { return geminiService.getPlanBadge(account) },
    getConfigDir: function () { return geminiService.getConfigDir() }
  },

  // ===== 通用工具 =====
  storage: {
    initStorage: function () { return accountStorage.initStorage() },
    getDataRootDir: function () { return accountStorage.getDataRootDir() },
    getAccountCount: function (platform) { return accountStorage.getAccountCount(platform) },
    repairIndex: function (platform) { return accountStorage.repairIndex(platform) },
    buildEncryptedSyncPayload: function (passphrase) { return accountStorage.buildEncryptedSyncPayload(passphrase) },
    applyEncryptedSyncPayload: function (payload, passphrase) {
      return accountStorage.applyEncryptedSyncPayload(payload, passphrase)
    }
  },
  platform: {
    getHomeDir: function () { return fileUtils.getHomeDir() },
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux',
    osType: process.platform
  },
  logs: {
    list: function (limit) { return requestLogStore.listLogs(limit) },
    clear: function () { return requestLogStore.clearLogs() },
    isEnabled: function () { return requestLogStore.isEnabled() },
    setEnabled: function (enabled) { return requestLogStore.setEnabled(enabled) },
    log: function (payload) { return requestLogStore.addLog(payload || {}) },
    getLogDirPath: function () { return requestLogStore.getLogDir() },
    getLogFilePath: function () { return requestLogStore.getLogFilePath() },
    openLogDir: function () { return requestLogStore.openLogDir() }
  }
}
