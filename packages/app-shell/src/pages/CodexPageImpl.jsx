import { useEffect, useRef, useState } from 'react'
import Modal, { ConfirmModal } from '../components/Modal'
import ExportJsonModal from '../components/ExportJsonModal'
import { useToast } from '../components/Toast'
import { useGlobalNotice } from '../components/GlobalNotice'
import { PlatformIcon } from '../components/Icons/PlatformIcons'
import PrivacyToggleButton from '../components/PrivacyToggleButton'
import LocalPendingCard from '../components/LocalPendingCard'
import UsageGuide from '../components/UsageGuide'
import {
  RefreshIcon,
  TagIcon,
  PlusIcon,
  UploadIcon,
  SettingsIcon,
  FolderIcon
} from '../components/Icons/ActionIcons'
import CodexSettingsModal from './codex/CodexSettingsModal'
import CodexAccountItem from './codex/CodexAccountItem'
import CodexAddAccountModal from './codex/CodexAddAccountModal'
import CodexSessionManager from './codex/CodexSessionManager'
import CodexTagModals from './codex/CodexTagModals'
import { useCodexOAuthFlow } from './codex/useCodexOAuthFlow'
import { logRequestEvent } from '../utils/requestLogClient'
import { copyText, getCommandStatus, readSharedSetting, writeSharedSetting } from '../utils/hostBridge.js'
import { usePlatformSnapshot } from '../runtime/usePlatformSnapshot.js'
import { usePlatformActions } from '../runtime/usePlatformActions.js'
import { usePlatformAutoRefresh } from '../runtime/usePlatformAutoRefresh.js'
import { runPlatformBatchRefresh } from '../runtime/runPlatformBatchRefresh.js'
import { usePlatformAddFlow } from '../runtime/usePlatformAddFlow.js'
import { useSelectionSet } from '../runtime/useSelectionSet.js'
import { usePlatformSearch } from '../runtime/usePlatformSearch.js'
import { useBatchTagEditor } from '../runtime/useBatchTagEditor.js'
import { usePlatformExportDialog } from '../runtime/usePlatformExportDialog.js'
import { launchPlatformCli } from '../runtime/launchPlatformCli.js'
import {
  resolveQuotaErrorMeta,
  shouldOfferReauthorizeAction,
  normalizeCodexAdvancedSettings,
  readCodexAdvancedSettings
} from '../utils/codex'

const CODEX_JSON_IMPORT_REQUIRED_TEXT = '必填字段：tokens.access_token 或 tokens.refresh_token 至少一个（也支持顶层 access_token / refresh_token）。建议补充 id、email、tokens.id_token、tokens.access_token、tokens.refresh_token、created_at、last_used。'
const CODEX_QUOTA_SCHEMA_VERSION = 2
const CODEX_WAKEUP_CUSTOM_MODEL_VALUE = '__custom__'
const CODEX_WAKEUP_MODEL_OPTIONS = [
  { value: '', label: 'CLI 默认' },
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
  { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark', proOnly: true },
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: CODEX_WAKEUP_CUSTOM_MODEL_VALUE, label: '自定义模型' }
]
const CODEX_WAKEUP_MINI_MODELS = new Set(['gpt-5.4-mini', 'gpt-5.1-codex-mini'])
const CODEX_WAKEUP_REASONING_OPTIONS = [
  { value: '', label: 'CLI 默认' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' }
]
const CODEX_WAKEUP_MINI_REASONING_OPTIONS = [
  { value: 'low', label: 'low' }
]
const CODEX_ACTIVE_VIEW_KEY = 'codex_active_view'
const CODEX_WAKEUP_SCHEDULE_OPTIONS = [
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每周' },
  { value: 'interval', label: '间隔' },
  { value: 'quota_reset', label: '配额重置' },
  { value: 'startup', label: '启动后' }
]
const CODEX_WAKEUP_WEEKDAY_OPTIONS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' }
]
const CODEX_WAKEUP_QUOTA_RESET_WINDOW_OPTIONS = [
  { value: 'either', label: '任意窗口' },
  { value: 'primary_window', label: '5 小时窗口' },
  { value: 'secondary_window', label: '每周窗口' }
]

function normalizeCodexActiveView (value) {
  return value === 'sessions' ? 'sessions' : 'accounts'
}

function readCodexActiveView () {
  return normalizeCodexActiveView(readSharedSetting(CODEX_ACTIVE_VIEW_KEY, 'accounts'))
}

function writeCodexActiveView (value) {
  const next = normalizeCodexActiveView(value)
  writeSharedSetting(CODEX_ACTIVE_VIEW_KEY, next)
  return next
}

function waitForNextPaint () {
  return new Promise(resolve => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0))
      return
    }
    setTimeout(resolve, 0)
  })
}

function formatWakeupDateTime (value) {
  const timestamp = Number(value || 0)
  if (!timestamp) return '-'
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return '-'
  }
}

function formatWakeupDuration (value) {
  const ms = Number(value || 0)
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function resolveWakeupLatestSummary (item, singleAccount = false) {
  if (!item) return '暂无结果'
  if (item.status === 'running') return '唤醒中'
  const successCount = Number(item.success_count || 0)
  const failureCount = Number(item.failure_count || 0)
  if (singleAccount) return successCount > 0 && failureCount === 0 ? '成功' : '失败'
  if (successCount > 0 && failureCount === 0) return `成功 ${successCount} 个账号`
  if (successCount > 0) return `成功 ${successCount}，失败 ${failureCount}`
  if (failureCount > 0) return `失败 ${failureCount} 个账号`
  return item.status === 'success' ? '成功' : '失败'
}

function normalizeWakeupModelValue (value) {
  return String(value || '').trim()
}

function isWakeupProAccount (account) {
  if (!account || typeof account !== 'object') return false
  const values = [
    account.plan_type,
    account.plan_name,
    account.tier_id,
    account.subscription_tier
  ]
  return values.some(value => String(value || '').trim().toUpperCase().includes('PRO'))
}

function getWakeupModelOptionsForAccount (account) {
  const allowProOnly = isWakeupProAccount(account)
  return CODEX_WAKEUP_MODEL_OPTIONS.filter(option => !option.proOnly || allowProOnly)
}

function isWakeupPresetModel (value, options = CODEX_WAKEUP_MODEL_OPTIONS) {
  const model = normalizeWakeupModelValue(value)
  return options.some(option => option.value === model && option.value !== CODEX_WAKEUP_CUSTOM_MODEL_VALUE)
}

function resolveWakeupModelSelectValue (value, customMode = false, options = CODEX_WAKEUP_MODEL_OPTIONS) {
  const model = normalizeWakeupModelValue(value)
  if (customMode) return CODEX_WAKEUP_CUSTOM_MODEL_VALUE
  if (!model) return ''
  return isWakeupPresetModel(model, options) ? model : CODEX_WAKEUP_CUSTOM_MODEL_VALUE
}

function isWakeupMiniModel (model) {
  return CODEX_WAKEUP_MINI_MODELS.has(normalizeWakeupModelValue(model).toLowerCase())
}

function getWakeupReasoningOptions (model) {
  return isWakeupMiniModel(model)
    ? CODEX_WAKEUP_MINI_REASONING_OPTIONS
    : CODEX_WAKEUP_REASONING_OPTIONS
}

function normalizeWakeupReasoningForModel (model, reasoningEffort) {
  const value = String(reasoningEffort || '').trim()
  const options = getWakeupReasoningOptions(model)
  if (options.some(option => option.value === value)) return value
  return isWakeupMiniModel(model) ? 'low' : ''
}

function normalizeWakeupScheduleKind (value) {
  const text = String(value || '').trim()
  return CODEX_WAKEUP_SCHEDULE_OPTIONS.some(option => option.value === text) ? text : 'daily'
}

function normalizeWakeupWeeklyDays (value) {
  const raw = Array.isArray(value) ? value : []
  const days = Array.from(new Set(raw.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)))
  return days.length > 0 ? days : [1]
}

const CODEX_JSON_IMPORT_EXAMPLE = `[
  {
    "id": "codex_4e9dc33f32e0f5948b0123",
    "email": "user@example.com",
    "user_id": "user-KqKmzaSeh95hzxnwGqAA6Unm",
    "plan_type": "TEAM",
    "account_id": "c8492cc2-dcc1-4ad3-89ba-f9c4059e5b01",
    "organization_id": "org_1234567890abcdef",
    "account_name": "MyTeam",
    "account_structure": "workspace",
    "workspace": "dmnrxvujvnmj",
    "tokens": {
      "id_token": "eyJhbGciOi...",
      "access_token": "eyJhbGciOi...",
      "refresh_token": "rt-xxxx"
    },
    "tags": ["主力"],
    "created_at": 1770000000000,
    "last_used": 1770003600000
  }
]`

/**
 * Codex 账号管理页
 */
export default function Codex ({ onActivity, searchQuery = '', onViewChange }) {
  const initialSettingsRef = useRef(null)
  if (!initialSettingsRef.current) {
    initialSettingsRef.current = readCodexAdvancedSettings()
  }
  const [showImport, setShowImport] = useState(false)
  const [addTab, setAddTab] = useState('oauth')
  const [importJson, setImportJson] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [loading, setLoading] = useState(false)
  const [importingLocal, setImportingLocal] = useState(false)
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)
  const [activeView, setActiveView] = useState(() => readCodexActiveView())
  const [showWakeupTask, setShowWakeupTask] = useState(false)
  const [wakeupRunning, setWakeupRunning] = useState(false)
  const [wakeupSaving, setWakeupSaving] = useState(false)
  const [wakeupAccount, setWakeupAccount] = useState(null)
  const [cliLaunchChoiceAccount, setCliLaunchChoiceAccount] = useState(null)
  const [wakeupResult, setWakeupResult] = useState(null)
  const [wakeupOverview, setWakeupOverview] = useState(null)
  const [wakeupRunId, setWakeupRunId] = useState('')
  const [wakeupCustomModelMode, setWakeupCustomModelMode] = useState(false)
  const [wakeupForm, setWakeupForm] = useState({
    enabled: false,
    scheduleKind: 'daily',
    dailyTime: '09:00',
    weeklyDays: [1],
    weeklyTime: '09:00',
    intervalHours: '4',
    quotaResetWindow: 'either',
    startupDelayMinutes: '0',
    prompt: 'hi',
    model: 'gpt-5.3-codex',
    reasoningEffort: 'medium',
    lastMessage: ''
  })
  const [advancedSettings, setAdvancedSettings] = useState(() => initialSettingsRef.current)
  const [tagEditor, setTagEditor] = useState({ id: '', value: '' })
  const [localImportHint, setLocalImportHint] = useState({ visible: false, email: '' })
  const quotaSchemaRefreshRef = useRef(false)
  const toast = useToast()
  const notice = useGlobalNotice()
  const platformSnapshot = usePlatformSnapshot('codex', {
    watchLocalState: true,
    watchStorageRevision: true,
    syncCurrentFromLocal: true,
    autoImport: false,
    onAfterSync: refreshLocalImportHint
  })
  const { svc, accounts, currentId, setAccounts, setCurrentId, refreshSnapshot } = platformSnapshot
  const quotaActions = usePlatformActions()
  const { selectedIds, selectedCount, toggleSelection } = useSelectionSet(accounts, { getId: (account) => account && account.id })
  const {
    batchTagEditor,
    openBatchTagEditor,
    closeBatchTagEditor,
    setBatchTagValue
  } = useBatchTagEditor()
  const {
    exportDialog,
    openExportDialog,
    closeExportDialog,
    copyExportJson,
    downloadExportJson
  } = usePlatformExportDialog({
    copyText,
    toast,
    filenamePrefix: 'codex-accounts'
  })
  const oauthFlow = useCodexOAuthFlow({
    svc,
    toast,
    onRecovered: () => {
      setShowImport(true)
      setAddTab('oauth')
    },
    onCompleted: (account, result) => {
      toast.success(`OAuth 授权成功: ${account.email || account.id}`)
      if (result?.quotaRefreshError) {
        toast.warning(`账号已添加，但首次刷新配额失败: ${result.quotaRefreshError}`)
      }
      onActivity?.(`OAuth 添加账号 -> ${account.email || account.id}`)
      closeAddModal()
      refresh()
    }
  })
  const {
    oauthSessionId,
    oauthAuthUrl,
    oauthRedirectUri,
    oauthCallbackInput,
    oauthPreparing,
    oauthBusy,
    oauthPrepareError,
    oauthUrlCopied,
    oauthRecovered,
    oauthPolling,
    setOauthCallbackInput,
    prepareOAuthSession,
    handleCopyOAuthUrl,
    handleOpenOAuthInBrowser,
    handleCancelOAuthInBrowser,
    handleSubmitOAuthCallback,
    ensureOAuthReady,
    resetOAuthFlow
  } = oauthFlow

  usePlatformAutoRefresh({
    platform: 'codex',
    svc,
    accounts,
    refreshSnapshot,
    autoRefreshMinutes: advancedSettings.autoRefreshMinutes,
    onRefreshAll: refreshAllQuotas
  })

  const {
    handleSwitchAddTab,
    openAddModal,
    closeAddModal
  } = usePlatformAddFlow({
    setOpen: setShowImport,
    setTab: setAddTab,
    resetForm: resetAddForm,
    ensureOAuthReady,
    resetOAuth: resetAddFlowState
  })

  async function refreshLocalImportHint () {
    if (!svc || typeof svc.getLocalImportStatus !== 'function') {
      setLocalImportHint({ visible: false, email: '' })
      return
    }
    try {
      const status = await Promise.resolve(svc.getLocalImportStatus())
      const visible = !!(status && status.success && status.hasLocalState && !status.imported)
      if (!visible) {
        setLocalImportHint({ visible: false, email: '' })
        return
      }
      const email = String((status && status.email) || '').trim()
      setLocalImportHint({
        visible: true,
        email: email || '本地账号'
      })
    } catch (e) {
      setLocalImportHint({ visible: false, email: '' })
    }
  }

  useEffect(() => {
    setAdvancedSettings(readCodexAdvancedSettings())
  }, [])

  useEffect(() => {
    onViewChange?.(activeView)
  }, [activeView, onViewChange])

  useEffect(() => {
    if (!svc || quotaSchemaRefreshRef.current || accounts.length === 0 || quotaActions.batchRunning) return
    const hasLegacyQuota = accounts.some(account => {
      const quota = account && account.quota && typeof account.quota === 'object' ? account.quota : null
      if (!quota) return false
      return Number(quota.schema_version || 0) < CODEX_QUOTA_SCHEMA_VERSION
    })
    if (!hasLegacyQuota) return
    quotaSchemaRefreshRef.current = true
    void refreshAllQuotas({ silent: true, source: 'quota-schema-upgrade' })
  }, [accounts, quotaActions.batchRunning, svc])

  function refresh () {
    if (!svc) return
    refreshSnapshot()
    void refreshLocalImportHint()
  }

  function resetAddForm () {
    setImportJson('')
  }

  function resetAddFlowState () {
    resetOAuthFlow()
    resetAddForm()
  }

  function applyImportedAccounts (items) {
    const imported = Array.isArray(items)
      ? items.filter(account => account && account.id)
      : (items && items.id ? [items] : [])
    if (imported.length === 0) return
    setAccounts(prev => {
      const map = new Map((Array.isArray(prev) ? prev : []).map(account => [account.id, account]))
      for (const account of imported) {
        const existing = map.get(account.id)
        map.set(account.id, existing ? Object.assign({}, existing, account) : account)
      }
      return Array.from(map.values())
    })
    setCurrentId(imported[0].id)
  }

  async function maybeAutoSwitchAfterQuotaRefresh (source = 'manual') {
    if (!svc) return false
    const settings = readCodexAdvancedSettings()
    setAdvancedSettings(settings)
    if (!settings.autoSwitch) return false

    const current = svc.getCurrent()
    if (!current || !current.id) return false

    const allAccounts = svc.list() || []
    const currentAccount = allAccounts.find(a => a.id === current.id)
    const currentQuota = currentAccount?.quota || {}
    const hourlyThreshold = Number(settings.autoSwitchHourlyThreshold)
    const weeklyThreshold = Number(settings.autoSwitchWeeklyThreshold)

    const currentHourly = typeof currentQuota.hourly_percentage === 'number' ? currentQuota.hourly_percentage : null
    const currentWeekly = typeof currentQuota.weekly_percentage === 'number' ? currentQuota.weekly_percentage : null

    const hitHourly = currentHourly !== null && currentHourly <= hourlyThreshold
    const hitWeekly = currentWeekly !== null && currentWeekly <= weeklyThreshold

    if (!hitHourly && !hitWeekly) return false

    const candidates = allAccounts
      .filter(acc => acc.id !== current.id && acc.quota)
      .filter(acc => {
        const q = acc.quota || {}
        if (hitHourly) {
          if (typeof q.hourly_percentage !== 'number' || q.hourly_percentage <= hourlyThreshold) return false
        }
        if (hitWeekly) {
          if (typeof q.weekly_percentage !== 'number' || q.weekly_percentage <= weeklyThreshold) return false
        }
        return true
      })
      .sort((left, right) => {
        const lq = left.quota || {}
        const rq = right.quota || {}
        const leftSameEmail = settings.autoSwitchPreferSameEmail && left.email && current.email && left.email === current.email ? 1 : 0
        const rightSameEmail = settings.autoSwitchPreferSameEmail && right.email && current.email && right.email === current.email ? 1 : 0
        if (rightSameEmail !== leftSameEmail) return rightSameEmail - leftSameEmail

        const leftScore = (typeof lq.hourly_percentage === 'number' ? lq.hourly_percentage : -1) +
          (typeof lq.weekly_percentage === 'number' ? lq.weekly_percentage : -1)
        const rightScore = (typeof rq.hourly_percentage === 'number' ? rq.hourly_percentage : -1) +
          (typeof rq.weekly_percentage === 'number' ? rq.weekly_percentage : -1)
        return rightScore - leftScore
      })

    const next = candidates[0]
    if (!next) {
      logRequestEvent('codex.auto-switch', '自动切号未找到可用候选账号', {
        source,
        current: current.email || current.id,
        hitHourly,
        hitWeekly
      })
      return false
    }

    const switchResult = await Promise.resolve(svc.activateAccount(next.id, settings))
    if (!switchResult.success) {
      logRequestEvent('codex.auto-switch', '自动切号失败', {
        source,
        current: current.email || current.id,
        next: next.email || next.id,
        error: switchResult.error || '未知错误'
      }, 'warn')
      toast.warning('自动切号失败: ' + (switchResult.error || '未知错误'))
      return false
    }

    setCurrentId(next.id)
    refresh()
    toast.success(`自动切号成功：${next.email || next.id}`)
    if (Array.isArray(switchResult.warnings) && switchResult.warnings.length > 0) {
      toast.warning(switchResult.warnings[0])
    }
    onActivity?.(`自动切号(${source}) -> ${next.email || next.id}`)
    logRequestEvent('codex.auto-switch', '自动切号成功', {
      source,
      current: current.email || current.id,
      next: next.email || next.id
    })
    return true
  }

  async function refreshAllQuotas (opts = {}) {
    if (!svc) return
    const { silent = false, source = 'manual' } = opts
    logRequestEvent('codex.batch-refresh', '开始批量刷新配额', {
      source,
      silent,
      total: (svc.list() || []).length
    })
    return await runPlatformBatchRefresh({
      svc,
      quotaActions,
      toast,
      batchId: 'codex-batch-refresh',
      silent,
      setLoading,
      preparingText: '准备开始刷新全量配额...',
      progressText: ({ completed, total }) => `正在刷新配额 (${completed}/${total})...`,
      successText: '刷新全部配额完毕',
      concurrency: 1,
      delayMs: 300,
      refreshAccount: (accountId) => svc.refreshQuotaOrUsage(accountId),
      onCompleted: async ({ total, failures }) => {
        refresh()
        await maybeAutoSwitchAfterQuotaRefresh(source)
        logRequestEvent('codex.batch-refresh', '批量刷新配额完成', {
          source,
          silent,
          total,
          failures: failures.length
        }, failures.length > 0 ? 'warn' : 'info')
      },
      onFailed: (error) => {
        logRequestEvent('codex.batch-refresh', '批量刷新配额异常', {
          source,
          silent,
          error: error?.message || String(error)
        }, 'error')
      }
    })
  }

  async function handleImportLocal (opts = {}) {
    const closeAfter = opts.closeAfter !== false
    if (importingLocal) return
    setImportingLocal(true)
    try {
      const result = await Promise.resolve(svc.importFromLocal())
      if (result.error) {
        toast.error(result.error)
      } else if (result.imported) {
        applyImportedAccounts(result.imported)
        toast.success('成功导入 Codex 账号')
        onActivity?.('本地导入 Codex 账号')
        if (closeAfter) {
          closeAddModal()
        }
        refresh()
      }
    } catch (e) {
      toast.error('导入失败: ' + e.message)
    } finally {
      setImportingLocal(false)
    }
  }

  function handleImportJson () {
    if (!importJson.trim()) {
      toast.warning('请输入 JSON 内容')
      return
    }
    const result = svc.importFromJson(importJson)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`成功导入 ${result.imported.length} 个账号`)
      closeAddModal()
      refresh()
    }
  }

  async function handleActivate (id) {
    const settings = readCodexAdvancedSettings()
    setAdvancedSettings(settings)
    const result = await Promise.resolve(svc.activateAccount(id, settings))
    if (result.success) {
      setCurrentId(id)
      toast.success('已设为当前')
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toast.warning(result.warnings[0])
      }
      refresh()
      return true
    } else {
      toast.error(result.error || '激活失败')
      return false
    }
  }

  function resolveCodexCliLaunchPath (settings) {
    const explicitPath = String(settings?.codexCliPath || '').trim()
    if (explicitPath) return explicitPath
    const status = getCommandStatus('codex')
    if (status && status.available === true) {
      return String(status.path || 'codex').trim() || 'codex'
    }
    return ''
  }

  function warnMissingCodexCliPath () {
    toast.warning('未自动检测到 Codex CLI，请在 Codex 设置中指定 Codex 命令位置')
  }

  async function handleLaunchCli (account, modeOverride = '') {
    const settings = readCodexAdvancedSettings()
    setAdvancedSettings(settings)
    const codexCliPath = resolveCodexCliLaunchPath(settings)
    if (!codexCliPath) {
      warnMissingCodexCliPath()
      return false
    }
    const isCurrentAccount = account && account.id && account.id === currentId
    const requestedMode = modeOverride === 'default' || modeOverride === 'bound' ? modeOverride : 'bound'
    const launchMode = requestedMode === 'default' && isCurrentAccount ? 'default' : 'bound'
    try {
      return await launchPlatformCli({
        platform: 'codex',
        command: 'codex',
        commandPath: codexCliPath,
        account,
        toast,
        notice,
        onActivity,
        refresh,
        activate: launchMode === 'default'
          ? () => ({ success: true, launchMode: 'default' })
          : (target) => typeof svc.prepareCliLaunch === 'function'
            ? svc.prepareCliLaunch(target.id)
            : { success: false, error: '当前环境不支持 Codex CLI 账号绑定实例' }
      })
    } catch (err) {
      toast.error(err?.message || '启动 Codex CLI 失败')
      return false
    }
  }

  function handleLaunchCliRequest (account) {
    const settings = readCodexAdvancedSettings()
    setAdvancedSettings(settings)
    if (!resolveCodexCliLaunchPath(settings)) {
      warnMissingCodexCliPath()
      return false
    }
    if (account && account.id && account.id === currentId) {
      setCliLaunchChoiceAccount(account)
      return true
    }
    return handleLaunchCli(account, 'bound')
  }

  async function handleChooseCliInstanceMode (mode) {
    const account = cliLaunchChoiceAccount
    setCliLaunchChoiceAccount(null)
    if (!account) return false
    return await handleLaunchCli(account, mode)
  }

  function getCliLaunchTip (account) {
    const isCurrentAccount = account && account.id && account.id === currentId
    if (isCurrentAccount) {
      return '选择启动实例并打开 Codex CLI'
    }
    return '以账号绑定实例启动 Codex CLI'
  }

  function handleDelete (id) {
    svc.deleteAccount(id)
    toast.success('已删除')
    setConfirmDelete(null)
    refresh()
  }

  async function handleRefreshQuota (id) {
    if (loading || quotaActions.batchRunning) return
    try {
      const result = await quotaActions.runSingle(id, (accountId) => svc.refreshQuotaOrUsage(accountId))
      if (result && result.error) {
        const meta = resolveQuotaErrorMeta({ message: result.error }, result.error)
        if (shouldOfferReauthorizeAction(meta)) {
          toast.warning('需重新授权，请点击账号卡片底部盾牌图标')
        } else {
          toast.warning(result.error)
        }
      } else if (result && result.message) {
        toast.info(result.message)
      }
      refresh()
      await maybeAutoSwitchAfterQuotaRefresh('single-refresh')
    } catch (e) {
      toast.error('刷新失败: ' + (e?.message || String(e)))
    }
  }

  const handleRefreshAll = async () => {
    await refreshAllQuotas({ silent: false, source: 'manual-all' })
  }

  async function openWakeupTaskModal (account) {
    if (!account || !account.id) return
    setWakeupResult(null)
    setWakeupOverview(null)
    setWakeupRunId('')
    setWakeupAccount(account)
    setWakeupCustomModelMode(false)
    setWakeupForm({
      enabled: false,
      scheduleKind: 'daily',
      dailyTime: '09:00',
      weeklyDays: [1],
      weeklyTime: '09:00',
      intervalHours: '4',
      quotaResetWindow: 'either',
      startupDelayMinutes: '0',
      prompt: 'hi',
      model: 'gpt-5.3-codex',
      reasoningEffort: 'medium',
      lastMessage: ''
    })
    setShowWakeupTask(true)
    if (!svc || typeof svc.getWakeupSchedule !== 'function') return
    try {
      const result = await Promise.resolve(svc.getWakeupSchedule(account.id))
      const schedule = result && result.schedule ? result.schedule : null
      if (schedule) {
        const scheduleModel = normalizeWakeupModelValue(schedule.model || 'gpt-5.3-codex')
        setWakeupCustomModelMode(!!scheduleModel && !isWakeupPresetModel(scheduleModel, getWakeupModelOptionsForAccount(account)))
        setWakeupForm({
          enabled: schedule.enabled === true,
          scheduleKind: normalizeWakeupScheduleKind(schedule.schedule_kind),
          dailyTime: schedule.daily_time || '09:00',
          weeklyDays: normalizeWakeupWeeklyDays(schedule.weekly_days),
          weeklyTime: schedule.weekly_time || schedule.daily_time || '09:00',
          intervalHours: String(schedule.interval_hours || 4),
          quotaResetWindow: schedule.quota_reset_window || 'either',
          startupDelayMinutes: String(schedule.startup_delay_minutes || 0),
          prompt: schedule.prompt || 'hi',
          model: scheduleModel || 'gpt-5.3-codex',
          reasoningEffort: normalizeWakeupReasoningForModel(scheduleModel || 'gpt-5.3-codex', schedule.reasoning_effort || 'medium'),
          lastMessage: schedule.last_message || ''
        })
      }
      if (typeof svc.getWakeupOverview === 'function') {
        const overviewResult = await Promise.resolve(svc.getWakeupOverview(account.id))
        if (overviewResult && overviewResult.success !== false) {
          setWakeupOverview(overviewResult)
          if (overviewResult.running && overviewResult.latest && overviewResult.latest.run_id) {
            setWakeupRunId(overviewResult.latest.run_id)
            setWakeupRunning(true)
          }
        }
      }
    } catch (e) {
      toast.warning('读取唤醒配置失败: ' + (e?.message || String(e)))
    }
  }

  async function handleRunWakeupTask () {
    if (!svc || typeof svc.runWakeupTask !== 'function') {
      toast.error('当前环境不支持 Codex 唤醒任务')
      return
    }
    if (!wakeupAccount || !wakeupAccount.id) {
      toast.warning('请先选择要唤醒的 Codex 账号')
      return
    }
    setWakeupRunning(true)
    setWakeupResult(null)
    const model = normalizeWakeupModelValue(wakeupForm.model)
    const reasoningEffort = normalizeWakeupReasoningForModel(model, wakeupForm.reasoningEffort)
    const optimisticRunId = `codex-wakeup-ui-${Date.now()}`
    setWakeupOverview(prev => Object.assign({}, prev || {}, {
      running: true,
      latest: {
        run_id: optimisticRunId,
        status: 'running',
        trigger_type: 'manual',
        trigger_label: '立即唤醒',
        started_at: Date.now(),
        success_count: 0,
        failure_count: 0,
        records: []
      }
    }))
    await waitForNextPaint()
    let backgroundStarted = false
    try {
      const result = await Promise.resolve(svc.runWakeupTask({
        accountIds: [wakeupAccount.id],
        command: readCodexAdvancedSettings().codexCliPath || 'codex',
        prompt: wakeupForm.prompt,
        model,
        reasoningEffort,
        triggerType: 'manual',
        background: true
      }))
      if (result?.run_id) {
        setWakeupRunId(result.run_id)
        setWakeupOverview(prev => Object.assign({}, prev || {}, {
          running: true,
          latest: Object.assign({}, prev?.latest || {}, {
            run_id: result.run_id,
            status: 'running',
            trigger_type: 'manual',
            trigger_label: '立即唤醒'
          })
        }))
      }
      if (result?.running) {
        backgroundStarted = true
        onActivity?.('Codex 唤醒任务 -> 唤醒中')
        return
      }
      setWakeupResult(result)
      refresh()
      const successCount = Number(result?.success_count || 0)
      const failureCount = Number(result?.failure_count || 0)
      if (successCount > 0 && failureCount === 0) {
        toast.success(`唤醒完成：成功 ${successCount} 个账号`)
      } else if (successCount > 0) {
        toast.warning(`唤醒完成：成功 ${successCount}，失败 ${failureCount}`)
      } else {
        toast.error(result?.error || '唤醒任务失败')
      }
      onActivity?.(`Codex 唤醒任务 -> 成功 ${successCount} / 失败 ${failureCount}`)
    } catch (e) {
      toast.error('唤醒任务失败: ' + (e?.message || String(e)))
      setWakeupOverview(prev => Object.assign({}, prev || {}, {
        running: false,
        latest: Object.assign({}, prev?.latest || {}, {
          status: 'error',
          error: e?.message || String(e),
          finished_at: Date.now()
        })
      }))
      setWakeupRunning(false)
    } finally {
      if (!backgroundStarted) setWakeupRunning(false)
    }
  }

  useEffect(() => {
    if (!showWakeupTask || !wakeupAccount || !wakeupRunId || !svc || typeof svc.getWakeupRun !== 'function') return undefined
    let cancelled = false
    const poll = async () => {
      try {
        const runResult = await Promise.resolve(svc.getWakeupRun(wakeupRunId))
        if (cancelled || !runResult || runResult.success === false || !runResult.item) return
        const item = runResult.item
        setWakeupOverview(prev => Object.assign({}, prev || {}, {
          latest: item,
          running: item.status === 'running'
        }))
        if (item.status !== 'running') {
          setWakeupRunning(false)
          setWakeupRunId('')
          setWakeupResult({
            success: item.status === 'success',
            run_id: item.run_id,
            records: item.records || [],
            success_count: Number(item.success_count || 0),
            failure_count: Number(item.failure_count || 0),
            error: item.error || null
          })
          if (typeof svc.getWakeupOverview === 'function') {
            const overviewResult = await Promise.resolve(svc.getWakeupOverview(wakeupAccount.id))
            if (!cancelled && overviewResult && overviewResult.success !== false) {
              setWakeupOverview(overviewResult)
            }
          }
          refresh()
        }
      } catch {}
    }
    poll()
    const timer = setInterval(poll, 1200)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [showWakeupTask, wakeupAccount, wakeupRunId, svc])

  async function handleSaveWakeupSchedule () {
    if (!svc || typeof svc.saveWakeupSchedule !== 'function') {
      toast.error('当前环境不支持 Codex 定时唤醒')
      return
    }
    if (!wakeupAccount || !wakeupAccount.id) {
      toast.warning('请先选择要配置的 Codex 账号')
      return
    }
    setWakeupSaving(true)
    const model = normalizeWakeupModelValue(wakeupForm.model)
    const reasoningEffort = normalizeWakeupReasoningForModel(model, wakeupForm.reasoningEffort)
    try {
      const result = await Promise.resolve(svc.saveWakeupSchedule(wakeupAccount.id, {
        enabled: wakeupForm.enabled,
        schedule_kind: wakeupForm.scheduleKind,
        daily_time: wakeupForm.dailyTime,
        weekly_days: wakeupForm.weeklyDays,
        weekly_time: wakeupForm.weeklyTime,
        interval_hours: wakeupForm.intervalHours,
        quota_reset_window: wakeupForm.quotaResetWindow,
        startup_delay_minutes: wakeupForm.startupDelayMinutes,
        prompt: wakeupForm.prompt,
        model,
        reasoning_effort: reasoningEffort
      }))
      if (!result || result.success === false) {
        toast.error((result && result.error) || '保存唤醒配置失败')
        return
      }
      const schedule = result.schedule || {}
      setWakeupForm(prev => ({
        ...prev,
        enabled: schedule.enabled === true,
        scheduleKind: normalizeWakeupScheduleKind(schedule.schedule_kind || prev.scheduleKind),
        dailyTime: schedule.daily_time || prev.dailyTime,
        weeklyDays: normalizeWakeupWeeklyDays(schedule.weekly_days || prev.weeklyDays),
        weeklyTime: schedule.weekly_time || prev.weeklyTime,
        intervalHours: String(schedule.interval_hours || prev.intervalHours),
        quotaResetWindow: schedule.quota_reset_window || prev.quotaResetWindow,
        startupDelayMinutes: String(schedule.startup_delay_minutes || prev.startupDelayMinutes),
        model: normalizeWakeupModelValue(schedule.model || model),
        reasoningEffort: normalizeWakeupReasoningForModel(schedule.model || model, schedule.reasoning_effort || reasoningEffort),
        lastMessage: schedule.last_message || prev.lastMessage
      }))
      if (typeof svc.getWakeupOverview === 'function') {
        const overviewResult = await Promise.resolve(svc.getWakeupOverview(wakeupAccount.id))
        if (overviewResult && overviewResult.success !== false) setWakeupOverview(overviewResult)
      }
      toast.success(wakeupForm.enabled ? '定时唤醒已保存' : '唤醒配置已保存')
    } catch (e) {
      toast.error('保存唤醒配置失败: ' + (e?.message || String(e)))
    } finally {
      setWakeupSaving(false)
    }
  }

  async function handleExport (ids) {
    const picked = Array.isArray(ids) ? ids.filter(Boolean) : []
    if (picked.length === 0) {
      toast.warning('请先选择要导出的账号')
      return
    }
    const json = svc.exportAccounts(picked)
    openExportDialog(json, picked.length)
  }

  function handleOpenTagEditor (account) {
    setTagEditor({
      id: account.id,
      value: (account.tags || []).join(', ')
    })
  }

  function handleSaveTags () {
    const id = tagEditor.id
    if (!id) return
    const tags = tagEditor.value
      .split(/[,，]/)
      .map(item => item.trim())
      .filter(Boolean)
    svc.updateTags(id, tags)
    setTagEditor({ id: '', value: '' })
    toast.success('标签已更新')
    refresh()
  }

  function handleWakeupModelSelectChange (value) {
    if (value === CODEX_WAKEUP_CUSTOM_MODEL_VALUE) {
      setWakeupCustomModelMode(true)
      setWakeupForm(prev => {
        const currentModel = normalizeWakeupModelValue(prev.model)
        const model = currentModel && !isWakeupPresetModel(currentModel, getWakeupModelOptionsForAccount(wakeupAccount)) ? currentModel : ''
        return {
          ...prev,
          model,
          reasoningEffort: normalizeWakeupReasoningForModel(model, prev.reasoningEffort)
        }
      })
      return
    }
    const model = normalizeWakeupModelValue(value)
    setWakeupCustomModelMode(false)
    setWakeupForm(prev => ({
      ...prev,
      model,
      reasoningEffort: normalizeWakeupReasoningForModel(model, prev.reasoningEffort)
    }))
  }

  function handleWakeupCustomModelChange (value) {
    const model = normalizeWakeupModelValue(value)
    setWakeupForm(prev => ({
      ...prev,
      model,
      reasoningEffort: normalizeWakeupReasoningForModel(model, prev.reasoningEffort)
    }))
  }

  function toggleWakeupWeeklyDay (day) {
    setWakeupForm(prev => {
      const current = normalizeWakeupWeeklyDays(prev.weeklyDays)
      const next = current.includes(day)
        ? current.filter(item => item !== day)
        : current.concat(day)
      return {
        ...prev,
        weeklyDays: normalizeWakeupWeeklyDays(next)
      }
    })
  }

  function handleSaveBatchTags () {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {
      toast.warning('请先选择账号')
      return
    }
    const tags = batchTagEditor.value
      .split(/[,，]/)
      .map(item => item.trim())
      .filter(Boolean)
    ids.forEach(id => {
      svc.updateTags(id, tags)
    })
    closeBatchTagEditor()
    toast.success(`已更新 ${ids.length} 个账号标签`)
    refresh()
  }



  const invalidCount = accounts.filter(a => !!a?.quota?.error || !!a?.quota_error?.message || a.invalid || a.quota?.invalid).length
  const validCount = accounts.length - invalidCount
  const isSessionView = activeView === 'sessions'

  function switchActiveView (view) {
    setActiveView(writeCodexActiveView(view))
  }

  const wakeupModelOptions = getWakeupModelOptionsForAccount(wakeupAccount)
  const wakeupModelSelectValue = resolveWakeupModelSelectValue(wakeupForm.model, wakeupCustomModelMode, wakeupModelOptions)
  const wakeupReasoningOptions = getWakeupReasoningOptions(wakeupForm.model)
  const wakeupReasoningValue = normalizeWakeupReasoningForModel(wakeupForm.model, wakeupForm.reasoningEffort)
  const wakeupLatest = wakeupOverview?.latest || null
  const wakeupSchedule = wakeupOverview?.schedule || null
  const wakeupNextRunAt = Number(wakeupOverview?.next_run_at || wakeupSchedule?.next_run_at || 0) || 0
  const visibleAccounts = usePlatformSearch(accounts, searchQuery, {
    getSearchText: (acc) => {
      const tagsStr = Array.isArray(acc?.tags) ? acc.tags.join(' ') : ''
      return `${acc?.email || ''} ${acc?.username || ''} ${acc?.id || ''} ${acc?.teamName || ''} ${acc?.org || ''} ${acc?.team || ''} ${tagsStr}`
    },
    sort: (a, b) => {
      const aIsCurrent = a.id === currentId ? 1 : 0
      const bIsCurrent = b.id === currentId ? 1 : 0
      if (bIsCurrent !== aIsCurrent) return bIsCurrent - aIsCurrent
      return 0
    }
  })

  return (
    <div>
      <div className='page-header'>
        <div>
          <h1 className='page-title'>
            <PlatformIcon platform="codex" size={24} /> Codex
            <UsageGuide
              platform='Codex'
              title='Codex 账号管理说明'
              description='用于管理 Codex CLI / OpenAI 账号，查看配额、切换本地登录态、导入导出账号，并可为账号绑定独立 CODEX_HOME 实例启动 Codex CLI。CLI 单独实例表示每个账号使用独立的本地配置目录，避免不同账号共享登录态、设置和会话索引。'
              permissions={[
                '读取并写入当前系统默认配置目录中的 `auth.json`，用于同步当前本地登录态、账户 Token 及本地应用切号。',
                '账号绑定实例启动 Codex CLI 时，会使用独立 `CODEX_HOME` 隔离该账号的配置、会话索引和历史记录。',
                '会话管理页会读取默认 `~/.codex` 与账号实例目录中的本地会话，用于按工作区查看、继续、归档或移入回收站。'
              ]}
              network={[
                'OAuth 与凭证刷新会调用 OpenAI 官方接口（`auth.openai.com`）。',
                '配额查询会调用 OpenAI/ChatGPT 接口（`chatgpt.com/backend-api/wham/usage`），仅发送必要的授权字段。'
              ]}
            />
          </h1>
          <p className='page-subtitle' style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
            共 {accounts.length} 个账号, 有效 {validCount}, 失效 {invalidCount}
            {selectedCount > 0 ? ` · 已选 ${selectedCount} 个` : ''}
          </p>
        </div>
        <div className='page-actions'>
          {!isSessionView && (
            <button className='action-bar-btn action-bar-btn-primary' onClick={() => openAddModal('oauth')} data-tip='添加账号'>
              <PlusIcon size={18} />
            </button>
          )}
          {accounts.length > 0 && !isSessionView && (
            <>
              <button className={`action-bar-btn ${loading ? 'is-loading' : ''}`} onClick={handleRefreshAll} disabled={loading} data-tip='刷新全套配额'>
                <RefreshIcon size={18} spinning={loading} />
              </button>
              <button
                className='action-bar-btn'
                onClick={() => handleExport(selectedCount > 0 ? Array.from(selectedIds) : accounts.map(a => a.id))}
                data-tip={selectedCount > 0 ? '导出已选' : '导出全部'}
              >
                <UploadIcon size={18} />
              </button>
              {selectedCount > 0 && (
                <button className='action-bar-btn' onClick={() => openBatchTagEditor('')} data-tip='批量设置标签'>
                  <TagIcon size={18} />
                </button>
              )}
            </>
          )}
          {accounts.length > 0 && (
            <button
              className={`action-bar-btn codex-session-toggle ${isSessionView ? 'active' : ''}`}
              onClick={() => switchActiveView(isSessionView ? 'accounts' : 'sessions')}
              data-tip={isSessionView ? '返回账号总览' : '会话管理'}
            >
              <FolderIcon size={18} />
            </button>
          )}
          <PrivacyToggleButton />
          <button className='action-bar-btn' onClick={() => setShowAdvancedConfig(true)} data-tip='高级偏好设置'>
            <SettingsIcon size={18} />
          </button>
        </div>
      </div>

      {isSessionView
        ? (
          <CodexSessionManager
            svc={svc}
            accounts={accounts}
            searchQuery={searchQuery}
            toast={toast}
            onBack={() => switchActiveView('accounts')}
          />
          )
        : accounts.length === 0 && !localImportHint.visible
        ? (
          <div className='empty-state'>
            <div className='empty-state-icon'>💻</div>
            <div className='empty-state-text'>
              暂无 Codex 账号<br />
              点击"添加账号"通过 OAuth、Token/JSON 或本地导入添加账号
            </div>
          </div>
          )
        : (
          <div className='account-grid'>
            {localImportHint.visible && (
              <LocalPendingCard
                email={localImportHint.email}
                loading={importingLocal}
                onImport={() => handleImportLocal({ closeAfter: false })}
              />
            )}
            {visibleAccounts.map(account => (
              <CodexAccountItem
                key={account.id}
                account={account}
                isCurrent={account.id === currentId}
                isSelected={selectedIds.has(account.id)}
                refreshingIds={quotaActions.runningIds}
                globalLoading={loading}
                onToggleSelect={() => toggleSelection(account.id)}
                onActivate={() => handleActivate(account.id)}
                onRefresh={() => handleRefreshQuota(account.id)}
                onDelete={() => setConfirmDelete(account.id)}
                onEditTags={() => handleOpenTagEditor(account)}
                onReauthorize={() => openAddModal('oauth')}
                onLaunchCli={() => handleLaunchCliRequest(account)}
                launchCliTip={getCliLaunchTip(account)}
                onWakeup={() => openWakeupTaskModal(account)}
                svc={svc}
              />
            ))}
          </div>
          )}

      <CodexAddAccountModal
        open={showImport}
        onClose={closeAddModal}
        addTab={addTab}
        onSwitchTab={handleSwitchAddTab}
        oauthAuthUrl={oauthAuthUrl}
        oauthPreparing={oauthPreparing}
        oauthPrepareError={oauthPrepareError}
        oauthUrlCopied={oauthUrlCopied}
        onCopyOAuthUrl={handleCopyOAuthUrl}
        onOpenOAuthInBrowser={handleOpenOAuthInBrowser}
        onCancelOAuthInBrowser={handleCancelOAuthInBrowser}
        onPrepareOAuthSession={prepareOAuthSession}
        oauthCallbackInput={oauthCallbackInput}
        onOAuthCallbackInputChange={setOauthCallbackInput}
        oauthRedirectUri={oauthRedirectUri}
        oauthBusy={oauthBusy}
        oauthSessionId={oauthSessionId}
        onSubmitOAuthCallback={handleSubmitOAuthCallback}
        oauthRecovered={oauthRecovered}
        oauthPolling={oauthPolling}
        importJson={importJson}
        onImportJsonChange={setImportJson}
        jsonImportRequiredText={CODEX_JSON_IMPORT_REQUIRED_TEXT}
        jsonImportExample={CODEX_JSON_IMPORT_EXAMPLE}
        onImportJson={handleImportJson}
        importingLocal={importingLocal}
        onImportLocal={() => handleImportLocal({ closeAfter: true })}
        toast={toast}
      />

      <Modal
        title='选择 Codex CLI 启动实例'
        open={!!cliLaunchChoiceAccount}
        onClose={() => setCliLaunchChoiceAccount(null)}
        footer={
          <button className='btn' onClick={() => setCliLaunchChoiceAccount(null)}>取消</button>
        }
      >
        <div className='codex-cli-choice-panel'>
          <button
            className='codex-cli-choice-card'
            onClick={() => handleChooseCliInstanceMode('bound')}
            type='button'
          >
            <strong>账号绑定实例</strong>
            <span>使用此账号独立 CODEX_HOME，登录态与会话隔离。</span>
          </button>
          <button
            className='codex-cli-choice-card'
            onClick={() => handleChooseCliInstanceMode('default')}
            type='button'
          >
            <strong>默认 ~/.codex 实例</strong>
            <span>使用本机默认 Codex 配置，只允许当前账号选择。</span>
          </button>
        </div>
      </Modal>

      <CodexTagModals
        tagEditor={tagEditor}
        onTagEditorChange={(value) => setTagEditor(prev => ({ ...prev, value }))}
        onCloseTagEditor={() => setTagEditor({ id: '', value: '' })}
        onSaveTags={handleSaveTags}
        batchTagEditor={batchTagEditor}
        selectedCount={selectedCount}
        onBatchTagValueChange={setBatchTagValue}
        onCloseBatchTagEditor={closeBatchTagEditor}
        onSaveBatchTags={handleSaveBatchTags}
      />

      <ConfirmModal
        title='删除账号'
        message='确定要删除此 Codex 账号吗？此操作不可恢复。'
        open={confirmDelete !== null}
        danger
        onConfirm={() => handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <ExportJsonModal
        title='导出 JSON'
        open={exportDialog.open}
        onClose={closeExportDialog}
        jsonText={exportDialog.json}
        onCopy={copyExportJson}
        onDownload={downloadExportJson}
      />

      <Modal
        title='Codex 唤醒任务'
        open={showWakeupTask}
        onClose={() => {
          if (!wakeupRunning) setShowWakeupTask(false)
        }}
        contentClassName='codex-wakeup-modal'
        footer={
          <>
            <button className='btn' onClick={() => setShowWakeupTask(false)} disabled={wakeupRunning || wakeupSaving}>关闭</button>
            <button className='btn' onClick={handleSaveWakeupSchedule} disabled={wakeupRunning || wakeupSaving || !wakeupAccount}>
              {wakeupSaving ? '保存中...' : '保存定时'}
            </button>
            <button className={`btn btn-primary codex-wakeup-run-btn ${wakeupRunning ? 'is-running' : ''}`} onClick={handleRunWakeupTask} disabled={wakeupRunning || wakeupSaving || !wakeupAccount}>
              {wakeupRunning && <span className='codex-wakeup-run-spinner' aria-hidden='true' />}
              <span>{wakeupRunning ? '唤醒中...' : '立即唤醒'}</span>
            </button>
          </>
        }
      >
        <div className='codex-wakeup-form'>
          <div className='codex-wakeup-target'>
            <div>
              <div className='codex-wakeup-target-label'>目标账号</div>
              <div className='codex-wakeup-target-title'>{wakeupAccount?.email || wakeupAccount?.id || '-'}</div>
            </div>
            <div className='codex-wakeup-status-toggle'>
              <button
                type='button'
                className={`codex-wakeup-segment-btn ${wakeupForm.enabled ? 'active' : ''}`}
                onClick={() => setWakeupForm(prev => ({ ...prev, enabled: true }))}
                disabled={wakeupRunning || wakeupSaving}
              >
                启用
              </button>
              <button
                type='button'
                className={`codex-wakeup-segment-btn ${!wakeupForm.enabled ? 'active' : ''}`}
                onClick={() => setWakeupForm(prev => ({ ...prev, enabled: false }))}
                disabled={wakeupRunning || wakeupSaving}
              >
                停用
              </button>
            </div>
          </div>
          <div className='form-group'>
            <label className='form-label'>调度模式</label>
            <div className='codex-wakeup-segmented'>
              {CODEX_WAKEUP_SCHEDULE_OPTIONS.map(option => (
                <button
                  type='button'
                  key={option.value}
                  className={`codex-wakeup-segment-btn ${wakeupForm.scheduleKind === option.value ? 'active' : ''}`}
                  onClick={() => setWakeupForm(prev => ({ ...prev, scheduleKind: option.value }))}
                  disabled={wakeupRunning || wakeupSaving}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {wakeupForm.scheduleKind === 'daily' && (
            <div className='form-group'>
              <label className='form-label'>每日唤醒时间</label>
              <input
                type='time'
                className='form-input'
                value={wakeupForm.dailyTime}
                onChange={(event) => setWakeupForm(prev => ({ ...prev, dailyTime: event.target.value }))}
                disabled={wakeupRunning || wakeupSaving}
              />
            </div>
          )}
          {wakeupForm.scheduleKind === 'weekly' && (
            <div className='codex-wakeup-grid'>
              <div className='form-group'>
                <label className='form-label'>每周日期</label>
                <div className='codex-wakeup-weekdays'>
                  {CODEX_WAKEUP_WEEKDAY_OPTIONS.map(option => (
                    <button
                      type='button'
                      key={option.value}
                      className={`codex-wakeup-day-btn ${wakeupForm.weeklyDays.includes(option.value) ? 'active' : ''}`}
                      onClick={() => toggleWakeupWeeklyDay(option.value)}
                      disabled={wakeupRunning || wakeupSaving}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className='form-group'>
                <label className='form-label'>每周唤醒时间</label>
                <input
                  type='time'
                  className='form-input'
                  value={wakeupForm.weeklyTime}
                  onChange={(event) => setWakeupForm(prev => ({ ...prev, weeklyTime: event.target.value }))}
                  disabled={wakeupRunning || wakeupSaving}
                />
              </div>
            </div>
          )}
          {wakeupForm.scheduleKind === 'interval' && (
            <div className='form-group'>
              <label className='form-label'>间隔小时</label>
              <input
                type='number'
                min='1'
                max='24'
                className='form-input'
                value={wakeupForm.intervalHours}
                onChange={(event) => setWakeupForm(prev => ({ ...prev, intervalHours: event.target.value.replace(/[^\d]/g, '') }))}
                disabled={wakeupRunning || wakeupSaving}
              />
            </div>
          )}
          {wakeupForm.scheduleKind === 'quota_reset' && (
            <div className='form-group'>
              <label className='form-label'>配额重置窗口</label>
              <select
                className='form-input'
                value={wakeupForm.quotaResetWindow}
                onChange={(event) => setWakeupForm(prev => ({ ...prev, quotaResetWindow: event.target.value }))}
                disabled={wakeupRunning || wakeupSaving}
              >
                {CODEX_WAKEUP_QUOTA_RESET_WINDOW_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className='form-hint'>依赖账号配额中的重置时间；没有重置时间时不会自动触发。</div>
            </div>
          )}
          {wakeupForm.scheduleKind === 'startup' && (
            <div className='form-group'>
              <label className='form-label'>启动后延迟分钟</label>
              <input
                type='number'
                min='0'
                max='1440'
                className='form-input'
                value={wakeupForm.startupDelayMinutes}
                onChange={(event) => setWakeupForm(prev => ({ ...prev, startupDelayMinutes: event.target.value.replace(/[^\d]/g, '') }))}
                disabled={wakeupRunning || wakeupSaving}
              />
              <div className='form-hint'>设置为 0 表示插件启动后立即触发；停用后不会执行。</div>
            </div>
          )}
          <div className='codex-wakeup-grid'>
            <div className='form-group'>
              <label className='form-label'>模型</label>
              <select
                className='form-input'
                value={wakeupModelSelectValue}
                onChange={(event) => handleWakeupModelSelectChange(event.target.value)}
                disabled={wakeupRunning || wakeupSaving}
              >
                {wakeupModelOptions.map(option => (
                  <option key={option.value || 'default'} value={option.value}>{option.label}</option>
                ))}
              </select>
              {wakeupModelSelectValue === CODEX_WAKEUP_CUSTOM_MODEL_VALUE && (
                <input
                  className='form-input codex-wakeup-custom-model-input'
                  value={wakeupForm.model}
                  onChange={(event) => handleWakeupCustomModelChange(event.target.value)}
                  placeholder='例如 gpt-5.4-mini'
                  disabled={wakeupRunning || wakeupSaving}
                />
              )}
            </div>
            <div className='form-group'>
              <label className='form-label'>推理强度</label>
              <select
                className='form-input'
                value={wakeupReasoningValue}
                onChange={(event) => setWakeupForm(prev => ({ ...prev, reasoningEffort: event.target.value }))}
                disabled={wakeupRunning || wakeupSaving}
              >
                {wakeupReasoningOptions.map(option => (
                  <option key={option.value || 'default'} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className='form-group'>
            <label className='form-label'>提示词</label>
            <textarea
              className='form-textarea codex-wakeup-prompt'
              value={wakeupForm.prompt}
              onChange={(event) => setWakeupForm(prev => ({ ...prev, prompt: event.target.value }))}
              placeholder='hi'
              disabled={wakeupRunning || wakeupSaving}
            />
          </div>
          {wakeupResult && (
            <div className='codex-wakeup-result'>
              <div className='codex-wakeup-result-summary'>
                <span>成功 {Number(wakeupResult.success_count || 0)}</span>
                <span>失败 {Number(wakeupResult.failure_count || 0)}</span>
              </div>
              <div className='codex-wakeup-result-list'>
                {(wakeupResult.records || []).map(record => (
                  <div key={record.id || record.account_id} className={`codex-wakeup-result-row ${record.success ? 'is-success' : 'is-error'}`}>
                    <div>
                      <div className='codex-wakeup-result-title'>{record.account_email || record.account_id}</div>
                      <div className='codex-wakeup-result-message'>{record.success ? (record.reply || '唤醒完成') : (record.error || '唤醒失败')}</div>
                    </div>
                    <span className='codex-wakeup-result-badge'>{record.success ? '成功' : '失败'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={`codex-wakeup-overview ${wakeupLatest?.status === 'running' ? 'is-running' : ''}`}>
            {wakeupLatest?.status === 'running' && <div className='codex-wakeup-progress-bar' />}
            <div className='codex-wakeup-overview-grid'>
              <div><strong>最近结果:</strong> {resolveWakeupLatestSummary(wakeupLatest, true)}</div>
              <div><strong>最近耗时:</strong> {formatWakeupDuration(wakeupLatest?.duration_ms)}</div>
              <div><strong>上次执行</strong> {formatWakeupDateTime(wakeupLatest?.started_at || wakeupSchedule?.last_run_at)}</div>
              <div><strong>下次触发</strong> {formatWakeupDateTime(wakeupNextRunAt)}</div>
              <div><strong>触发方式</strong> {wakeupLatest?.trigger_label || '-'}</div>
            </div>
          </div>
        </div>
      </Modal>

      <CodexSettingsModal
        open={showAdvancedConfig}
        onClose={() => setShowAdvancedConfig(false)}
        toast={toast}
        settings={advancedSettings}
        onSettingsChange={setAdvancedSettings}
        svc={svc}
      />
    </div>
  )
}
