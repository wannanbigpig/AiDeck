const QUOTA_STALE_WARN_MS = 6 * 60 * 60 * 1000
const QUOTA_STALE_HEAVY_MS = 24 * 60 * 60 * 1000
const RECENTLY_USED_MS = 10 * 60 * 1000

function normalizeEmail (value) {
  return String(value || '').trim().toLowerCase()
}

function normalizePercentage (value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeTimestampMs (value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return numeric < 1000000000000 ? numeric * 1000 : numeric
}

function getQuotaUpdatedAtMs (account) {
  const quota = account && account.quota && typeof account.quota === 'object' ? account.quota : {}
  return normalizeTimestampMs(quota.updated_at || account.updated_at)
}

function hasBlockingAccountIssue (account) {
  const quota = account && account.quota && typeof account.quota === 'object' ? account.quota : {}
  return Boolean(
    !account ||
    account.invalid ||
    quota.invalid ||
    quota.error ||
    (account.quota_error && account.quota_error.message)
  )
}

function getFreshnessScore (account, nowMs) {
  const updatedAt = getQuotaUpdatedAtMs(account)
  if (!updatedAt) return -30
  const age = Math.max(0, nowMs - updatedAt)
  if (age >= QUOTA_STALE_HEAVY_MS) return -80
  if (age >= QUOTA_STALE_WARN_MS) return -30
  return 0
}

function getRecentlyUsedPenalty (account, nowMs) {
  const lastUsed = normalizeTimestampMs(account && account.last_used)
  if (!lastUsed || nowMs - lastUsed >= RECENTLY_USED_MS) return 0
  return -20
}

function getAdditionalQuotaScore (quota) {
  const limits = Array.isArray(quota && quota.additional_rate_limits) ? quota.additional_rate_limits : []
  const values = []
  for (let i = 0; i < limits.length; i++) {
    const limit = limits[i] || {}
    const hourly = normalizePercentage(limit.hourly_percentage)
    const weekly = normalizePercentage(limit.weekly_percentage)
    if (hourly !== null) values.push(hourly)
    if (weekly !== null) values.push(weekly)
  }
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length / 4
}

export function rankCodexAutoSwitchCandidates (options = {}) {
  const accounts = Array.isArray(options.accounts) ? options.accounts : []
  const current = options.current && typeof options.current === 'object' ? options.current : {}
  const settings = options.settings && typeof options.settings === 'object' ? options.settings : {}
  const nowMs = Number(options.nowMs || Date.now())
  const hourlyThreshold = Number(options.hourlyThreshold)
  const weeklyThreshold = Number(options.weeklyThreshold)
  const hitHourly = options.hitHourly === true
  const hitWeekly = options.hitWeekly === true
  const currentEmail = normalizeEmail(current.email)

  return accounts
    .filter(account => account && account.id && account.id !== current.id)
    .filter(account => account.quota && !hasBlockingAccountIssue(account))
    .map(account => {
      const quota = account.quota || {}
      const hourly = normalizePercentage(quota.hourly_percentage)
      const weekly = normalizePercentage(quota.weekly_percentage)
      if (hitHourly && (hourly === null || hourly <= hourlyThreshold)) return null
      if (hitWeekly && (weekly === null || weekly <= weeklyThreshold)) return null

      const sameEmailBonus = settings.autoSwitchPreferSameEmail && normalizeEmail(account.email) && normalizeEmail(account.email) === currentEmail ? 35 : 0
      const quotaScore = (hourly === null ? 0 : hourly) + (weekly === null ? 0 : weekly) + getAdditionalQuotaScore(quota)
      const score = quotaScore + sameEmailBonus + getFreshnessScore(account, nowMs) + getRecentlyUsedPenalty(account, nowMs)

      return { account, score }
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
}

export function rankAntigravityAutoSwitchCandidates (options = {}) {
  const accounts = Array.isArray(options.accounts) ? options.accounts : []
  const current = options.current && typeof options.current === 'object' ? options.current : {}
  const watchGroups = Array.isArray(options.watchGroups) ? options.watchGroups : []
  const triggeredGroups = Array.isArray(options.triggeredGroups) ? options.triggeredGroups : []
  const getQuotaPercentageMap = typeof options.getQuotaPercentageMap === 'function' ? options.getQuotaPercentageMap : () => ({})
  const resolveCandidateScore = typeof options.resolveCandidateScore === 'function' ? options.resolveCandidateScore : () => -1
  const threshold = Number(options.threshold)
  const nowMs = Number(options.nowMs || Date.now())

  return accounts
    .filter(account => account && account.id && account.id !== current.id)
    .filter(account => !hasBlockingAccountIssue(account))
    .map(account => {
      const percentageMap = getQuotaPercentageMap(account)
      const hasEnoughForTriggeredGroups = triggeredGroups.every(group => {
        const value = Number(percentageMap[group])
        return Number.isFinite(value) && value > threshold
      })
      if (!hasEnoughForTriggeredGroups) return null
      const quotaScore = resolveCandidateScore(percentageMap, watchGroups)
      if (quotaScore < 0) return null
      return {
        account,
        score: quotaScore + getFreshnessScore(account, nowMs) + getRecentlyUsedPenalty(account, nowMs)
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
}
