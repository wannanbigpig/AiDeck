import fs from 'fs'
import path from 'path'
import os from 'os'
import { contextBridge, clipboard, shell, ipcRenderer } from 'electron'
import { createHostBridge } from '../../../../packages/core/src/index.cjs'

console.log('[AiDeck Preload] Home directory:', os.homedir())
console.log('[AiDeck Preload] Data directory:', path.join(os.homedir(), '.ai_deck'))
console.log('[AiDeck Preload] Data exists:', fs.existsSync(path.join(os.homedir(), '.ai_deck')))

import antigravityService from '../../../../packages/platforms/src/antigravityService.cjs'
import codexService from '../../../../packages/platforms/src/codexService.cjs'
import geminiService from '../../../../packages/platforms/src/geminiService.cjs'
import accountStorage from '../../../../packages/infra-node/src/accountStorage.cjs'
import fileUtils from '../../../../packages/infra-node/src/fileUtils.cjs'
import requestLogStore from '../../../../packages/infra-node/src/requestLogStore.cjs'
import sharedSettingsStore from '../../../../packages/infra-node/src/sharedSettingsStore.cjs'
import hostSettingsStore from '../../../../packages/infra-node/src/hostSettingsStore.cjs'
import revisionBus from '../../../../packages/infra-node/src/storageRevisionBus.cjs'

const WATCH_DEBOUNCE_MS = 180
const watchHandles = []
const emitTimerMap = new Map()
const localStateListeners = new Set()
const hostNavigationListeners = new Set()

function emitLocalStateChange (platform, reason, extra = {}) {
  const key = String(platform || 'all')
  if (emitTimerMap.has(key)) {
    clearTimeout(emitTimerMap.get(key))
  }
  const timer = setTimeout(() => {
    emitTimerMap.delete(key)
    const normalizedReason = String(reason || '')
    for (const listener of localStateListeners) {
      try {
        listener({
          platform: key,
          reason: normalizedReason,
          scope: String(extra.scope || 'local-state'),
          kind: String(extra.kind || (normalizedReason.startsWith('dir') ? 'dir' : normalizedReason.startsWith('file') ? 'file' : 'local-state')),
          accountId: extra.accountId ? String(extra.accountId) : undefined,
          ts: Date.now()
        })
      } catch (err) {}
    }
  }, WATCH_DEBOUNCE_MS)
  emitTimerMap.set(key, timer)
}

function subscribeLocalState (listener) {
  if (typeof listener !== 'function') {
    return function unsubscribe () {}
  }
  localStateListeners.add(listener)
  return function unsubscribe () {
    localStateListeners.add(listener)
  }
}

function subscribeHostNavigation (listener) {
  if (typeof listener !== 'function') {
    return function unsubscribe () {}
  }
  hostNavigationListeners.add(listener)
  return function unsubscribe () {
    hostNavigationListeners.delete(listener)
  }
}

ipcRenderer.on('host:navigate-platform', (_event, detail) => {
  for (const listener of hostNavigationListeners) {
    try {
      listener(detail)
    } catch (err) {}
  }
})

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
    emitLocalStateChange(platform, String(filename || 'dir'), { kind: 'dir' })
  }
  const onFileChange = (_eventType, filename) => {
    if (!filenameMatch(filename)) return
    emitLocalStateChange(platform, String(filename || 'file'), { kind: 'file' })
  }
  const onHomeFallbackChange = (_eventType, filename) => {
    const val = String(filename || '').trim().toLowerCase()
    if (!val) return
    for (let i = 0; i < dirBasenames.length; i++) {
      const targetDir = dirBasenames[i]
      if (!targetDir) continue
      if (val === targetDir || val.endsWith(path.sep + targetDir)) {
        emitLocalStateChange(platform, `dir:${targetDir}`, { kind: 'dir' })
        return
      }
    }
    for (let i = 0; i < fileNames.length; i++) {
      const name = String(fileNames[i] || '').trim().toLowerCase()
      if (name && val === name) {
        emitLocalStateChange(platform, `file:${val}`, { kind: 'file' })
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
      safeWatch(path.join(dirPath, fileName), { persistent: false }, onFileChange)
    }
  }
}

function setupLocalStateWatchers () {
  setupPlatformWatcher('codex', codexService.getLocalStateWatchTargets())
  setupPlatformWatcher('gemini', geminiService.getLocalStateWatchTargets())
  setupPlatformWatcher('antigravity', antigravityService.getLocalStateWatchTargets())
}

accountStorage.initStorage()
setupLocalStateWatchers()

const services = {
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
  codex: {
    list: function () { return codexService.list() },
    getCurrent: function () { return codexService.getCurrent() },
    getLocalImportStatus: function () { return codexService.getLocalImportStatus() },
    syncCurrentFromLocal: function (options) { return codexService.syncCurrentFromLocal(options) },
    importFromLocal: function () { return codexService.importFromLocal() },
    importFromJson: function (json) { return codexService.importFromJson(json) },
    addWithToken: function (idToken, accessToken, refreshToken) { return codexService.addWithToken(idToken, accessToken, refreshToken) },
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
  gemini: {
    list: function () { return geminiService.list() },
    getCurrent: function () { return geminiService.getCurrent() },
    getLocalImportStatus: function () { return geminiService.getLocalImportStatus() },
    syncCurrentFromLocal: function (options) { return geminiService.syncCurrentFromLocal(options) },
    importFromLocal: function () { return geminiService.importFromLocal() },
    importFromJson: function (json) { return geminiService.importFromJson(json) },
    addWithToken: function (idToken, accessToken, refreshToken) { return geminiService.addWithToken(idToken, accessToken, refreshToken) },
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
  }
}

const storage = {
  initStorage: function () { return accountStorage.initStorage() },
  getDataRootDir: function () { return accountStorage.getDataRootDir() },
  getAccountCount: function (platform) { return accountStorage.getAccountCount(platform) },
  repairIndex: function (platform) { return accountStorage.repairIndex(platform) },
  buildEncryptedSyncPayload: function (passphrase) { return accountStorage.buildEncryptedSyncPayload(passphrase) },
  applyEncryptedSyncPayload: function (payload, passphrase) { return accountStorage.applyEncryptedSyncPayload(payload, passphrase) }
}

const platform = {
  getHomeDir: function () { return fileUtils.getHomeDir() },
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  osType: process.platform
}

const logs = {
  list: function (limit) { return requestLogStore.listLogs(limit) },
  clear: function () { return requestLogStore.clearLogs() },
  isEnabled: function () { return requestLogStore.isEnabled() },
  setEnabled: function (enabled) { return requestLogStore.setEnabled(enabled) },
  log: function (payload) { return requestLogStore.addLog(payload || {}) },
  subscribe: function (listener) { return requestLogStore.subscribe(listener) },
  getLogDirPath: function () { return requestLogStore.getLogDir() },
  getLogFilePath: function () { return requestLogStore.getLogFilePath() },
  openLogDir: function () { return requestLogStore.openLogDir() }
}

function normalizeSaveDialogResult (result) {
  const value = String(result || '').trim()
  return value || ''
}

async function showSaveDialog (options) {
  try {
    return normalizeSaveDialogResult(await ipcRenderer.invoke('host:show-save-dialog', options || {}))
  } catch (err) {
    return ''
  }
}

function getDefaultDesktopPath (fileName) {
  const homeDir = fileUtils.getHomeDir()
  return path.join(homeDir, 'Desktop', fileName)
}

function resolveTextWritePayload (payload, options) {
  if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
    const fileName = String(payload.fileName || payload.filename || options?.fileName || 'aideck-output.txt').trim() || 'aideck-output.txt'
    const defaultPath = String(payload.defaultPath || payload.path || options?.defaultPath || getDefaultDesktopPath(fileName)).trim()
    let content = payload.content
    if (typeof content !== 'string') content = payload.text
    if (typeof content !== 'string') content = payload.data
    if (typeof content !== 'string') content = JSON.stringify(payload, null, 2)
    return {
      content: String(content || ''),
      defaultPath,
      title: String(payload.title || options?.title || '保存文本文件')
    }
  }

  return {
    content: String(payload || ''),
    defaultPath: String(options?.defaultPath || getDefaultDesktopPath(options?.fileName || 'aideck-output.txt')),
    title: String(options?.title || '保存文本文件')
  }
}

function resolveImageWritePayload (payload, options) {
  let buffer = null
  let extension = '.png'

  if (Buffer.isBuffer(payload)) {
    buffer = payload
  } else if (typeof payload === 'string') {
    const trimmed = payload.trim()
    const dataUrlMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
    if (dataUrlMatch) {
      const mime = dataUrlMatch[1]
      const base64 = dataUrlMatch[2]
      const extMap = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif'
      }
      extension = extMap[mime] || extension
      buffer = Buffer.from(base64, 'base64')
    } else if (fs.existsSync(trimmed)) {
      buffer = fs.readFileSync(trimmed)
      extension = path.extname(trimmed) || extension
    }
  } else if (payload && typeof payload === 'object') {
    if (Buffer.isBuffer(payload.buffer)) {
      buffer = payload.buffer
    } else if (typeof payload.base64 === 'string' && payload.base64.trim()) {
      buffer = Buffer.from(payload.base64.trim(), 'base64')
    } else if (typeof payload.dataUrl === 'string' && payload.dataUrl.trim()) {
      return resolveImageWritePayload(payload.dataUrl, options)
    } else if (typeof payload.path === 'string' && payload.path.trim() && fs.existsSync(payload.path.trim())) {
      const srcPath = payload.path.trim()
      buffer = fs.readFileSync(srcPath)
      extension = path.extname(srcPath) || extension
    }

    if (typeof payload.extension === 'string' && payload.extension.trim()) {
      extension = payload.extension.startsWith('.') ? payload.extension : `.${payload.extension}`
    }
  }

  if (!buffer) {
    throw new Error('不支持的图片写入内容')
  }

  const fileName = String(options?.fileName || `aideck-image${extension}`).trim() || `aideck-image${extension}`
  return {
    buffer,
    defaultPath: String(options?.defaultPath || getDefaultDesktopPath(fileName)),
    title: String(options?.title || '保存图片文件')
  }
}

const host = {
  copyText: async function (text) {
    const content = String(text || '')
    if (!content) return false
    try {
      clipboard.writeText(content)
      return true
    } catch (err) {
      return false
    }
  },
  showOpenDialog: async function (options) {
    try {
      const result = await ipcRenderer.invoke('host:show-open-dialog', options || {})
      return Array.isArray(result) ? result : []
    } catch (err) {
      return []
    }
  },
  showSaveDialog: async function (options) {
    return await showSaveDialog(options || {})
  },
  readFile: function (filePath) {
    const content = fileUtils.readTextFile(filePath)
    if (content == null) {
      throw new Error('读取文件失败')
    }
    return content
  },
  writeTextFile: async function (payload, options) {
    const normalized = resolveTextWritePayload(payload, options)
    const targetPath = await showSaveDialog({
      title: normalized.title,
      defaultPath: normalized.defaultPath
    })
    if (!targetPath) return ''
    const ok = fileUtils.writeTextFile(targetPath, normalized.content)
    if (!ok) {
      throw new Error('写入文件失败')
    }
    return targetPath
  },
  writeImageFile: async function (payload, options) {
    const normalized = resolveImageWritePayload(payload, options)
    const targetPath = await showSaveDialog({
      title: normalized.title,
      defaultPath: normalized.defaultPath
    })
    if (!targetPath) return ''
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, normalized.buffer)
    return targetPath
  },
  showNotification: async function (message, title = 'AiDeck') {
    try {
      if (message && typeof message === 'object') {
        return await ipcRenderer.invoke('host:show-notification', message)
      }
      return await ipcRenderer.invoke('host:show-notification', { title, message })
    } catch (err) {
      return false
    }
  },
  showItemInFolder: function (targetPath) {
    const filePath = String(targetPath || '').trim()
    if (!filePath) return false
    try {
      shell.showItemInFolder(filePath)
      return true
    } catch (err) {
      return false
    }
  },
  writeConfigFile: function (filePath, content) {
    const resolvedPath = filePath.startsWith('~')
      ? path.join(fileUtils.getHomeDir(), filePath.slice(1))
      : filePath

    const dir = path.dirname(resolvedPath)
    if (!fileUtils.dirExists(dir)) {
      throw new Error(`配置目录不存在：${dir}`)
    }

    if (fileUtils.fileExists(resolvedPath)) {
      const existingContent = fileUtils.readTextFile(resolvedPath)
      const backupPath = resolvedPath + '.aideck.bak'
      fileUtils.writeTextFile(backupPath, existingContent)
    }

    const ok = fileUtils.writeTextFile(resolvedPath, content)
    if (!ok) {
      throw new Error('写入文件失败')
    }
    return resolvedPath
  },
  readConfigFile: function (filePath) {
    const resolvedPath = filePath.startsWith('~')
      ? path.join(fileUtils.getHomeDir(), filePath.slice(1))
      : filePath
    return fileUtils.readTextFile(resolvedPath)
  },
  fileExists: function (filePath) {
    const resolvedPath = filePath.startsWith('~')
      ? path.join(fileUtils.getHomeDir(), filePath.slice(1))
      : filePath
    return fileUtils.fileExists(resolvedPath)
  },
  dirExists: function (dirPath) {
    const resolvedPath = dirPath.startsWith('~')
      ? path.join(fileUtils.getHomeDir(), dirPath.slice(1))
      : dirPath
    return fileUtils.dirExists(resolvedPath)
  },
  deleteFile: function (filePath) {
    const resolvedPath = filePath.startsWith('~')
      ? path.join(fileUtils.getHomeDir(), filePath.slice(1))
      : filePath
    return fileUtils.deleteFile(resolvedPath)
  }
}

const plugin = {
  setSubInput: function () {
    return false
  },
  onEnter: function () {
    return function unsubscribe () {}
  },
  out: function () {
    return false
  }
}

const hostBridge = createHostBridge({
  hostId: 'desktop',
  services,
  host,
  plugin,
  storage,
  logs,
  platform,
  sharedSettingsStore,
  hostSettingsStore,
  subscribeLocalState,
  subscribeStorageRevision: revisionBus.subscribe,
  subscribeHostNavigation
})

contextBridge.exposeInMainWorld('hostBridge', hostBridge)
