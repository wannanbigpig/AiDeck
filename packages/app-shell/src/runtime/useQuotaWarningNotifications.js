import { useEffect, useRef } from 'react'
import { getPlatformService, readHostSetting, showNotification, writeHostSetting } from '../utils/hostBridge.js'
import { getAntigravityQuotaDisplayItems, readAntigravityAdvancedSettings } from '../utils/antigravity.js'
import { getGeminiQuotaDisplayGroups, readGeminiAdvancedSettings } from '../utils/gemini.js'
import { readCodexAdvancedSettings } from '../utils/codex.js'

export const QUOTA_WARNING_STATE_KEY = 'aideck:quota-warning-state'

const PLATFORM_IDS = ['antigravity', 'codex', 'gemini']
const PLATFORM_TITLES = {
  antigravity: 'Antigravity 配额预警',
  codex: 'Codex 配额预警',
  gemini: 'Gemini CLI 配额预警'
}
const FEATURE_CODES = {
  antigravity: 'AiDeck-antigravity',
  codex: 'AiDeck-codex',
  gemini: 'AiDeck-gemini'
}

function clampThreshold (value) {
  return Math.max(0, Math.min(30, Number(value) || 0))
}

function buildEmptyPlatformState () {
  return {}
}

function normalizePlatformMetricState (raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const next = {}
  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object') continue
    next[key] = {
      accountId: String(value.accountId || '').trim(),
      threshold: clampThreshold(value.threshold),
      active: value.active === true
    }
  }
  return next
}

export function normalizeQuotaWarningState (raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    antigravity: normalizePlatformMetricState(source.antigravity),
    codex: normalizePlatformMetricState(source.codex),
    gemini: normalizePlatformMetricState(source.gemini)
  }
}

function getAccountDisplayName (account) {
  const source = account && typeof account === 'object' ? account : {}
  return String(source.email || source.name || source.id || '当前账号').trim() || '当前账号'
}

function toPercentage (value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function buildCodexWarningItems (account, settings) {
  const quota = account && account.quota && typeof account.quota === 'object' ? account.quota : {}
  const items = []
  const hourly = toPercentage(quota.hourly_percentage)
  const weekly = toPercentage(quota.weekly_percentage)

  if (hourly !== null) {
    items.push({
      key: 'hourly',
      label: '5小时配额',
      percentage: hourly,
      threshold: clampThreshold(settings.quotaWarningHourlyThreshold)
    })
  }
  if (weekly !== null) {
    items.push({
      key: 'weekly',
      label: '周配额',
      percentage: weekly,
      threshold: clampThreshold(settings.quotaWarningWeeklyThreshold)
    })
  }

  return items
}

function buildGeminiWarningItems (account, settings) {
  const groups = getGeminiQuotaDisplayGroups(account && account.quota)
  const items = []

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    if (!group || (group.key !== 'pro' && group.key !== 'flash')) continue
    items.push({
      key: group.key,
      label: `${group.label} 分组`,
      percentage: toPercentage(group.percentage),
      threshold: clampThreshold(group.key === 'pro' ? settings.quotaWarningProThreshold : settings.quotaWarningFlashThreshold)
    })
  }

  return items.filter(item => item.percentage !== null)
}

function buildAntigravityWarningItems (account, settings) {
  const items = getAntigravityQuotaDisplayItems(account && account.quota, { aggregated: true })
  const thresholdMap = {
    claude: clampThreshold(settings.quotaWarningClaudeThreshold),
    gemini_pro: clampThreshold(settings.quotaWarningGeminiProThreshold),
    gemini_flash: clampThreshold(settings.quotaWarningGeminiFlashThreshold)
  }

  return items
    .filter(item => item && Object.prototype.hasOwnProperty.call(thresholdMap, item.key))
    .map(item => ({
      key: item.key,
      label: item.label,
      percentage: toPercentage(item.percentage),
      threshold: thresholdMap[item.key]
    }))
    .filter(item => item.percentage !== null)
}

export function buildQuotaWarningItems (platform, account, settings) {
  if (!settings || settings.quotaWarningEnabled !== true || !account || !account.id) return []
  switch (platform) {
    case 'antigravity':
      return buildAntigravityWarningItems(account, settings)
    case 'codex':
      return buildCodexWarningItems(account, settings)
    case 'gemini':
      return buildGeminiWarningItems(account, settings)
    default:
      return []
  }
}

function buildNotificationPayload (platform, account, items) {
  const displayName = getAccountDisplayName(account)
  const parts = items.map(item => `${item.label} ${item.percentage}%（阈值 ${item.threshold}%）`)
  return {
    title: PLATFORM_TITLES[platform] || 'AiDeck 配额预警',
    message: `当前账号 ${displayName} 的 ${parts.join('、')} 已触发配额预警`,
    navigateTo: platform,
    featureCode: FEATURE_CODES[platform] || ''
  }
}

export function evaluateQuotaWarningPlatform ({ platform, account, settings, previousState, skipNotify = false }) {
  const prev = normalizePlatformMetricState(previousState)
  const nextState = buildEmptyPlatformState()
  const items = buildQuotaWarningItems(platform, account, settings)

  if (!account || !account.id || items.length === 0) {
    return { nextState, notification: null }
  }

  const triggered = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const active = item.percentage <= item.threshold
    const prevMetric = prev[item.key] || null

    nextState[item.key] = {
      accountId: String(account.id || '').trim(),
      threshold: item.threshold,
      active
    }

    const alreadyActiveForSameAccount = Boolean(
      prevMetric &&
      prevMetric.active === true &&
      prevMetric.accountId === nextState[item.key].accountId &&
      prevMetric.threshold === item.threshold
    )

    if (active && !alreadyActiveForSameAccount) {
      triggered.push(item)
    }
  }

  return {
    nextState,
    notification: skipNotify || triggered.length === 0 ? null : buildNotificationPayload(platform, account, triggered)
  }
}

function getPlatformSettings (platform) {
  switch (platform) {
    case 'antigravity': return readAntigravityAdvancedSettings()
    case 'codex': return readCodexAdvancedSettings()
    case 'gemini': return readGeminiAdvancedSettings()
    default: return null
  }
}

function resolveCurrentAccount (platform, platformState) {
  const state = platformState && typeof platformState === 'object' ? platformState : {}
  const accounts = Array.isArray(state.accounts) ? state.accounts : []
  const svc = getPlatformService(platform)
  const currentFromService = svc && typeof svc.getCurrent === 'function' ? svc.getCurrent() : null
  const currentId = String(currentFromService?.id || state.currentId || '').trim()
  if (!currentId) return null
  const fromSnapshot = accounts.find(account => String(account?.id || '').trim() === currentId)
  return fromSnapshot || currentFromService || null
}

export function useQuotaWarningNotifications (platformData) {
  const initializedRef = useRef(false)
  const lastSerializedRef = useRef('')

  useEffect(() => {
    const previousState = normalizeQuotaWarningState(readHostSetting(QUOTA_WARNING_STATE_KEY, null))
    const nextState = normalizeQuotaWarningState(null)
    const notifications = []

    for (let i = 0; i < PLATFORM_IDS.length; i++) {
      const platform = PLATFORM_IDS[i]
      const account = resolveCurrentAccount(platform, platformData?.[platform])
      const settings = getPlatformSettings(platform)
      const result = evaluateQuotaWarningPlatform({
        platform,
        account,
        settings,
        previousState: previousState[platform],
        skipNotify: !initializedRef.current
      })
      nextState[platform] = result.nextState
      if (result.notification) {
        notifications.push(result.notification)
      }
    }

    const serialized = JSON.stringify(nextState)
    if (serialized !== lastSerializedRef.current) {
      writeHostSetting(QUOTA_WARNING_STATE_KEY, nextState)
      lastSerializedRef.current = serialized
    }

    if (!initializedRef.current) {
      initializedRef.current = true
      return
    }

    for (let i = 0; i < notifications.length; i++) {
      void showNotification(notifications[i])
    }
  }, [
    platformData?.antigravity?.accounts,
    platformData?.antigravity?.currentId,
    platformData?.codex?.accounts,
    platformData?.codex?.currentId,
    platformData?.gemini?.accounts,
    platformData?.gemini?.currentId
  ])
}
