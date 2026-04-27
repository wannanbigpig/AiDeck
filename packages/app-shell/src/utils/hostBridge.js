function getWindowObject () {
  if (typeof window === 'undefined') return null
  return window
}

export function getHostBridge () {
  const win = getWindowObject()
  if (!win) return null
  return win.hostBridge || null
}

export function getHostApi () {
  const bridge = getHostBridge()
  if (bridge && bridge.host) return bridge.host
  return null
}

export function getPluginApi () {
  const bridge = getHostBridge()
  if (bridge && bridge.plugin) return bridge.plugin
  return null
}

export function getPlatformService (platform) {
  const bridge = getHostBridge()
  if (bridge && bridge.platforms && bridge.platforms[platform]) {
    return bridge.platforms[platform]
  }
  return null
}

export function getLogService () {
  const bridge = getHostBridge()
  if (bridge && bridge.logs) return bridge.logs
  return null
}

export function getPlatformInfo () {
  const bridge = getHostBridge()
  if (bridge && bridge.platform) return bridge.platform
  return {}
}

function normalizeSubscribeArgs (optionsOrListener, maybeListener) {
  if (typeof optionsOrListener === 'function') {
    return {
      options: {},
      listener: optionsOrListener
    }
  }
  return {
    options: optionsOrListener && typeof optionsOrListener === 'object' ? optionsOrListener : {},
    listener: typeof maybeListener === 'function' ? maybeListener : null
  }
}

function matchPlatformFilter (expected, actual) {
  const exp = String(expected || '').trim().toLowerCase()
  const cur = String(actual || '').trim().toLowerCase()
  if (!exp) return true
  if (!cur) return true
  return cur === exp || cur === 'all'
}

export async function copyText (text) {
  const content = String(text || '').trim()
  if (!content) return false
  const host = getHostApi()
  if (host && typeof host.copyText === 'function') {
    try {
      return (await Promise.resolve(host.copyText(content))) === true
    } catch (e) {}
  }
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(content)
      return true
    }
  } catch (e) {}
  return false
}

export async function showOpenDialog (options = {}) {
  const host = getHostApi()
  if (host && typeof host.showOpenDialog === 'function') {
    try {
      const result = await Promise.resolve(host.showOpenDialog(options))
      return Array.isArray(result) ? result : []
    } catch (e) {
      return []
    }
  }
  return []
}

export async function showSaveDialog (options = {}) {
  const host = getHostApi()
  if (host && typeof host.showSaveDialog === 'function') {
    try {
      return String(await Promise.resolve(host.showSaveDialog(options)) || '')
    } catch (e) {
      return ''
    }
  }
  return ''
}

export function readLocalFile (filePath) {
  const host = getHostApi()
  if (host && typeof host.readFile === 'function') {
    return host.readFile(filePath)
  }
  throw new Error('当前环境不支持读取文件')
}

export async function writeTextFile (payload, options) {
  const host = getHostApi()
  if (host && typeof host.writeTextFile === 'function') {
    return await Promise.resolve(host.writeTextFile(payload, options))
  }
  throw new Error('当前环境不支持写入文本文件')
}

export async function writeImageFile (payload, options) {
  const host = getHostApi()
  if (host && typeof host.writeImageFile === 'function') {
    return await Promise.resolve(host.writeImageFile(payload, options))
  }
  throw new Error('当前环境不支持写入图片文件')
}

export async function showNotification (message, title = 'AiDeck') {
  const host = getHostApi()
  if (host && typeof host.showNotification === 'function') {
    try {
      if (message && typeof message === 'object') {
        return (await Promise.resolve(host.showNotification(message))) === true
      }
      return (await Promise.resolve(host.showNotification(message, title))) === true
    } catch (e) {}
  }
  return false
}

export async function showItemInFolder (targetPath) {
  const filePath = String(targetPath || '').trim()
  if (!filePath) return false
  const host = getHostApi()
  if (host && typeof host.showItemInFolder === 'function') {
    try {
      return (await Promise.resolve(host.showItemInFolder(filePath))) === true
    } catch (e) {}
  }
  return false
}

export async function getAvailableTerminals () {
  const host = getHostApi()
  if (host && typeof host.getAvailableTerminals === 'function') {
    try {
      const result = await Promise.resolve(host.getAvailableTerminals())
      return Array.isArray(result) ? result : []
    } catch (e) {}
  }
  return [{ value: 'system', label: '系统默认' }]
}

export function getCommandStatus (commandName) {
  const command = String(commandName || '').trim()
  const host = getHostApi()
  if (host && typeof host.getCommandStatus === 'function') {
    try {
      const result = host.getCommandStatus(command)
      return result && typeof result === 'object'
        ? result
        : { command, available: false, installCommand: '' }
    } catch (e) {}
  }
  return { command, available: false, installCommand: '' }
}

export async function launchCliCommand (payload) {
  const host = getHostApi()
  if (host && typeof host.launchCliCommand === 'function') {
    try {
      return await Promise.resolve(host.launchCliCommand(payload || {}))
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }
  return { success: false, error: '当前环境不支持打开终端' }
}

export function bindPluginSubInput (listener, placeholder = '') {
  const plugin = getPluginApi()
  if (plugin && typeof plugin.setSubInput === 'function') {
    return plugin.setSubInput(listener, placeholder) === true
  }
  return false
}

export function subscribePluginEnter (listener) {
  const plugin = getPluginApi()
  if (plugin && typeof plugin.onEnter === 'function') {
    return plugin.onEnter(listener)
  }
  return function unsubscribe () {}
}

export async function exitPlugin () {
  const plugin = getPluginApi()
  if (plugin && typeof plugin.out === 'function') {
    try {
      return (await Promise.resolve(plugin.out())) === true
    } catch (e) {}
  }
  return false
}

export function subscribeLocalState (optionsOrListener, maybeListener) {
  const bridge = getHostBridge()
  const { options, listener } = normalizeSubscribeArgs(optionsOrListener, maybeListener)
  if (typeof listener !== 'function') {
    return function unsubscribe () {}
  }
  if (bridge && bridge.events && typeof bridge.events.subscribeLocalState === 'function') {
    return bridge.events.subscribeLocalState((detail) => {
      if (!matchPlatformFilter(options.platform, detail?.platform)) return
      listener(detail)
    })
  }
  return function unsubscribe () {}
}

export function subscribeStorageRevision (optionsOrListener, maybeListener) {
  const bridge = getHostBridge()
  const { options, listener } = normalizeSubscribeArgs(optionsOrListener, maybeListener)
  if (typeof listener !== 'function') {
    return function unsubscribe () {}
  }
  if (bridge && bridge.events && typeof bridge.events.subscribeStorageRevision === 'function') {
    return bridge.events.subscribeStorageRevision((detail) => {
      if (!matchPlatformFilter(options.platform, detail?.detail?.platform)) return
      listener(detail)
    })
  }
  return function unsubscribe () {}
}

export function subscribeRequestLogs (listener) {
  const bridge = getHostBridge()
  if (bridge && bridge.events && typeof bridge.events.subscribeLogs === 'function') {
    return bridge.events.subscribeLogs(listener)
  }
  return function unsubscribe () {}
}

export function subscribeHostNavigation (listener) {
  const bridge = getHostBridge()
  if (typeof listener !== 'function') {
    return function unsubscribe () {}
  }
  if (bridge && bridge.events && typeof bridge.events.subscribeHostNavigation === 'function') {
    return bridge.events.subscribeHostNavigation(listener)
  }
  return function unsubscribe () {}
}

export function readSharedSetting (key, fallback = null) {
  const bridge = getHostBridge()
  if (bridge && bridge.settings && typeof bridge.settings.getShared === 'function') {
    return bridge.settings.getShared(key, fallback)
  }
  return fallback
}

export function writeSharedSetting (key, value) {
  const bridge = getHostBridge()
  if (bridge && bridge.settings && typeof bridge.settings.setShared === 'function') {
    return bridge.settings.setShared(key, value)
  }
  return value
}

export function readHostSetting (key, fallback = null) {
  const bridge = getHostBridge()
  if (bridge && bridge.settings && typeof bridge.settings.getHost === 'function') {
    return bridge.settings.getHost(key, fallback)
  }
  return fallback
}

export function writeHostSetting (key, value) {
  const bridge = getHostBridge()
  if (bridge && bridge.settings && typeof bridge.settings.setHost === 'function') {
    return bridge.settings.setHost(key, value)
  }
  return value
}

export async function getAnnouncementState (options = {}) {
  const host = getHostApi()
  if (host && typeof host.getAnnouncementState === 'function') {
    try {
      const result = await Promise.resolve(host.getAnnouncementState(options))
      return result && typeof result === 'object'
        ? result
        : { announcements: [], unreadIds: [], popupAnnouncement: null }
    } catch (e) {}
  }
  return { announcements: [], unreadIds: [], popupAnnouncement: null }
}

export async function forceRefreshAnnouncements (options = {}) {
  const host = getHostApi()
  if (host && typeof host.forceRefreshAnnouncements === 'function') {
    try {
      const result = await Promise.resolve(host.forceRefreshAnnouncements(options))
      return result && typeof result === 'object'
        ? result
        : { announcements: [], unreadIds: [], popupAnnouncement: null }
    } catch (e) {}
  }
  return { announcements: [], unreadIds: [], popupAnnouncement: null }
}

export async function markAnnouncementAsRead (id) {
  const host = getHostApi()
  if (host && typeof host.markAnnouncementAsRead === 'function') {
    try {
      await Promise.resolve(host.markAnnouncementAsRead(id))
      return true
    } catch (e) {}
  }
  return false
}

export async function markAllAnnouncementsAsRead (options = {}) {
  const host = getHostApi()
  if (host && typeof host.markAllAnnouncementsAsRead === 'function') {
    try {
      await Promise.resolve(host.markAllAnnouncementsAsRead(options))
      return true
    } catch (e) {}
  }
  return false
}

export async function writeConfigFile (filePath, content) {
  const host = getHostApi()
  if (host && typeof host.writeConfigFile === 'function') {
    return await Promise.resolve(host.writeConfigFile(filePath, content))
  }
  throw new Error('当前环境不支持直接写入配置文件')
}

export function readConfigFile (filePath) {
  const host = getHostApi()
  if (host && typeof host.readConfigFile === 'function') {
    return host.readConfigFile(filePath)
  }
  throw new Error('当前环境不支持读取配置文件')
}

export function fileExists (filePath) {
  const host = getHostApi()
  if (host && typeof host.fileExists === 'function') {
    return host.fileExists(filePath)
  }
  throw new Error('当前环境不支持文件检查')
}

export function dirExists (dirPath) {
  const host = getHostApi()
  if (host && typeof host.dirExists === 'function') {
    return host.dirExists(dirPath)
  }
  throw new Error('当前环境不支持目录检查')
}
