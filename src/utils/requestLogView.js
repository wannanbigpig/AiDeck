export const INITIAL_LOG_LIMIT = 100
export const MAX_VISIBLE_LOGS = 500
export const BOTTOM_THRESHOLD_PX = 48

export function formatRequestLogTimestamp (value) {
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

export function stringifyRequestLogDetail (detail) {
  if (!detail || typeof detail !== 'object') return ''
  const next = Array.isArray(detail) ? detail.slice() : { ...detail }
  if (Object.prototype.hasOwnProperty.call(next, 'body')) {
    next.body = normalizeLogBodyForOutput(next.body)
  }
  return JSON.stringify(next)
}

export function getRequestLogLine (entry) {
  if (entry && entry.raw) return entry.raw
  const prefix = `${formatRequestLogTimestamp(entry.ts)} ${String(entry.level || 'info').toUpperCase()} [${entry.scope || 'system'}]`
  const detail = entry && entry.detail ? ` ${stringifyRequestLogDetail(entry.detail)}` : ''
  return `${prefix} ${entry && entry.message ? entry.message : ''}${detail}`
}

export function capVisibleLogs (entries, max = MAX_VISIBLE_LOGS) {
  const next = Array.isArray(entries) ? entries : []
  if (next.length <= max) return next
  return next.slice(-max)
}

export function mergeLogWindows (currentEntries, latestEntries, max = MAX_VISIBLE_LOGS) {
  const current = Array.isArray(currentEntries) ? currentEntries : []
  const latest = Array.isArray(latestEntries) ? latestEntries : []

  if (current.length === 0) {
    return {
      logs: capVisibleLogs(latest, max),
      appendedCount: latest.length
    }
  }
  if (latest.length === 0) {
    return {
      logs: capVisibleLogs(current, max),
      appendedCount: 0
    }
  }

  const currentLines = current.map(getRequestLogLine)
  const latestLines = latest.map(getRequestLogLine)
  const maxOverlap = Math.min(currentLines.length, latestLines.length)
  let overlap = 0

  for (let size = maxOverlap; size > 0; size--) {
    let matched = true
    for (let idx = 0; idx < size; idx++) {
      if (currentLines[currentLines.length - size + idx] !== latestLines[idx]) {
        matched = false
        break
      }
    }
    if (matched) {
      overlap = size
      break
    }
  }

  if (overlap === 0) {
    return {
      logs: capVisibleLogs(latest, max),
      appendedCount: latest.length
    }
  }

  const appended = latest.slice(overlap)
  if (appended.length === 0) {
    return {
      logs: capVisibleLogs(current, max),
      appendedCount: 0
    }
  }

  return {
    logs: capVisibleLogs(current.concat(appended), max),
    appendedCount: appended.length
  }
}

export function isNearLogBottom (element, threshold = BOTTOM_THRESHOLD_PX) {
  if (!element) return true
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight
  return distance <= threshold
}
