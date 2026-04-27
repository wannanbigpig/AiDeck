const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const dataRoot = require('./dataRoot.cjs')
const fileUtils = require('./fileUtils.cjs')

const DEFAULT_ANNOUNCEMENT_URL = 'https://raw.githubusercontent.com/wannanbigpig/AiDeck/main/announcements.json'
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_FILE = 'announcement_cache.json'
const READ_IDS_FILE = 'announcement_read_ids.json'
const LOCAL_ANNOUNCEMENT_FILE = 'announcements.json'

function getAnnouncementDir () {
  const dir = path.join(dataRoot.getCacheDir(), 'announcements')
  fileUtils.ensureDir(dir)
  return dir
}

function getCachePath () {
  return path.join(getAnnouncementDir(), CACHE_FILE)
}

function getReadIdsPath () {
  return path.join(getAnnouncementDir(), READ_IDS_FILE)
}

function getAnnouncementUrl () {
  return String(process.env.AIDECK_ANNOUNCEMENT_URL || DEFAULT_ANNOUNCEMENT_URL).trim()
}

function normalizeAnnouncementUrl (url) {
  const target = String(url || '').trim()
  const match = target.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i)
  if (!match) return target
  const [, owner, repo, branch, filePath] = match
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`
}

function isDevelopmentRuntime (runtimeDirValue = __dirname) {
  const explicit = String(process.env.AIDECK_ANNOUNCEMENT_DEV_LOCAL || '').trim().toLowerCase()
  if (explicit === '1' || explicit === 'true') return true
  if (explicit === '0' || explicit === 'false') return false

  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase()
  if (nodeEnv === 'development') return true

  const lifecycle = String(process.env.npm_lifecycle_event || '').trim().toLowerCase()
  if (lifecycle === 'dev' || lifecycle.startsWith('dev:')) return true

  const runtimeDir = path.resolve(runtimeDirValue).split(path.sep).join('/')
  if (runtimeDir.endsWith('/packages/infra-node/src')) return true
  if (runtimeDir.endsWith('/apps/utools/public/preload')) return true
  if (runtimeDir.endsWith('/dist/preload')) return fs.existsSync(path.resolve(runtimeDirValue, '..', '..', 'announcements.json'))

  return Boolean(String(process.env.VITE_DEV_SERVER_URL || '').trim())
}

function findUpFile (startDir, fileName) {
  let current = path.resolve(startDir || process.cwd())
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(current, fileName)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return ''
}

function getLocalAnnouncementFile () {
  const explicit = String(process.env.AIDECK_ANNOUNCEMENT_FILE || '').trim()
  if (explicit) return path.resolve(explicit)
  if (!isDevelopmentRuntime()) return ''

  const fromCwd = findUpFile(process.cwd(), LOCAL_ANNOUNCEMENT_FILE)
  if (fromCwd) return fromCwd
  return findUpFile(__dirname, LOCAL_ANNOUNCEMENT_FILE)
}

function getBundledAnnouncementFile (runtimeDirValue = __dirname) {
  const explicit = String(process.env.AIDECK_BUNDLED_ANNOUNCEMENT_FILE || '').trim()
  if (explicit && fs.existsSync(path.resolve(explicit))) return path.resolve(explicit)

  const runtimeDir = path.resolve(runtimeDirValue)
  const candidates = [
    path.resolve(runtimeDir, '..', LOCAL_ANNOUNCEMENT_FILE),
    path.resolve(runtimeDir, '..', '..', LOCAL_ANNOUNCEMENT_FILE)
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || ''
}

function readJsonSafe (filePath, fallback) {
  const data = fileUtils.readJsonFile(filePath)
  return data == null ? fallback : data
}

function writeJsonSafe (filePath, data) {
  if (!fileUtils.writeJsonFile(filePath, data)) {
    throw new Error('写入公告状态失败: ' + filePath)
  }
}

function fetchJson (url) {
  return new Promise((resolve, reject) => {
    const target = normalizeAnnouncementUrl(url)
    if (!target) {
      reject(new Error('公告地址为空'))
      return
    }

    if (target.startsWith('file://')) {
      try {
        const filePath = decodeURIComponent(target.replace(/^file:\/\//, ''))
        resolve(JSON.parse(fs.readFileSync(filePath, 'utf8')))
      } catch (err) {
        reject(err)
      }
      return
    }

    const client = target.startsWith('http://') ? http : https
    const request = client.get(target + (target.includes('?') ? '&' : '?') + 't=' + Date.now(), {
      headers: {
        'User-Agent': 'AiDeck',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      },
      timeout: 10000
    }, response => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        reject(new Error('远程公告接口返回异常状态: ' + response.statusCode))
        return
      }
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (err) {
          reject(err)
        }
      })
    })
    request.on('timeout', () => {
      request.destroy(new Error('拉取远程公告超时'))
    })
    request.on('error', reject)
  })
}

function normalizeResponse (payload) {
  const raw = payload && typeof payload === 'object' ? payload : {}
  const announcements = Array.isArray(raw.announcements)
    ? raw.announcements
    : Array.isArray(raw.data)
      ? raw.data
      : []
  return {
    version: String(raw.version || '1.0'),
    announcements: announcements.map(normalizeAnnouncement).filter(Boolean)
  }
}

function normalizeAnnouncement (item) {
  if (!item || typeof item !== 'object') return null
  const id = String(item.id || '').trim()
  if (!id) return null
  return {
    id,
    type: String(item.type || item.announcementType || 'info').trim() || 'info',
    priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
    title: String(item.title || '').trim(),
    summary: String(item.summary || '').trim(),
    content: String(item.content || '').trim(),
    version: String(item.version || item.appVersion || item.updateVersion || item.app_version || item.update_version || '').trim(),
    releaseStatus: String(item.releaseStatus || item.release_status || item.marketStatus || item.market_status || '').trim(),
    marketVersion: String(item.marketVersion || item.market_version || '').trim(),
    action: normalizeAction(item.action),
    targetVersions: String(item.targetVersions || item.target_versions || '*').trim() || '*',
    targetLanguages: Array.isArray(item.targetLanguages)
      ? item.targetLanguages.map(value => String(value || '').trim()).filter(Boolean)
      : Array.isArray(item.target_languages)
        ? item.target_languages.map(value => String(value || '').trim()).filter(Boolean)
        : ['*'],
    showOnce: item.showOnce !== false && item.show_once !== false,
    popup: item.popup === true,
    pinned: item.pinned === true || item.top === true,
    createdAt: String(item.createdAt || item.created_at || '').trim(),
    expiresAt: item.expiresAt || item.expires_at || null,
    locales: item.locales && typeof item.locales === 'object' ? item.locales : null,
    images: Array.isArray(item.images) ? item.images.map(normalizeImage).filter(Boolean) : []
  }
}

function normalizeAction (action) {
  if (!action || typeof action !== 'object') return null
  const type = String(action.type || '').trim()
  const target = String(action.target || '').trim()
  if (!type || !target) return null
  return {
    type,
    target,
    label: String(action.label || '').trim() || '打开',
    arguments: Array.isArray(action.arguments) ? action.arguments : []
  }
}

function normalizeImage (image) {
  if (!image || typeof image !== 'object') return null
  const url = String(image.url || '').trim()
  if (!url) return null
  return {
    url,
    label: String(image.label || '').trim(),
    alt: String(image.alt || '').trim()
  }
}

function loadCache () {
  const cache = readJsonSafe(getCachePath(), null)
  if (!cache || typeof cache !== 'object') return null
  if (!cache.data) return null
  return cache
}

function saveCache (payload) {
  writeJsonSafe(getCachePath(), {
    time: Date.now(),
    data: payload
  })
}

function removeCache () {
  fileUtils.deleteFile(getCachePath())
}

function getReadIds () {
  const raw = readJsonSafe(getReadIdsPath(), [])
  if (!Array.isArray(raw)) return []
  return raw.map(value => String(value || '').trim()).filter(Boolean)
}

function saveReadIds (ids) {
  const unique = Array.from(new Set((Array.isArray(ids) ? ids : []).map(value => String(value || '').trim()).filter(Boolean)))
  writeJsonSafe(getReadIdsPath(), unique)
}

async function loadAnnouncementsRaw (forceRefresh) {
  const localFile = getLocalAnnouncementFile()
  if (localFile) {
    return normalizeResponse(readJsonSafe(localFile, { announcements: [] }))
  }

  if (!forceRefresh) {
    const cache = loadCache()
    if (cache && Date.now() - Number(cache.time || 0) < CACHE_TTL_MS) {
      return normalizeResponse(cache.data)
    }
  }

  try {
    const remote = normalizeResponse(await fetchJson(getAnnouncementUrl()))
    saveCache(remote)
    return remote
  } catch (err) {
    const cache = loadCache()
    if (cache) return normalizeResponse(cache.data)
    const bundledFile = getBundledAnnouncementFile()
    if (bundledFile) return normalizeResponse(readJsonSafe(bundledFile, { announcements: [] }))
    return { version: '1.0', announcements: [] }
  }
}

function parseTime (value) {
  const time = new Date(String(value || '')).getTime()
  return Number.isFinite(time) ? time : 0
}

function compareVersions (left, right) {
  const a = String(left || '').replace(/^v/i, '').split('.').map(part => Number(part) || 0)
  const b = String(right || '').replace(/^v/i, '').split('.').map(part => Number(part) || 0)
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function matchVersionRule (currentVersion, rule) {
  const raw = String(rule || '*').trim()
  if (!raw || raw === '*') return true
  const match = raw.match(/^(>=|<=|>|<|=)?\s*v?([0-9][0-9a-zA-Z.-]*)$/)
  if (!match) return raw === currentVersion || raw === 'v' + currentVersion
  const op = match[1] || '='
  const cmp = compareVersions(currentVersion, match[2])
  if (op === '>=') return cmp >= 0
  if (op === '<=') return cmp <= 0
  if (op === '>') return cmp > 0
  if (op === '<') return cmp < 0
  return cmp === 0
}

function matchVersions (currentVersion, targetVersions) {
  const text = String(targetVersions || '*').trim()
  if (!text || text === '*') return true
  return text.split(',').some(rule => matchVersionRule(currentVersion, rule))
}

function matchLanguage (locale, languages) {
  const list = Array.isArray(languages) && languages.length > 0 ? languages : ['*']
  const current = String(locale || 'zh-CN').toLowerCase()
  return list.some(value => {
    const lang = String(value || '').toLowerCase()
    return lang === '*' || current === lang || current.startsWith(lang + '-')
  })
}

function applyLocale (announcement, locale) {
  const next = { ...announcement }
  const locales = announcement.locales && typeof announcement.locales === 'object' ? announcement.locales : null
  if (!locales) return next
  const current = String(locale || '').toLowerCase()
  const currentBase = current.split('-')[0]
  const key = Object.keys(locales).find(item => {
    const normalized = item.toLowerCase()
    const normalizedBase = normalized.split('-')[0]
    return normalized === current || current.startsWith(normalized + '-') || normalizedBase === currentBase
  })
  const localized = key ? locales[key] : null
  if (!localized || typeof localized !== 'object') return next
  if (localized.title) next.title = String(localized.title)
  if (localized.summary) next.summary = String(localized.summary)
  if (localized.content) next.content = String(localized.content)
  if (localized.version) next.version = String(localized.version)
  if (localized.releaseStatus) next.releaseStatus = String(localized.releaseStatus)
  if (localized.marketVersion) next.marketVersion = String(localized.marketVersion)
  if (localized.actionLabel && next.action) {
    next.action = { ...next.action, label: String(localized.actionLabel) }
  }
  return next
}

function filterAnnouncements (announcements, options = {}) {
  const currentVersion = String(options.version || '0.0.0')
  const locale = String(options.locale || 'zh-CN')
  const now = Date.now()
  return (Array.isArray(announcements) ? announcements : [])
    .filter(item => matchVersions(currentVersion, item.targetVersions))
    .filter(item => matchLanguage(locale, item.targetLanguages))
    .filter(item => !item.expiresAt || parseTime(item.expiresAt) === 0 || parseTime(item.expiresAt) >= now)
    .map(item => applyLocale(item, locale))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      const timeDiff = parseTime(b.createdAt) - parseTime(a.createdAt)
      return timeDiff || (Number(b.priority || 0) - Number(a.priority || 0))
    })
}

async function getAnnouncementState (options = {}) {
  const raw = await loadAnnouncementsRaw(false)
  const announcements = filterAnnouncements(raw.announcements, options)
  const readIds = getReadIds()
  const unreadIds = announcements.filter(item => !readIds.includes(item.id)).map(item => item.id)
  const popupAnnouncement = announcements.find(item => item.popup && unreadIds.includes(item.id)) || null
  return { announcements, unreadIds, popupAnnouncement }
}

async function forceRefreshAnnouncements (options = {}) {
  removeCache()
  const raw = await loadAnnouncementsRaw(true)
  const announcements = filterAnnouncements(raw.announcements, options)
  const readIds = getReadIds()
  const unreadIds = announcements.filter(item => !readIds.includes(item.id)).map(item => item.id)
  const popupAnnouncement = announcements.find(item => item.popup && unreadIds.includes(item.id)) || null
  return { announcements, unreadIds, popupAnnouncement }
}

async function markAnnouncementAsRead (id) {
  const value = String(id || '').trim()
  if (!value) return { success: false }
  const ids = getReadIds()
  if (!ids.includes(value)) {
    ids.push(value)
    saveReadIds(ids)
  }
  return { success: true }
}

async function markAllAnnouncementsAsRead (options = {}) {
  const raw = await loadAnnouncementsRaw(false)
  const announcements = filterAnnouncements(raw.announcements, options)
  saveReadIds(announcements.map(item => item.id))
  return { success: true }
}

module.exports = {
  DEFAULT_ANNOUNCEMENT_URL,
  getAnnouncementState,
  forceRefreshAnnouncements,
  markAnnouncementAsRead,
  markAllAnnouncementsAsRead,
  filterAnnouncements,
  normalizeResponse,
  normalizeAnnouncementUrl,
  getLocalAnnouncementFile,
  getBundledAnnouncementFile,
  isDevelopmentRuntime
}
