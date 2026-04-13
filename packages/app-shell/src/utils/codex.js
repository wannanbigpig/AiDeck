import { coerceBooleanSetting } from './globalSettings'
import { normalizeRefreshIntervalMinutes } from './refreshInterval'

export const DEFAULT_CODEX_ADVANCED_SETTINGS = {
  autoRefreshMinutes: 10,
  codexStartupPath: '',
  openCodeStartupPath: '',
  autoRestartCodexApp: false,
  autoStartCodexAppWhenClosed: false,
  overrideOpenCode: true,
  autoRestartOpenCode: false,
  autoStartOpenCodeWhenClosed: false,
  showCodeReviewQuota: true,
  autoSwitch: true,
  autoSwitchHourlyThreshold: 20,
  autoSwitchWeeklyThreshold: 1,
  autoSwitchPreferSameEmail: true
}

const AUTO_SWITCH_THRESHOLD_MAX = 30

export const CODEX_BOOLEAN_SETTING_KEYS = [
  'autoRestartCodexApp',
  'autoStartCodexAppWhenClosed',
  'overrideOpenCode',
  'autoRestartOpenCode',
  'autoStartOpenCodeWhenClosed',
  'showCodeReviewQuota',
  'autoSwitch',
  'autoSwitchPreferSameEmail'
]

export function normalizeCodexAdvancedSettings (raw) {
  const merged = { ...DEFAULT_CODEX_ADVANCED_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) }
  const next = { ...merged }

  if (typeof merged.autoRestartCodexApp === 'undefined' && typeof merged.autoStartCodexApp !== 'undefined') {
    next.autoRestartCodexApp = coerceBooleanSetting(merged.autoStartCodexApp, DEFAULT_CODEX_ADVANCED_SETTINGS.autoRestartCodexApp)
  }

  for (let i = 0; i < CODEX_BOOLEAN_SETTING_KEYS.length; i++) {
    const key = CODEX_BOOLEAN_SETTING_KEYS[i]
    next[key] = coerceBooleanSetting(merged[key], DEFAULT_CODEX_ADVANCED_SETTINGS[key])
  }

  next.autoRefreshMinutes = normalizeRefreshIntervalMinutes(
    merged.autoRefreshMinutes,
    DEFAULT_CODEX_ADVANCED_SETTINGS.autoRefreshMinutes
  )
    
  next.autoSwitchHourlyThreshold = Math.max(0, Math.min(AUTO_SWITCH_THRESHOLD_MAX, Number(merged.autoSwitchHourlyThreshold) || 0))
  next.autoSwitchWeeklyThreshold = Math.max(0, Math.min(AUTO_SWITCH_THRESHOLD_MAX, Number(merged.autoSwitchWeeklyThreshold) || 0))

  const codexPathRaw = typeof merged.codexStartupPath === 'string' && merged.codexStartupPath.trim()
    ? merged.codexStartupPath
    : merged.startupPath
  next.codexStartupPath = codexPathRaw || DEFAULT_CODEX_ADVANCED_SETTINGS.codexStartupPath
  delete next.startupPath

  const openCodePathRaw = typeof merged.openCodeStartupPath === 'string' && merged.openCodeStartupPath.trim()
    ? merged.openCodeStartupPath
    : merged.openCodePath
  next.openCodeStartupPath = openCodePathRaw || DEFAULT_CODEX_ADVANCED_SETTINGS.openCodeStartupPath
  delete next.openCodePath

  delete next.autoSwitchLockMinutes

  return next
}

export function resolveQuotaErrorMeta(quotaError, fallbackMessage = '') {
  let rawMessage = ''
  let statusCode = ''
  let errorCode = ''
  let disabled = false
  const source = quotaError && typeof quotaError === 'object' ? quotaError : null

  if (source) {
    rawMessage = String(source.rawMessage || source.message || source.error || fallbackMessage || '').trim()
    statusCode = String(source.statusCode || source.status || '').trim()
    errorCode = String(source.errorCode || source.error_code || source.code || '').trim()
    disabled = Boolean(source.disabled)
  } else {
    rawMessage = String(quotaError || fallbackMessage || '').trim()
    if (rawMessage.startsWith('{') && rawMessage.endsWith('}')) {
      try {
        const obj = JSON.parse(rawMessage)
        if (obj && typeof obj === 'object') {
          statusCode = String(obj.statusCode || obj.status || '').trim()
          errorCode = String(obj.errorCode || obj.error_code || obj.code || '').trim()
          const msg = String(obj.rawMessage || obj.message || obj.error || '').trim()
          if (msg) rawMessage = msg
          disabled = Boolean(obj.disabled)
        }
      } catch (e) {}
    }
  }

  const lowerMessage = rawMessage.toLowerCase()
  const lowerCode = errorCode.toLowerCase()
  return {
    rawMessage,
    statusCode,
    errorCode: errorCode || (statusCode === '401' ? 'unauthorized' : ''),
    disabled: disabled || lowerCode === 'deactivated_workspace' || lowerMessage.includes('deactivated_workspace') || statusCode === '402'
  }
}

export function isCodexTeamLikePlan(planType) {
  if (!planType || typeof planType !== 'string') return false
  const upper = planType.toUpperCase()
  return upper.includes('TEAM') || upper.includes('BUSINESS') || upper.includes('ENTERPRISE') || upper.includes('EDU')
}

export function decodeJwtPayload(token) {
  const raw = String(token || '').trim()
  if (!raw) return null
  try {
    const parts = raw.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      const binary = window.atob(base64)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      const text = new TextDecoder().decode(bytes)
      return JSON.parse(text)
    }
    // Node.js env fallback
    if (typeof Buffer !== 'undefined') {
      return JSON.parse(Buffer.from(payload, 'base64').toString())
    }
    return JSON.parse(atob(base64))
  } catch {
    return null
  }
}

export function formatCodexLoginProvider(rawProvider) {
  const value = String(rawProvider || '').trim()
  if (!value) return ''
  const normalized = value.toLowerCase()
  if (normalized === 'google') return 'Google'
  if (normalized === 'github') return 'GitHub'
  if (normalized === 'microsoft') return 'Microsoft'
  if (normalized === 'apple') return 'Apple'
  if (normalized === 'password') return 'Password'
  return value
}

export function firstNonEmptyString() {
  for (let i = 0; i < arguments.length; i++) {
    const val = arguments[i]
    if (typeof val !== 'string') continue
    const trimmed = val.trim()
    if (trimmed) return trimmed
  }
  return ''
}

export function resolveCodexIdentityDisplay(account) {
  const tokens = (account && account.tokens && typeof account.tokens === 'object') ? account.tokens : {}
  const idPayload = decodeJwtPayload(tokens.id_token)
  const accessPayload = decodeJwtPayload(tokens.access_token)
  const idAuth = (idPayload && idPayload['https://api.openai.com/auth'] && typeof idPayload['https://api.openai.com/auth'] === 'object')
    ? idPayload['https://api.openai.com/auth']
    : {}
  const accessAuth = (accessPayload && accessPayload['https://api.openai.com/auth'] && typeof accessPayload['https://api.openai.com/auth'] === 'object')
    ? accessPayload['https://api.openai.com/auth']
    : {}

  const userId = firstNonEmptyString(
    idAuth.chatgpt_user_id,
    accessAuth.chatgpt_user_id,
    idAuth.user_id,
    accessAuth.user_id,
    account.user_id,
    idPayload && idPayload.sub,
    accessPayload && accessPayload.sub
  )

  const accountId = firstNonEmptyString(
    account.account_id,
    idAuth.chatgpt_account_id,
    accessAuth.chatgpt_account_id,
    idAuth.account_id,
    accessAuth.account_id,
    idPayload && idPayload.account_id,
    accessPayload && accessPayload.account_id,
    account.id
  )

  return {
    userId: userId || '-',
    accountId: accountId || '-'
  }
}

export function resolveCodexAddMethodDisplay(account) {
  const addedVia = String(account.added_via || '').trim().toLowerCase()
  const mode = String(account.auth_mode || '').trim().toLowerCase()
  if (addedVia === 'local') return '本地导入'
  if (addedVia === 'json') return 'JSON导入'
  if (addedVia === 'oauth') return 'OAuth授权'
  if (addedVia === 'token') return 'Token导入'
  if (addedVia === 'apikey') return 'API Key导入'
  if (mode === 'oauth') {
    return 'OAuth授权'
  }
  if (mode === 'token') {
    return 'Token导入'
  }
  if (mode === 'import') {
    return 'JSON导入'
  }
  if (mode === 'apikey') {
    return 'API Key导入'
  }
  return '未知来源'
}

export function resolveCodexProviderLoginDisplay(account) {
  const mode = String(account.auth_mode || '').trim().toLowerCase()
  if (mode === 'apikey') {
    return 'API Key'
  }

  const tokens = (account && account.tokens && typeof account.tokens === 'object') ? account.tokens : {}
  const idPayload = decodeJwtPayload(tokens.id_token)
  const accessPayload = decodeJwtPayload(tokens.access_token)
  const provider = formatCodexLoginProvider(
    (idPayload && idPayload.auth_provider) ||
    (accessPayload && accessPayload.auth_provider) ||
    ''
  )
  if (provider) return `${provider} 登录`
  if (mode === 'oauth') return 'OAuth 登录'
  return '未知登录'
}

export function resolveWorkspaceTitleFromToken(account) {
  const tokens = (account && account.tokens && typeof account.tokens === 'object') ? account.tokens : {}
  const idPayload = decodeJwtPayload(tokens.id_token)
  const accessPayload = decodeJwtPayload(tokens.access_token)
  const auth = (idPayload && idPayload['https://api.openai.com/auth'] && typeof idPayload['https://api.openai.com/auth'] === 'object')
    ? idPayload['https://api.openai.com/auth']
    : ((accessPayload && accessPayload['https://api.openai.com/auth'] && typeof accessPayload['https://api.openai.com/auth'] === 'object')
        ? accessPayload['https://api.openai.com/auth']
        : {})
  const organizations = Array.isArray(auth.organizations) ? auth.organizations : []
  if (organizations.length === 0) return ''

  const expectedOrgId = String(account.organization_id || '').trim()
  let matched = ''
  let defaultTitle = ''
  let first = ''

  for (let i = 0; i < organizations.length; i++) {
    const item = organizations[i]
    if (!item || typeof item !== 'object') continue
    const orgId = String(item.id || item.organization_id || item.workspace_id || '').trim()
    const title = String(item.title || item.name || item.display_name || item.workspace_name || item.organization_name || orgId || '').trim()
    if (!title) continue
    if (!first) first = title
    if (!defaultTitle && item.is_default === true) defaultTitle = title
    if (!matched && expectedOrgId && orgId && orgId === expectedOrgId) {
      matched = title
    }
  }

  return matched || defaultTitle || first
}

export function resolveWorkspaceDisplay(account) {
  const structure = String(account.account_structure || '').trim().toLowerCase()
  const accountName = String(account.account_name || '').trim()
  const rawWorkspace = String(account.workspace || '').trim()
  const tokenWorkspace = resolveWorkspaceTitleFromToken(account)
  const isPersonalStructure = structure.includes('personal')
  const isTeam = !isPersonalStructure && (structure ? !structure.includes('personal') : isCodexTeamLikePlan(account.plan_type))
  const typeLabel = isTeam ? 'Team' : 'Personal'
  const emailName = String(account.email || '').split('@')[0] || ''

  let name = ''
  if (isTeam) {
    name = accountName || tokenWorkspace || (rawWorkspace && rawWorkspace !== '个人' ? rawWorkspace : '')
  } else {
    name = accountName || (rawWorkspace && rawWorkspace !== '团队' ? rawWorkspace : '') || emailName
  }

  const normalizedName = String(name || '').trim()
  const text = isTeam
    ? (normalizedName ? `${typeLabel} | ${normalizedName}` : typeLabel)
    : 'Personal'

  return {
    type: typeLabel,
    name: normalizedName,
    text
  }
}

export function shouldOfferReauthorizeAction(quotaErrorMeta) {
  const statusCode = String(quotaErrorMeta?.statusCode || '').trim()
  const errorCode = String(quotaErrorMeta?.errorCode || '').trim().toLowerCase()
  const rawMessage = String(quotaErrorMeta?.rawMessage || '').trim().toLowerCase()
  if (!statusCode && !errorCode && !rawMessage) return false

  return statusCode === '401' ||
    errorCode === 'token_invalidated' ||
    errorCode === 'invalid_grant' ||
    errorCode === 'invalid_token' ||
    errorCode === 'token_revoked' ||
    rawMessage.includes('token_invalidated') ||
    rawMessage.includes('invalid_grant') ||
    rawMessage.includes('invalid_token') ||
    rawMessage.includes('token_revoked') ||
    rawMessage.includes('invalidated oauth token') ||
    rawMessage.includes('401 unauthorized') ||
    rawMessage.includes('token 已过期且无 refresh_token') ||
    rawMessage.includes('token 已过期且刷新失败') ||
    rawMessage.includes('刷新 token 失败')
}
