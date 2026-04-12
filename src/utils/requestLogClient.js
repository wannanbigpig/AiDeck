export function getRequestLogService () {
  if (typeof window === 'undefined') return null
  return window.services && window.services.logs ? window.services.logs : null
}

export function logRequestEvent (scope, message, detail, level = 'info') {
  try {
    getRequestLogService()?.log?.({ level, scope, message, detail })
  } catch (e) {}
}

export function setRequestLogEnabled (enabled) {
  try {
    return getRequestLogService()?.setEnabled?.(enabled) === true
  } catch (e) {
    return false
  }
}

export function readRequestLogs (limit = 100) {
  try {
    return getRequestLogService()?.list?.(limit) || []
  } catch (e) {
    return []
  }
}

export function clearRequestLogs () {
  try {
    return getRequestLogService()?.clear?.() === true
  } catch (e) {
    return false
  }
}

export function getRequestLogDirPath () {
  try {
    return String(getRequestLogService()?.getLogDirPath?.() || '')
  } catch (e) {
    return ''
  }
}

export function getRequestLogFilePath () {
  try {
    return String(getRequestLogService()?.getLogFilePath?.() || '')
  } catch (e) {
    return ''
  }
}

export async function openRequestLogDir () {
  try {
    return await Promise.resolve(getRequestLogService()?.openLogDir?.() || { success: false, error: '打开失败' })
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) }
  }
}
