import { coerceBooleanSetting } from './globalSettings.js'
import { readSharedSetting } from './hostBridge.js'
import { normalizeRefreshIntervalMinutes } from './refreshInterval.js'

export const ANTIGRAVITY_SETTINGS_KEY = 'antigravity_advanced_settings'

export const DEFAULT_ANTIGRAVITY_SETTINGS = {
  autoRefreshMinutes: 10,
  startupPath: '',
  oauthClientId: '',
  oauthClientSecret: '',
  autoRestartAntigravityApp: false,
  autoStartAntigravityAppWhenClosed: false,
  quotaAggregatedDisplay: true,
  switchDeviceIdentity: true,
  autoSwitch: false,
  autoSwitchThreshold: 30, // 30%
  autoSwitchModelGroup: 'any',
  quotaWarningEnabled: false,
  quotaWarningClaudeThreshold: 10,
  quotaWarningGeminiProThreshold: 10,
  quotaWarningGeminiFlashThreshold: 10
}

const AUTO_SWITCH_THRESHOLD_MAX = 30

export const ANTIGRAVITY_BOOLEAN_SETTING_KEYS = [
  'autoRestartAntigravityApp',
  'autoStartAntigravityAppWhenClosed',
  'quotaAggregatedDisplay',
  'switchDeviceIdentity',
  'autoSwitch',
  'quotaWarningEnabled'
]
export const ANTIGRAVITY_MODEL_GROUPS = ['claude', 'gemini_pro', 'gemini_flash']

export function normalizeAntigravityAdvancedSettings (raw) {
  const merged = { ...DEFAULT_ANTIGRAVITY_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) }
  const next = { ...merged }
  if (typeof merged.autoRestartAntigravityApp === 'undefined' && typeof merged.autoStartAntigravityApp !== 'undefined') {
    next.autoRestartAntigravityApp = coerceBooleanSetting(merged.autoStartAntigravityApp, DEFAULT_ANTIGRAVITY_SETTINGS.autoRestartAntigravityApp)
  }
  for (let i = 0; i < ANTIGRAVITY_BOOLEAN_SETTING_KEYS.length; i++) {
    const key = ANTIGRAVITY_BOOLEAN_SETTING_KEYS[i]
    next[key] = coerceBooleanSetting(merged[key], DEFAULT_ANTIGRAVITY_SETTINGS[key])
  }
  next.autoRefreshMinutes = normalizeRefreshIntervalMinutes(
    merged.autoRefreshMinutes,
    DEFAULT_ANTIGRAVITY_SETTINGS.autoRefreshMinutes
  )
  next.autoSwitchThreshold = Math.max(0, Math.min(AUTO_SWITCH_THRESHOLD_MAX, Number(merged.autoSwitchThreshold) || 0))
  next.quotaWarningClaudeThreshold = Math.max(0, Math.min(AUTO_SWITCH_THRESHOLD_MAX, Number(merged.quotaWarningClaudeThreshold) || 0))
  next.quotaWarningGeminiProThreshold = Math.max(0, Math.min(AUTO_SWITCH_THRESHOLD_MAX, Number(merged.quotaWarningGeminiProThreshold) || 0))
  next.quotaWarningGeminiFlashThreshold = Math.max(0, Math.min(AUTO_SWITCH_THRESHOLD_MAX, Number(merged.quotaWarningGeminiFlashThreshold) || 0))
  next.startupPath = typeof merged.startupPath === 'string' ? merged.startupPath : DEFAULT_ANTIGRAVITY_SETTINGS.startupPath
  next.oauthClientId = typeof merged.oauthClientId === 'string' ? merged.oauthClientId.trim() : DEFAULT_ANTIGRAVITY_SETTINGS.oauthClientId
  next.oauthClientSecret = typeof merged.oauthClientSecret === 'string' ? merged.oauthClientSecret.trim() : DEFAULT_ANTIGRAVITY_SETTINGS.oauthClientSecret
  const modelGroup = String(merged.autoSwitchModelGroup || '').trim()
  next.autoSwitchModelGroup = modelGroup && (modelGroup === 'any' || ANTIGRAVITY_MODEL_GROUPS.includes(modelGroup))
    ? modelGroup
    : DEFAULT_ANTIGRAVITY_SETTINGS.autoSwitchModelGroup
  return next
}

export function readAntigravityAdvancedSettings () {
  return normalizeAntigravityAdvancedSettings(readSharedSetting(ANTIGRAVITY_SETTINGS_KEY, null))
}

/**
 * Antigravity 配额展示辅助方法
 * 采用固定展示分组策略：Claude / Gemini 3.1 Pro / Gemini 3 Flash
 */

const DISPLAY_GROUPS = [
  {
    id: 'claude',
    label: 'Claude',
    models: [
      'claude-opus-4-6-thinking',
      'claude-opus-4-6',
      'claude-opus-4-5-thinking',
      'claude-sonnet-4-6',
      'claude-sonnet-4-6-thinking',
      'claude-sonnet-4-5',
      'claude-sonnet-4-5-thinking',
      'gpt-oss-120b-medium',
      'MODEL_PLACEHOLDER_M12',
      'MODEL_PLACEHOLDER_M26',
      'MODEL_PLACEHOLDER_M35',
      'MODEL_CLAUDE_4_5_SONNET',
      'MODEL_CLAUDE_4_5_SONNET_THINKING',
      'MODEL_OPENAI_GPT_OSS_120B_MEDIUM'
    ]
  },
  {
    id: 'gemini_pro',
    label: 'Gemini 3.1 Pro',
    models: [
      'gemini-3.1-pro-high',
      'gemini-3.1-pro-low',
      'gemini-3-pro-high',
      'gemini-3-pro-low',
      'gemini-3-pro-image',
      'MODEL_PLACEHOLDER_M7',
      'MODEL_PLACEHOLDER_M8',
      'MODEL_PLACEHOLDER_M9',
      'MODEL_PLACEHOLDER_M36',
      'MODEL_PLACEHOLDER_M37'
    ]
  },
  {
    id: 'gemini_flash',
    label: 'Gemini 3 Flash',
    models: [
      'gemini-3-flash',
      'gemini-3.1-flash',
      'gemini-3-flash-image',
      'gemini-3.1-flash-image',
      'gemini-3-flash-lite',
      'gemini-3.1-flash-lite',
      'MODEL_PLACEHOLDER_M18'
    ]
  }
]

const IDE_DISPLAY_MODELS = [
  {
    id: 'gemini_3_1_pro_high',
    label: 'Gemini 3.1 Pro (High)',
    models: ['gemini-3.1-pro-high', 'gemini-3-pro-high']
  },
  {
    id: 'gemini_3_1_pro_low',
    label: 'Gemini 3.1 Pro (Low)',
    models: ['gemini-3.1-pro-low', 'gemini-3-pro-low']
  },
  {
    id: 'gemini_3_flash',
    label: 'Gemini 3 Flash',
    models: [
      'gemini-3-flash',
      'gemini-3.1-flash',
      'gemini-3-flash-image',
      'gemini-3.1-flash-image',
      'gemini-3-flash-lite',
      'gemini-3.1-flash-lite',
      'MODEL_PLACEHOLDER_M18'
    ]
  },
  {
    id: 'claude_sonnet_4_6_thinking',
    label: 'Claude Sonnet 4.6 (Thinking)',
    models: ['claude-sonnet-4-6-thinking', 'claude-sonnet-4-6', 'claude-sonnet-4-5-thinking', 'claude-sonnet-4-5']
  },
  {
    id: 'claude_opus_4_6_thinking',
    label: 'Claude Opus 4.6 (Thinking)',
    models: ['claude-opus-4-6-thinking', 'claude-opus-4-6', 'claude-opus-4-5-thinking']
  },
  {
    id: 'gpt_oss_120b_medium',
    label: 'GPT-OSS 120B (Medium)',
    models: ['gpt-oss-120b-medium', 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM']
  }
]

const MODEL_MATCH_REPLACEMENTS = {
  'gemini-3-pro-high': 'gemini-3.1-pro-high',
  'gemini-3-pro-low': 'gemini-3.1-pro-low',
  'claude-sonnet-4-5': 'claude-sonnet-4-6',
  'claude-sonnet-4-5-thinking': 'claude-sonnet-4-6',
  'claude-opus-4-5-thinking': 'claude-opus-4-6-thinking'
}

function normalizeModelForMatch (value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  return MODEL_MATCH_REPLACEMENTS[normalized] || normalized
}

function matchModelName (modelName, target) {
  const left = normalizeModelForMatch(modelName)
  const right = normalizeModelForMatch(target)
  if (!left || !right) return false
  return left === right || left.startsWith(right + '-') || right.startsWith(left + '-')
}

function toUnixSeconds (value) {
  if (value === null || value === undefined || value === '') return 0

  if (typeof value === 'object') {
    const candidates = [
      value.seconds,
      value.sec,
      value.value,
      value.timestamp,
      value.ts,
      value.reset_at,
      value.resetAt,
      value.reset_time,
      value.resetTime
    ]
    for (let i = 0; i < candidates.length; i++) {
      const normalized = toUnixSeconds(candidates[i])
      if (normalized > 0) return normalized
    }
    return 0
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1000000000000) return Math.floor(value / 1000)
    if (value > 10000000000) return Math.floor(value / 1000)
    return Math.floor(value)
  }

  const str = String(value).trim()
  if (!str) return 0

  const numeric = Number(str)
  if (Number.isFinite(numeric)) {
    return toUnixSeconds(numeric)
  }

  const parsedMs = Date.parse(str)
  if (!Number.isFinite(parsedMs)) return 0
  return Math.floor(parsedMs / 1000)
}

function buildDisplayItemsFromDefinitions (models, definitions) {
  const items = []

  for (const definition of definitions) {
    const matched = models.filter((model) => {
      const modelName = model?.name || model?.display_name || ''
      return definition.models.some((candidate) => matchModelName(modelName, candidate))
    })

    if (matched.length === 0) continue

    const percentages = matched
      .map((model) => Number(model?.percentage))
      .filter((value) => Number.isFinite(value))

    if (percentages.length === 0) continue

    const percentage = Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length)
    const resetCandidates = matched
      .map((model) => toUnixSeconds(model?.reset_time))
      .filter((value) => value > 0)
    const resetTime = resetCandidates.length > 0 ? Math.min(...resetCandidates) : 0

    items.push({
      key: definition.id,
      label: definition.label,
      percentage,
      resetTime
    })
  }

  return items
}

export function getAntigravityQuotaDisplayItems (quota, options = {}) {
  const aggregated = options.aggregated !== false
  let models = []
  if (Array.isArray(quota?.models)) {
    models = quota.models
  } else if (quota?.models && typeof quota.models === 'object') {
    models = Object.entries(quota.models).map(([name, info]) => {
      const item = info && typeof info === 'object' ? info : {}
      const qi = item.quotaInfo || item.quota_info || item.quota || {}
      const fraction = qi.remainingFraction ?? qi.remaining_fraction ?? item.remainingFraction ?? item.remaining_fraction
      const rawPercentage = item.percentage ?? fraction
      let percentage = Number(rawPercentage)
      if (!Number.isFinite(percentage)) {
        percentage = 0
      } else if (percentage <= 1) {
        percentage = Math.round(percentage * 100)
      } else {
        percentage = Math.round(percentage)
      }

      return {
        name: item.name || item.model || name,
        display_name: item.display_name || item.displayName || name,
        percentage,
        reset_time: item.reset_time || item.resetTime || qi.reset_time || qi.resetTime
      }
    })
  }
  if (models.length === 0) return []

  if (!aggregated) {
    const ideItems = buildDisplayItemsFromDefinitions(models, IDE_DISPLAY_MODELS)
    if (ideItems.length > 0) return ideItems

    return models.slice(0, 6).map((model, idx) => ({
      key: model?.name || `model-${idx}`,
      label: model?.display_name || model?.name || `模型 ${idx + 1}`,
      percentage: Number.isFinite(Number(model?.percentage)) ? Math.round(Number(model.percentage)) : 0,
      resetTime: toUnixSeconds(model?.reset_time)
    }))
  }

  const grouped = buildDisplayItemsFromDefinitions(models, DISPLAY_GROUPS)

  if (grouped.length > 0) {
    return grouped
  }

  return models.slice(0, 3).map((model, idx) => ({
    key: model?.name || `model-${idx}`,
    label: model?.display_name || model?.name || `模型 ${idx + 1}`,
    percentage: Number.isFinite(Number(model?.percentage)) ? Math.round(Number(model.percentage)) : 0,
    resetTime: toUnixSeconds(model?.reset_time)
  }))
}

export function getAntigravityTierBadge (quota) {
  const raw = String(quota?.subscription_tier || '').trim()
  if (!raw) {
    return { label: '', className: '' }
  }

  const normalized = raw
    .replace(/-tier$/i, '')
    .replace(/^g1-/i, '')
    .trim()

  const upper = normalized.toUpperCase()
  if (upper.includes('ULTRA') || upper.includes('ULTIMATE')) {
    return { label: 'ULTRA', className: 'ultra' }
  }
  if (upper.includes('PRO') || upper.includes('PLUS') || upper.includes('BUSINESS') || upper.includes('TEAM') || upper.includes('ENTERPRISE')) {
    return { label: 'PRO', className: 'pro' }
  }
  if (upper.includes('FREE')) {
    return { label: 'FREE', className: 'free' }
  }

  return { label: upper, className: 'free' }
}

export function getAvailableAICreditsDisplay (quota) {
  const credits = Array.isArray(quota?.credits) ? quota.credits : []
  if (credits.length === 0) return ''

  let total = 0
  let hasValue = false

  for (const item of credits) {
    const raw = item?.credit_amount
    if (raw === null || raw === undefined || raw === '') continue
    const parsed = Number.parseFloat(String(raw).replace(/,/g, '').trim())
    if (!Number.isFinite(parsed)) continue
    total += parsed
    hasValue = true
  }

  if (!hasValue) return ''
  return total.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}
