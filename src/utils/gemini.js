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

function normalizeModelItems (quota) {
  if (!quota || typeof quota !== 'object') return []

  let models = []
  if (Array.isArray(quota.models)) {
    models = quota.models
  } else if (quota.models && typeof quota.models === 'object') {
    models = Object.entries(quota.models).map(([name, info]) => {
      const item = info && typeof info === 'object' ? info : {}
      return Object.assign({ name }, item)
    })
  }

  return models
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
    .slice(0, 6)
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

export function readGeminiAdvancedSettings () {
  try {
    if (window.utools) {
      return window.utools.dbStorage.getItem('gemini_advanced_settings') || { autoRefreshMinutes: 0 }
    } else {
      const raw = localStorage.getItem('gemini_advanced_settings')
      return raw ? JSON.parse(raw) : { autoRefreshMinutes: 0 }
    }
  } catch (e) {
    return { autoRefreshMinutes: 0 }
  }
}

export function normalizeGeminiAdvancedSettings (s) {
  const d = {
    autoRefreshMinutes: 0
  }
  if (!s || typeof s !== 'object') return d
  return {
    autoRefreshMinutes: typeof s.autoRefreshMinutes === 'number' ? s.autoRefreshMinutes : d.autoRefreshMinutes
  }
}
