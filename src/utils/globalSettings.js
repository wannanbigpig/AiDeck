const GLOBAL_SETTINGS_KEY = 'aideck_global_settings'

const DEFAULT_GLOBAL_SETTINGS = {
  autoImportLocalAccounts: true,
  requestLogEnabled: false
}

function _readRawSettings () {
  try {
    if (window.utools) {
      return window.utools.dbStorage.getItem(GLOBAL_SETTINGS_KEY) || null
    }
    const raw = localStorage.getItem(GLOBAL_SETTINGS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

export function readGlobalSettings () {
  const raw = _readRawSettings()
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_GLOBAL_SETTINGS }
  }
  return {
    ...DEFAULT_GLOBAL_SETTINGS,
    ...raw,
    autoImportLocalAccounts: raw.autoImportLocalAccounts !== false,
    requestLogEnabled: raw.requestLogEnabled === true
  }
}

export function writeGlobalSettings (patch) {
  const next = {
    ...readGlobalSettings(),
    ...(patch && typeof patch === 'object' ? patch : {})
  }
  next.autoImportLocalAccounts = next.autoImportLocalAccounts !== false
  next.requestLogEnabled = next.requestLogEnabled === true
  try {
    if (window.utools) {
      window.utools.dbStorage.setItem(GLOBAL_SETTINGS_KEY, next)
    } else {
      localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(next))
    }
  } catch (e) {}
  return next
}

export function getAutoImportLocalAccounts () {
  return readGlobalSettings().autoImportLocalAccounts !== false
}

export function getRequestLogEnabled () {
  return readGlobalSettings().requestLogEnabled === true
}

/**
 * 强制将各种输入转换为布尔值，常用于设置项读取
 */
export function coerceBooleanSetting(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return fallback
}
