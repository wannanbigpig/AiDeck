const MAX_LOGS = 800
const MAX_FILE_LINES = 2000
const ROTATION_SIZE_THRESHOLD = 1024 * 1024 // 1MB
const ROTATION_RETAIN_LINES = 100
const MAX_STRING_LENGTH = 600
const MAX_OBJECT_DEPTH = 4
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const dataRoot = require('./dataRoot.cjs')
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'token',
  'password',
  'code'
])

const state = globalThis.__AIDECK_REQUEST_LOG_STATE__ || {
  enabled: false,
  logs: [],
  seq: 0,
  listeners: new Set()
}

if (!(state.listeners instanceof Set)) {
  state.listeners = new Set()
}

globalThis.__AIDECK_REQUEST_LOG_STATE__ = state

function getLogDir () {
  const dir = dataRoot.getLogsDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {}
  return dir
}

function _notifyListeners (event) {
  const listeners = Array.from(state.listeners)
  for (let i = 0; i < listeners.length; i++) {
    try {
      listeners[i](event)
    } catch (e) {}
  }
}

function getLogFilePath () {
  return path.join(getLogDir(), 'request.log')
}

function formatTimestampWithLocalTimezone (value) {
  const date = new Date(Number(value) || Date.now())
  const pad = (num, size = 2) => String(num).padStart(size, '0')

  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
    '.',
    pad(date.getMilliseconds(), 3)
  ].join('')
}

function normalizeLogBodyForOutput (value) {
  if (typeof value !== 'string') return value
  const text = String(value || '')
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch (e) {}
  }
  return text.replace(/\r?\n\s*/g, ' ').trim()
}

function stringifyLogDetail (detail) {
  if (!detail || typeof detail !== 'object') return ''
  const next = Array.isArray(detail) ? detail.slice() : Object.assign({}, detail)
  if (Object.prototype.hasOwnProperty.call(next, 'body')) {
    next.body = normalizeLogBodyForOutput(next.body)
  }
  try {
    return JSON.stringify(next)
  } catch (e) {
    return JSON.stringify({ error: 'detail stringify failed' })
  }
}

function appendLogLine (entry) {
  const line = [
    formatTimestampWithLocalTimezone(entry.ts),
    String(entry.level || 'info').toUpperCase(),
    `[${entry.scope || 'system'}]`,
    entry.message || '',
    entry.detail ? stringifyLogDetail(entry.detail) : ''
  ].filter(Boolean).join(' ') + '\n'
  try {
    const filePath = getLogFilePath()
    fs.appendFileSync(filePath, line, { encoding: 'utf-8' })

    // 日志轮转逻辑：如果超过 1MB，则保留最后 100 条
    const stats = fs.statSync(filePath)
    if (stats.size > ROTATION_SIZE_THRESHOLD) {
      const content = fs.readFileSync(filePath, { encoding: 'utf-8' })
      const lines = content.split(/\r?\n/).filter(Boolean)
      const keptLines = lines.slice(-ROTATION_RETAIN_LINES).join('\n') + '\n'
      fs.writeFileSync(filePath, keptLines, { encoding: 'utf-8' })
    }
  } catch (e) {}
}

function _readLogFileLines (limit) {
  try {
    const filePath = getLogFilePath()
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, { encoding: 'utf-8' })
    if (!content) return []
    const lines = content.split(/\r?\n/).filter(Boolean)
    const max = Math.max(1, Math.min(MAX_FILE_LINES, Number(limit) || MAX_FILE_LINES))
    return lines.slice(-max).map((line, idx) => ({
      id: idx + 1,
      ts: 0,
      level: 'info',
      scope: 'file',
      message: '',
      detail: null,
      raw: line
    }))
  } catch (e) {
    return []
  }
}

function coerceBoolean (value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return false
}

function trimText (value, max = MAX_STRING_LENGTH) {
  const text = String(value || '')
  return text.length > max ? (text.slice(0, max) + '…') : text
}

function maskSecret (value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.length <= 8) return '*'.repeat(Math.max(4, text.length))
  return text.slice(0, 4) + '***' + text.slice(-4)
}

function maskEmail (value) {
  const text = String(value || '').trim()
  const parts = text.split('@')
  if (parts.length !== 2) return maskSecret(text)
  const local = parts[0]
  const domain = parts[1]
  const domainParts = domain.split('.')
  const main = domainParts[0] || ''
  const suffix = domainParts.slice(1).join('.')
  const maskedLocal = local.length <= 2
    ? (local[0] || '*') + '*'
    : local.slice(0, 2) + '***' + local.slice(-1)
  const maskedMain = main.length <= 1
    ? '*'
    : main[0] + '***' + main.slice(-1)
  return maskedLocal + '@' + maskedMain + (suffix ? '.' + suffix : '')
}

function sanitizePlainText (value, options = {}) {
  let text = String(value || '')
  if (!text) return ''

  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => maskEmail(email))
  text = text.replace(/(Bearer\s+)([A-Za-z0-9._-]{12,})/gi, (_all, prefix, secret) => prefix + maskSecret(secret))
  text = text.replace(
    /("?(?:access_token|refresh_token|id_token|client_secret|authorization|cookie|set-cookie|code)"?\s*[:=]\s*"?)([^",\s}]+)/gi,
    (_all, prefix, secret) => prefix + maskSecret(secret)
  )
  text = text.replace(/\b(ya29\.[A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9._-]{16,}|sk-[A-Za-z0-9_-]{12,})\b/g, (secret) => maskSecret(secret))

  const maxLength = Number.isFinite(options.maxLength) ? Number(options.maxLength) : MAX_STRING_LENGTH
  if (maxLength <= 0) return text
  return trimText(text, maxLength)
}

function sanitizeUrl (value, options = {}) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    const query = []
    parsed.searchParams.forEach((paramValue, key) => {
      query.push(key + '=' + maskSecret(paramValue))
    })
    const safePath = parsed.pathname
      .split('/')
      .map((segment) => {
        const text = String(segment || '').trim()
        if (!text) return text
        if (text.length > 18 || /^[a-f0-9-]{16,}$/i.test(text)) {
          return maskSecret(text)
        }
        return text
      })
      .join('/')
    return parsed.origin + safePath + (query.length > 0 ? ('?' + query.join('&')) : '')
  } catch (e) {
    return sanitizePlainText(raw, options)
  }
}

function sanitizeValue (value, key = '', depth = 0, options = {}) {
  if (value === null || value === undefined) return value
  if (depth > MAX_OBJECT_DEPTH) return '[Object]'
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}B]`

  const normalizedKey = String(key || '').trim().toLowerCase()
  const preserveText = options.preserveText === true || normalizedKey === 'body'
  if (typeof value === 'string') {
    if (SENSITIVE_KEYS.has(normalizedKey)) return maskSecret(value)
    if (normalizedKey.includes('url')) {
      return sanitizeUrl(value, { maxLength: preserveText ? 0 : MAX_STRING_LENGTH })
    }
    if (normalizedKey.includes('email')) return maskEmail(value)
    return sanitizePlainText(value, { maxLength: preserveText ? 0 : MAX_STRING_LENGTH })
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const next = value.slice(0, 20).map(item => sanitizeValue(item, normalizedKey, depth + 1, { preserveText }))
    if (value.length > 20) next.push(`[+${value.length - 20} more]`)
    return next
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 30)
    const next = {}
    for (let i = 0; i < entries.length; i++) {
      const [entryKey, entryValue] = entries[i]
      next[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1, {
        preserveText: preserveText || entryKey === 'body'
      })
    }
    if (Object.keys(value).length > 30) {
      next.__truncated = `+${Object.keys(value).length - 30} more keys`
    }
    return next
  }
  return sanitizePlainText(String(value))
}

function addLog ({ level = 'info', scope = 'system', message = '', detail = null, ts = null }) {
  if (!state.enabled) return null

  state.seq += 1
  const entry = {
    id: state.seq,
    ts: Number.isFinite(Number(ts)) ? Number(ts) : Date.now(),
    level: String(level || 'info').trim().toLowerCase() || 'info',
    scope: sanitizePlainText(scope || 'system', { maxLength: 120 }),
    message: sanitizePlainText(message || '', { maxLength: 200 }),
    detail: detail === null || typeof detail === 'undefined' ? null : sanitizeValue(detail)
  }

  state.logs.push(entry)
  if (state.logs.length > MAX_LOGS) {
    state.logs.splice(0, state.logs.length - MAX_LOGS)
  }
  appendLogLine(entry)
  _notifyListeners({ type: 'append', entry })
  return entry
}

function info (scope, message, detail) {
  return addLog({ level: 'info', scope, message, detail })
}

function warn (scope, message, detail) {
  return addLog({ level: 'warn', scope, message, detail })
}

function error (scope, message, detail) {
  return addLog({ level: 'error', scope, message, detail })
}

function listLogs (limit = 100) {
  const count = Math.max(1, Math.min(MAX_FILE_LINES, Number(limit) || 100))
  const fileLines = _readLogFileLines(count)
  if (fileLines.length > 0) return fileLines
  return state.logs.slice(-count)
}

function clearLogs () {
  state.logs = []
  try {
    fs.writeFileSync(getLogFilePath(), '', { encoding: 'utf-8' })
  } catch (e) {}
  _notifyListeners({ type: 'clear' })
  return true
}

function isEnabled () {
  return state.enabled === true
}

function setEnabled (enabled) {
  state.enabled = coerceBoolean(enabled)
  if (state.enabled) {
    info('request-log', '操作日志已开启')
  }
  _notifyListeners({ type: 'enabled', enabled: state.enabled })
  return state.enabled
}

function subscribe (listener) {
  if (typeof listener !== 'function') {
    return function unsubscribe () {}
  }
  state.listeners.add(listener)
  return function unsubscribe () {
    state.listeners.delete(listener)
  }
}

async function openLogDir () {
  const dirPath = getLogDir()
  try {
    try {
      const electron = require('electron')
      if (electron && electron.shell && typeof electron.shell.openPath === 'function') {
        const message = await electron.shell.openPath(dirPath)
        if (!message) {
          return { success: true, path: dirPath }
        }
        return { success: false, error: message, path: dirPath }
      }
    } catch (e) {}

    if (process.platform === 'darwin') {
      cp.spawn('open', [dirPath], { detached: true, stdio: 'ignore' }).unref()
      return { success: true, path: dirPath }
    }
    if (process.platform === 'win32') {
      cp.spawn('cmd', ['/c', 'start', '', dirPath], { detached: true, stdio: 'ignore' }).unref()
      return { success: true, path: dirPath }
    }
    if (process.platform === 'linux') {
      cp.spawn('xdg-open', [dirPath], { detached: true, stdio: 'ignore' }).unref()
      return { success: true, path: dirPath }
    }
    return { success: false, error: '当前系统不支持打开日志目录', path: dirPath }
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err), path: dirPath }
  }
}

module.exports = {
  addLog,
  info,
  warn,
  error,
  listLogs,
  clearLogs,
  isEnabled,
  setEnabled,
  subscribe,
  getLogDir,
  getLogFilePath,
  openLogDir,
  sanitizeValue,
  sanitizePlainText,
  sanitizeUrl,
  stringifyLogDetail,
  formatTimestampWithLocalTimezone
}
