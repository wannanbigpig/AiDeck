import { readSharedSetting } from './hostBridge.js'
import { normalizeRefreshIntervalMinutes } from './refreshInterval.js'

export const GEMINI_SETTINGS_KEY = 'gemini_advanced_settings'
const QUOTA_WARNING_THRESHOLD_MAX = 30

function toUnixSeconds (value) {
  if (value === null || value === undefined || value === '') return 0

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1000000000000) return Math.floor(value / 1000)
    if (value > 10000000000) return Math.floor(value / 1000)
    return Math.floor(value)
  }

  const raw = String(value).trim()
  if (!raw) return 0

  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    return toUnixSeconds(numeric)
  }

  const parsedMs = Date.parse(raw)
  if (!Number.isFinite(parsedMs)) return 0
  return Math.floor(parsedMs / 1000)
}

function formatGeminiModelLabel (value) {
  const raw = String(value || '').trim()
  if (!raw) return 'Gemini'

  const stripped = raw.replace(/^gemini-/i, '')
  const parts = stripped.split('-').filter(Boolean)
  if (parts.length === 0) return raw

  const tokens = parts.map((part) => {
    if (/^\d+(\.\d+)?$/.test(part)) return part
    if (/^\d{2,4}$/.test(part)) return part
    if (part.toLowerCase() === 'flash') return 'Flash'
    if (part.toLowerCase() === 'lite') return 'Lite'
    if (part.toLowerCase() === 'pro') return 'Pro'
    if (part.toLowerCase() === 'preview') return 'Preview'
    if (part.toLowerCase() === 'exp') return 'Exp'
    return part.charAt(0).toUpperCase() + part.slice(1)
  })

  return 'Gemini ' + tokens.join(' ')
}

function normalizeModelItems (quota, options = {}) {
  if (!quota || typeof quota !== 'object') return []
  const maxItems = Number.isFinite(options.maxItems) ? options.maxItems : 6

  let models = []
  if (Array.isArray(quota.models)) {
    models = quota.models
  } else if (quota.models && typeof quota.models === 'object') {
    models = Object.entries(quota.models).map(([name, info]) => {
      const item = info && typeof info === 'object' ? info : {}
      return Object.assign({ name }, item)
    })
  }

  const normalized = models
    .map((item, idx) => {
      const model = item && typeof item === 'object' ? item : {}
      const rawName = String(model.name || model.model || model.id || `model-${idx}`).trim()
      if (!rawName) return null

      const rawPercentage = model.percentage ?? model.remaining_percentage ?? model.remainingFraction ?? model.remaining_fraction
      let percentage = Number(rawPercentage)
      if (!Number.isFinite(percentage)) {
        percentage = 0
      } else if (percentage <= 1) {
        percentage = Math.round(Math.max(0, Math.min(1, percentage)) * 100)
      } else {
        percentage = Math.round(Math.max(0, Math.min(100, percentage)))
      }

      const requestsLeft = Number(model.requests_left ?? model.requestsLeft ?? model.remaining_amount ?? model.remainingAmount)
      const requestsLimit = Number(model.requests_limit ?? model.requestsLimit ?? model.limit)

      return {
        key: rawName,
        label: String(model.display_name || model.displayName || formatGeminiModelLabel(rawName)),
        percentage,
        resetTime: toUnixSeconds(model.reset_time ?? model.resetTime),
        requestsLeft: Number.isFinite(requestsLeft) ? requestsLeft : null,
        requestsLimit: Number.isFinite(requestsLimit) ? requestsLimit : null
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(left.key || '').localeCompare(String(right.key || '')))

  if (maxItems <= 0) return normalized
  return normalized.slice(0, maxItems)
}

function resolveGeminiModelGroup (value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'other'
  if (normalized.includes('flash')) return 'flash'
  if (normalized.includes('pro')) return 'pro'
  return 'other'
}

function getGeminiModelGroupLabel (groupKey) {
  switch (groupKey) {
    case 'pro': return 'Pro'
    case 'flash': return 'Flash'
    default: return '其他'
  }
}

function buildGeminiGroupedItems (models) {
  const orderedGroupKeys = ['pro', 'flash', 'other']
  const grouped = new Map()

  for (const item of models) {
    const groupKey = resolveGeminiModelGroup(item.key)
    if (!grouped.has(groupKey)) grouped.set(groupKey, [])
    grouped.get(groupKey).push(item)
  }

  return orderedGroupKeys
    .map((groupKey) => {
      const items = grouped.get(groupKey) || []
      if (items.length === 0) return null

      const percentageValues = items
        .map((item) => Number(item.percentage))
        .filter((value) => Number.isFinite(value))
      const resetCandidates = items
        .map((item) => Number(item.resetTime))
        .filter((value) => Number.isFinite(value) && value > 0)

      return {
        key: groupKey,
        label: getGeminiModelGroupLabel(groupKey),
        percentage: percentageValues.length > 0 ? Math.min(...percentageValues) : 0,
        resetTime: resetCandidates.length > 0 ? Math.min(...resetCandidates) : 0,
        items
      }
    })
    .filter(Boolean)
}

function legacyQuotaItems (quota) {
  const items = []
  if (!quota || typeof quota !== 'object') return items

  if (typeof quota.hourly_percentage === 'number') {
    items.push({
      key: 'hourly',
      label: '5小时',
      percentage: quota.hourly_percentage,
      resetTime: toUnixSeconds(quota.hourly_reset_time),
      requestsLeft: quota.hourly_requests_left,
      requestsLimit: quota.hourly_requests_limit
    })
  }

  if (typeof quota.weekly_percentage === 'number') {
    items.push({
      key: 'weekly',
      label: '每周',
      percentage: quota.weekly_percentage,
      resetTime: toUnixSeconds(quota.weekly_reset_time),
      requestsLeft: quota.weekly_requests_left,
      requestsLimit: quota.weekly_requests_limit
    })
  }

  const crPercentage = typeof quota.code_review_percentage === 'number'
    ? quota.code_review_percentage
    : (typeof quota.weekly_percentage === 'number' ? quota.weekly_percentage : null)
  const crResetTime = quota.code_review_reset_time || quota.weekly_reset_time || ''
  const crRequestsLeft = typeof quota.code_review_requests_left === 'number'
    ? quota.code_review_requests_left
    : quota.weekly_requests_left
  const crRequestsLimit = typeof quota.code_review_requests_limit === 'number'
    ? quota.code_review_requests_limit
    : quota.weekly_requests_limit

  if (crPercentage !== null) {
    items.push({
      key: 'code-review',
      label: '代码审查',
      percentage: crPercentage,
      resetTime: toUnixSeconds(crResetTime),
      requestsLeft: crRequestsLeft,
      requestsLimit: crRequestsLimit
    })
  }

  return items
}

export function getGeminiQuotaDisplayItems (quota) {
  const models = normalizeModelItems(quota)
  if (models.length > 0) return models
  return legacyQuotaItems(quota)
}

export function getGeminiQuotaDisplayGroups (quota) {
  const models = normalizeModelItems(quota)
  if (models.length === 0) return []
  return buildGeminiGroupedItems(models)
}

export function readGeminiAdvancedSettings () {
  return normalizeGeminiAdvancedSettings(readSharedSetting(GEMINI_SETTINGS_KEY, null))
}

export function normalizeGeminiAdvancedSettings (s) {
  const d = {
    autoRefreshMinutes: 0,
    oauthClientId: '',
    oauthClientSecret: '',
    quotaWarningEnabled: false,
    quotaWarningProThreshold: 10,
    quotaWarningFlashThreshold: 10
  }
  if (!s || typeof s !== 'object') return d
  return {
    autoRefreshMinutes: normalizeRefreshIntervalMinutes(s.autoRefreshMinutes, d.autoRefreshMinutes),
    oauthClientId: typeof s.oauthClientId === 'string' ? s.oauthClientId.trim() : d.oauthClientId,
    oauthClientSecret: typeof s.oauthClientSecret === 'string' ? s.oauthClientSecret.trim() : d.oauthClientSecret,
    quotaWarningEnabled: s.quotaWarningEnabled === true,
    quotaWarningProThreshold: Math.max(0, Math.min(QUOTA_WARNING_THRESHOLD_MAX, Number(s.quotaWarningProThreshold) || 0)),
    quotaWarningFlashThreshold: Math.max(0, Math.min(QUOTA_WARNING_THRESHOLD_MAX, Number(s.quotaWarningFlashThreshold) || 0))
  }
}
