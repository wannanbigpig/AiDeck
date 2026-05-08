import { useEffect, useMemo, useState } from 'react'
import Modal, { ConfirmModal } from '../components/Modal'
import ExportJsonModal from '../components/ExportJsonModal'
import { useToast } from '../components/Toast'
import { PlatformIcon } from '../components/Icons/PlatformIcons'
import PrivacyToggleButton from '../components/PrivacyToggleButton'
import LocalPendingCard from '../components/LocalPendingCard'
import UsageGuide from '../components/UsageGuide'
import AntigravitySettingsModal from './antigravity/AntigravitySettingsModal'
import AntigravityAddAccountModal from './antigravity/AntigravityAddAccountModal'
import AntigravityTagModals from './antigravity/AntigravityTagModals'
import AntigravityDeviceIdentityModal from './antigravity/AntigravityDeviceIdentityModal'
import AntigravityAccountItem from './antigravity/AntigravityAccountItem'
import { useAntigravityOAuthFlow } from './antigravity/useAntigravityOAuthFlow'
import {
  TagIcon,
  RefreshIcon,
  UploadIcon,
  TrashIcon,
  PlusIcon,
  SettingsIcon
} from '../components/Icons/ActionIcons'

const WAKEUP_SCHEDULE_OPTIONS = [
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每周' },
  { value: 'interval', label: '间隔' },
  { value: 'quota_reset', label: '配额重置' },
  { value: 'startup', label: '启动后' }
]
const WAKEUP_WEEKDAY_OPTIONS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' }
]
const WAKEUP_QUOTA_RESET_WINDOW_OPTIONS = [
  { value: 'either', label: '任意窗口' },
  { value: 'primary_window', label: '5 小时窗口' },
  { value: 'secondary_window', label: '每周窗口' }
]

const AG_WAKEUP_CUSTOM_MODEL_VALUE = '__custom__'
const AG_WAKEUP_DEFAULT_MODEL = 'gemini-3.1-pro-low'
const AG_WAKEUP_MODEL_OPTIONS = [
  { value: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
  { value: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
  { value: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { value: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { value: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  { value: AG_WAKEUP_CUSTOM_MODEL_VALUE, label: '自定义模型' }
]

function isWakeupPresetModel (value) {
  const text = String(value || '').trim()
  if (!text) return false
  return AG_WAKEUP_MODEL_OPTIONS.some(o => o.value === text && o.value !== AG_WAKEUP_CUSTOM_MODEL_VALUE)
}

function resolveWakeupModelSelectValue (value, customMode = false) {
  const text = String(value || '').trim()
  if (customMode) return AG_WAKEUP_CUSTOM_MODEL_VALUE
  if (!text) return AG_WAKEUP_DEFAULT_MODEL
  return isWakeupPresetModel(text) ? text : AG_WAKEUP_CUSTOM_MODEL_VALUE
}

function normalizeWakeupScheduleKind (value) {
  const text = String(value || '').trim()
  return WAKEUP_SCHEDULE_OPTIONS.some(o => o.value === text) ? text : 'daily'
}

function normalizeWakeupWeeklyDays (value) {
  const raw = Array.isArray(value) ? value : []
  const days = Array.from(new Set(raw.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)))
  return days.length > 0 ? days : [1]
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
  const ts = Number(value || 0)
  if (!ts) return '-'
  try { return new Date(ts).toLocaleString() } catch { return '-' }
}

function formatWakeupDuration (value) {
  const ms = Number(value || 0)
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatWakeupErrorMessage (value) {
  const raw = String(value || '').trim()
  if (!raw.startsWith('AG_WAKEUP_ERROR_JSON:')) return raw || '唤醒失败'
  try {
    const payload = JSON.parse(raw.slice('AG_WAKEUP_ERROR_JSON:'.length))
    const code = Number(payload?.error_code || payload?.errorCode || 0) || 0
    const message = String(payload?.message || '').trim() || 'Antigravity 唤醒失败'
    if (String(payload?.kind || '').toLowerCase() === 'temporary') {
      return `上游服务临时错误，已重试后仍失败：${message}${code ? ` (code ${code})` : ''}`
    }
    return `${message}${code ? ` (code ${code})` : ''}`
  } catch {
    return raw
  }
}

function resolveWakeupLatestSummary (item, singleAccount) {
  if (!item) return '暂无结果'
  if (item.status === 'running') return '唤醒中'
  const sc = Number(item.success_count || 0)
  const fc = Number(item.failure_count || 0)
  if (singleAccount) return sc > 0 && fc === 0 ? '成功' : '失败'
  if (sc > 0 && fc === 0) return `成功 ${sc} 个账号`
  if (sc > 0) return `成功 ${sc}，失败 ${fc}`
  if (fc > 0) return `失败 ${fc} 个账号`
  return item.status === 'success' ? '成功' : '失败'
}
import { ANTIGRAVITY_MODEL_GROUPS, getAntigravityQuotaDisplayItems } from '../utils/antigravity'
import { resolveQuotaErrorMeta } from '../utils/codex'
import { logRequestEvent } from '../utils/requestLogClient'
import { coerceBooleanSetting } from '../utils/globalSettings'
import { copyText } from '../utils/hostBridge.js'
import { usePlatformSnapshot } from '../runtime/usePlatformSnapshot.js'
import { usePlatformActions } from '../runtime/usePlatformActions.js'
import { usePlatformAutoRefresh } from '../runtime/usePlatformAutoRefresh.js'
import { runPlatformBatchRefresh } from '../runtime/runPlatformBatchRefresh.js'
import { usePlatformAddFlow } from '../runtime/usePlatformAddFlow.js'
import { useSelectionSet } from '../runtime/useSelectionSet.js'
import { usePlatformSearch } from '../runtime/usePlatformSearch.js'
import { useBatchTagEditor } from '../runtime/useBatchTagEditor.js'
import { usePlatformExportDialog } from '../runtime/usePlatformExportDialog.js'
import {
  getQuotaRefreshIssueMessage,
  getAntigravityDeviceIdentityMeta,
  readAntigravityAdvancedSettings
} from './antigravity/antigravityPageUtils.js'

const ANTIGRAVITY_JSON_IMPORT_REQUIRED_TEXT = '必填字段：token.access_token 或 token.refresh_token 至少一个（也支持顶层 access_token / refresh_token）。建议补充 id、email、name、token.access_token、token.refresh_token、token.expires_in、token.expiry_timestamp、created_at、last_used。'

const ANTIGRAVITY_JSON_IMPORT_EXAMPLE = `[
  {
    "id": "ag_5f3d9c81",
    "email": "user@gmail.com",
    "name": "Example User",
    "token": {
      "access_token": "ya29.a0AfH6SMB...",
      "refresh_token": "1//0gxxxxxxxx",
      "expires_in": 3600,
      "expiry_timestamp": 1770003600,
      "token_type": "Bearer",
      "project_id": "antigravity-prod"
    },
    "quota": {
      "models": []
    },
    "created_at": 1770000000000,
    "last_used": 1770003600000
  }
]`

/**
 * Antigravity 账号管理页
 */
export default function Antigravity({ onActivity, searchQuery = '' }) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [addTab, setAddTab] = useState('oauth')
  const [importJson, setImportJson] = useState('')
  const [refreshTokenInput, setRefreshTokenInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importingLocal, setImportingLocal] = useState(false)
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)
  const [advancedSettings, setAdvancedSettings] = useState(() => readAntigravityAdvancedSettings())
  const [detailAccount, setDetailAccount] = useState(null)
  const [tagEditor, setTagEditor] = useState({ id: '', value: '' })
  const [localImportHint, setLocalImportHint] = useState({ visible: false, email: '' })
  const [showWakeupTask, setShowWakeupTask] = useState(false)
  const [wakeupRunning, setWakeupRunning] = useState(false)
  const [wakeupSaving, setWakeupSaving] = useState(false)
  const [wakeupAccount, setWakeupAccount] = useState(null)
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
    model: AG_WAKEUP_DEFAULT_MODEL,
    prompt: 'hi',
    lastMessage: ''
  })
  const toast = useToast()
  const platformSnapshot = usePlatformSnapshot('antigravity', {
    watchLocalState: true,
    watchStorageRevision: true,
    syncCurrentFromLocal: true,
    autoImport: false,
    onAfterSync: refreshLocalImportHint
  })
  const { svc, accounts, currentId, setAccounts, setCurrentId, refreshSnapshot } = platformSnapshot
  const quotaActions = usePlatformActions()
  const { selectedIds, selectedCount, toggleSelection, clearSelection } = useSelectionSet(accounts, { getId: (account) => account && account.id })
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
    filenamePrefix: 'antigravity-accounts'
  })
  const oauthFlow = useAntigravityOAuthFlow({
    svc,
    toast,
    onRecovered: () => {
      setShowAddModal(true)
      setAddTab('oauth')
    },
    onCompleted: (account, result) => {
      toast.success(`OAuth 授权成功: ${account.email || account.id}`)
      if (result?.quotaRefreshError) {
        toast.warning(`账号已添加，但首次刷新配额失败: ${result.quotaRefreshError}`)
      }
      onActivity?.(`OAuth 添加 Antigravity 账号 -> ${account.email || account.id}`)
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
    platform: 'antigravity',
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
    setOpen: setShowAddModal,
    setTab: setAddTab,
    resetForm: resetAddForm,
    ensureOAuthReady,
    resetOAuth: resetAddFlowState
  })

  async function refreshLocalImportHint() {
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

  const visibleAccounts = usePlatformSearch(accounts, searchQuery, {
    getSearchText: (acc) => `${acc?.email || ''} ${acc?.username || ''} ${acc?.name || ''} ${acc?.id || ''} ${(acc?.tags || []).join(' ')}`,
    sort: (a, b) => {
      const aCurrent = a.id === currentId ? 1 : 0
      const bCurrent = b.id === currentId ? 1 : 0
      if (bCurrent !== aCurrent) return bCurrent - aCurrent
      return (b.created_at || 0) - (a.created_at || 0)
    }
  })

  function refresh() {
    if (!svc) return
    refreshSnapshot()
    void refreshLocalImportHint()
  }

  function resetAddForm() {
    setImportJson('')
    setRefreshTokenInput('')
  }

  function resetAddFlowState() {
    resetOAuthFlow()
    resetAddForm()
  }

  function applyImportedAccounts(items) {
    const imported = Array.isArray(items) ? items.filter(account => account && account.id) : []
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

  async function handleImportLocal(opts = {}) {
    const closeAfter = opts.closeAfter !== false
    if (importingLocal) return
    setImportingLocal(true)
    try {
      const result = await Promise.resolve(svc.importFromLocal())
      if (result.error) {
        toast.error(result.error)
      } else {
        const imported = Array.isArray(result.imported) ? result.imported : []
        applyImportedAccounts(imported)
        if (result.warning) {
          toast.warning(result.warning)
        }
        const refreshErrors = []
        for (let i = 0; i < imported.length; i++) {
          const acc = imported[i]
          if (!acc || !acc.id) continue
          const refreshed = await Promise.resolve(svc.refreshQuotaOrUsage(acc.id))
          const refreshIssue = getQuotaRefreshIssueMessage(refreshed)
          if (refreshIssue) {
            refreshErrors.push(`${acc.email || acc.id}: ${refreshIssue}`)
          }
        }
        toast.success(`成功导入 ${imported.length} 个账号`)
        if (refreshErrors.length > 0) {
          toast.warning(`其中 ${refreshErrors.length} 个账号首次刷新配额失败`)
        }
        onActivity?.(`本地导入 Antigravity 账号: ${imported.length} 个`)
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

  async function handleImportJson() {
    if (!importJson.trim()) {
      toast.warning('请输入 JSON 内容')
      return
    }
    const result = await Promise.resolve(svc.importFromJson(importJson))
    if (result.error) {
      toast.error(result.error)
    } else {
      const imported = Array.isArray(result.imported) ? result.imported : []
      const refreshErrors = []
      for (let i = 0; i < imported.length; i++) {
        const acc = imported[i]
        if (!acc || !acc.id) continue
        const refreshed = await Promise.resolve(svc.refreshQuotaOrUsage(acc.id))
        const refreshIssue = getQuotaRefreshIssueMessage(refreshed)
        if (refreshIssue) {
          refreshErrors.push(`${acc.email || acc.id}: ${refreshIssue}`)
        }
      }
      toast.success(`成功导入 ${imported.length} 个账号`)
      if (refreshErrors.length > 0) {
        toast.warning(`其中 ${refreshErrors.length} 个账号首次刷新配额失败`)
      }
      onActivity?.(`JSON 导入 Antigravity 账号: ${imported.length} 个`)
      closeAddModal()
      refresh()
    }
  }

  async function handleAddWithToken() {
    const refreshToken = refreshTokenInput.trim()
    if (!refreshToken) {
      toast.warning('请填写 refresh_token')
      return
    }
    if (!svc || typeof svc.addWithToken !== 'function') {
      toast.error('当前版本不支持 Token 添加')
      return
    }

    const account = await Promise.resolve(svc.addWithToken(refreshToken))
    if (!account || !account.id) {
      toast.error('添加 Token 账号失败')
      return
    }

    const quotaRefreshed = await Promise.resolve(svc.refreshQuotaOrUsage(account.id))
    toast.success(`已添加账号: ${account.email || account.id}`)
    const quotaRefreshIssue = getQuotaRefreshIssueMessage(quotaRefreshed)
    if (quotaRefreshIssue) {
      toast.warning(`首次刷新配额失败: ${quotaRefreshIssue}`)
    }
    onActivity?.(`Token 添加 Antigravity 账号 -> ${account.email || account.id}`)
    closeAddModal()
    refresh()
  }

  // ─── 唤醒调度 ───
  
  function toggleWakeupWeeklyDay (day) {
    setWakeupForm(prev => {
      const current = normalizeWakeupWeeklyDays(prev.weeklyDays)
      const next = current.includes(day) ? current.filter(item => item !== day) : current.concat(day)
      return { ...prev, weeklyDays: normalizeWakeupWeeklyDays(next) }
    })
  }
  
  async function openWakeupTaskModal (account) {
    if (!account || !account.id) return
    setWakeupResult(null)
    setWakeupOverview(null)
    setWakeupRunId('')
    setWakeupAccount(account)
    setWakeupForm({
      enabled: false,
      scheduleKind: 'daily',
      dailyTime: '09:00',
      weeklyDays: [1],
      weeklyTime: '09:00',
      intervalHours: '4',
      quotaResetWindow: 'either',
      startupDelayMinutes: '0',
      model: AG_WAKEUP_DEFAULT_MODEL,
      prompt: 'hi',
      lastMessage: ''
    })
    setWakeupCustomModelMode(false)
    setShowWakeupTask(true)
    if (!svc || typeof svc.getWakeupSchedule !== 'function') return
    try {
      const result = await Promise.resolve(svc.getWakeupSchedule(account.id))
      const schedule = result && result.schedule ? result.schedule : null
      if (schedule) {
        const scheduleModel = String(schedule.model || '').trim() || AG_WAKEUP_DEFAULT_MODEL
        setWakeupForm({
          enabled: schedule.enabled === true,
          scheduleKind: normalizeWakeupScheduleKind(schedule.schedule_kind),
          dailyTime: schedule.daily_time || '09:00',
          weeklyDays: normalizeWakeupWeeklyDays(schedule.weekly_days),
          weeklyTime: schedule.weekly_time || schedule.daily_time || '09:00',
          intervalHours: String(schedule.interval_hours || 4),
          quotaResetWindow: schedule.quota_reset_window || 'either',
          startupDelayMinutes: String(schedule.startup_delay_minutes || 0),
          model: scheduleModel,
          prompt: schedule.prompt || 'hi',
          lastMessage: schedule.last_message || ''
        })
        setWakeupCustomModelMode(!!scheduleModel && !isWakeupPresetModel(scheduleModel))
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
      toast.error('当前环境不支持 Antigravity 唤醒任务')
      return
    }
    if (!wakeupAccount || !wakeupAccount.id) {
      toast.warning('请先选择要唤醒的 Antigravity 账号')
      return
    }
    setWakeupRunning(true)
    setWakeupResult(null)
    const optimisticRunId = `ag-wakeup-ui-${Date.now()}`
    setWakeupOverview(prev => Object.assign({}, prev || {}, {
      running: true,
      latest: { run_id: optimisticRunId, status: 'running', trigger_type: 'manual', trigger_label: '立即唤醒', started_at: Date.now(), success_count: 0, failure_count: 0, records: [] }
    }))
    await waitForNextPaint()
    let backgroundStarted = false
    try {
      const result = await Promise.resolve(svc.runWakeupTask({
        accountIds: [wakeupAccount.id],
        prompt: wakeupForm.prompt,
        model: wakeupForm.model,
        triggerType: 'manual',
        background: true
      }))
      if (result?.run_id) {
        setWakeupRunId(result.run_id)
        setWakeupOverview(prev => Object.assign({}, prev || {}, {
          running: true,
          latest: Object.assign({}, prev?.latest || {}, { run_id: result.run_id, status: 'running', trigger_type: 'manual', trigger_label: '立即唤醒' })
        }))
      }
      if (result?.running) {
        backgroundStarted = true
        onActivity?.('Antigravity 唤醒任务 -> 唤醒中')
        return
      }
      setWakeupResult(result)
      refresh()
      const sc = Number(result?.success_count || 0)
      const fc = Number(result?.failure_count || 0)
      if (sc > 0 && fc === 0) toast.success(`唤醒完成：成功 ${sc} 个账号`)
      else if (sc > 0) toast.warning(`唤醒完成：成功 ${sc}，失败 ${fc}`)
      else toast.error(result?.error || '唤醒任务失败')
      onActivity?.(`Antigravity 唤醒任务 -> 成功 ${sc} / 失败 ${fc}`)
    } catch (e) {
      toast.error('唤醒任务失败: ' + (e?.message || String(e)))
      setWakeupOverview(prev => Object.assign({}, prev || {}, { running: false, latest: Object.assign({}, prev?.latest || {}, { status: 'error', error: e?.message || String(e), finished_at: Date.now() }) }))
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
        setWakeupOverview(prev => Object.assign({}, prev || {}, { latest: item, running: item.status === 'running' }))
        if (item.status !== 'running') {
          setWakeupRunning(false)
          setWakeupRunId('')
          setWakeupResult({ success: item.status === 'success', run_id: item.run_id, records: item.records || [], success_count: Number(item.success_count || 0), failure_count: Number(item.failure_count || 0), error: item.error || null })
          if (typeof svc.getWakeupOverview === 'function') {
            const overviewResult = await Promise.resolve(svc.getWakeupOverview(wakeupAccount.id))
            if (!cancelled && overviewResult && overviewResult.success !== false) setWakeupOverview(overviewResult)
          }
          refresh()
        }
      } catch {}
    }
    poll()
    const timer = setInterval(poll, 1200)
    return () => { cancelled = true; clearInterval(timer) }
  }, [showWakeupTask, wakeupAccount, wakeupRunId, svc])
  
  async function handleSaveWakeupSchedule () {
    if (!svc || typeof svc.saveWakeupSchedule !== 'function') {
      toast.error('当前环境不支持 Antigravity 定时唤醒')
      return
    }
    if (!wakeupAccount || !wakeupAccount.id) {
      toast.warning('请先选择要配置的 Antigravity 账号')
      return
    }
    setWakeupSaving(true)
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
        model: wakeupForm.model,
        prompt: wakeupForm.prompt
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
        model: String(schedule.model || prev.model || ''),
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
  
  async function handleActivate (id) {
    const result = await Promise.resolve(svc.activateAccount(id, {
      switchDeviceIdentity: coerceBooleanSetting(advancedSettings.switchDeviceIdentity, true)
    }))
    if (result.success) {
      toast.success('已设为当前')
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toast.info(result.warnings[0])
      }
      onActivity?.(`Antigravity 激活账号 -> ${id}`)
      refresh()
    } else {
      toast.error(result.error || '激活失败')
    }
  }

  function handleDelete(id) {
    svc.deleteAccount(id)
    toast.success('已删除')
    setConfirmDelete(null)
    refresh()
  }

  function handleDeleteSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {
      toast.warning('请先选择账号')
      return
    }
    svc.deleteAccounts(ids)
    toast.success(`已删除 ${ids.length} 个账号`)
    setConfirmBatchDelete(false)
    clearSelection()
    refresh()
  }

  async function handleRefreshQuota(id) {
    if (loading || quotaActions.batchRunning) return
    try {
      const result = await quotaActions.runSingle(id, (accountId) => Promise.resolve(svc.refreshQuotaOrUsage(accountId)))
      const issue = getQuotaRefreshIssueMessage(result)
      if (issue) {
        toast.warning(issue)
      } else if (result && result.message) {
        toast.info(result.message)
      } else {
        toast.success('配额已刷新')
      }
      refresh()
    } catch (e) {
      toast.error('刷新失败: ' + (e?.message || String(e)))
    }
  }

  function getQuotaDisplayItemsSafe(quota) {
    if (typeof getAntigravityQuotaDisplayItems !== 'function') {
      return []
    }
    try {
      return getAntigravityQuotaDisplayItems(quota, { aggregated: true })
    } catch {
      return []
    }
  }

  function getQuotaPercentageMap(account) {
    const items = getQuotaDisplayItemsSafe(account?.quota)
    const percentageMap = {}
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const key = String(item?.key || '').trim()
      const percentage = Number(item?.percentage)
      if (!key || !Number.isFinite(percentage)) continue
      percentageMap[key] = Math.max(0, Math.min(100, percentage))
    }
    return percentageMap
  }

  function resolveAutoSwitchWatchGroups(modelGroup) {
    if (modelGroup === 'any') return ANTIGRAVITY_MODEL_GROUPS
    if (ANTIGRAVITY_MODEL_GROUPS.includes(modelGroup)) return [modelGroup]
    return ANTIGRAVITY_MODEL_GROUPS
  }

  function resolveCandidateScore(percentageMap, watchGroups) {
    const values = watchGroups
      .map(key => Number(percentageMap[key]))
      .filter(value => Number.isFinite(value))
    if (values.length === 0) return -1
    return Math.max(...values)
  }

  async function maybeAutoSwitchAfterQuotaRefresh(source = 'manual') {
    if (!svc) return false
    const settings = readAntigravityAdvancedSettings()
    setAdvancedSettings(settings)
    if (!settings.autoSwitch) return false

    const current = svc.getCurrent()
    if (!current || !current.id) return false

    const allAccounts = svc.list() || []
    const currentAccount = allAccounts.find(a => a.id === current.id)
    if (!currentAccount) return false

    const threshold = Math.max(0, Math.min(30, Number(settings.autoSwitchThreshold) || 0))
    const watchGroups = resolveAutoSwitchWatchGroups(settings.autoSwitchModelGroup)
    const currentMap = getQuotaPercentageMap(currentAccount)
    const triggeredGroups = watchGroups.filter(group => {
      const val = Number(currentMap[group])
      return Number.isFinite(val) && val <= threshold
    })

    if (triggeredGroups.length === 0) return false

    const candidates = allAccounts
      .filter(acc => acc && acc.id && acc.id !== current.id)
      .filter(acc => !(acc.invalid || acc.quota?.error))
      .map(acc => {
        const map = getQuotaPercentageMap(acc)
        const hasEnoughForTriggeredGroups = triggeredGroups.every(group => {
          const val = Number(map[group])
          return Number.isFinite(val) && val > threshold
        })
        return {
          account: acc,
          score: resolveCandidateScore(map, watchGroups),
          hasEnoughForTriggeredGroups
        }
      })
      .filter(item => item.hasEnoughForTriggeredGroups && item.score >= 0)
      .sort((left, right) => right.score - left.score)

    const next = candidates[0]?.account
    if (!next) {
      logRequestEvent('antigravity.auto-switch', '自动切号未找到可用候选账号', {
        source,
        current: current.email || current.id,
        threshold,
        groups: triggeredGroups
      })
      return false
    }

    const result = await Promise.resolve(svc.activateAccount(next.id, {
      switchDeviceIdentity: coerceBooleanSetting(settings.switchDeviceIdentity, true)
    }))
    if (!result || !result.success) {
      logRequestEvent('antigravity.auto-switch', '自动切号失败', {
        source,
        current: current.email || current.id,
        next: next.email || next.id,
        error: (result && result.error) || '未知错误'
      }, 'warn')
      toast.warning('自动切号失败: ' + ((result && result.error) || '未知错误'))
      return false
    }

    refresh()
    if (result.warning) {
      toast.info(result.warning)
    }
    toast.success(`自动切号成功：${next.email || next.id}`)
    onActivity?.(`Antigravity 自动切号(${source}) -> ${next.email || next.id}`)
    logRequestEvent('antigravity.auto-switch', '自动切号成功', {
      source,
      current: current.email || current.id,
      next: next.email || next.id
    })
    return true
  }

  async function refreshAllQuotas(opts = {}) {
    if (!svc) return
    const { silent = false, source = 'manual' } = opts
    logRequestEvent('antigravity.batch-refresh', '开始批量刷新配额', {
      source,
      silent,
      total: (svc.list() || []).length
    })
    return await runPlatformBatchRefresh({
      svc,
      quotaActions,
      toast,
      batchId: 'antigravity-batch-refresh',
      silent,
      setLoading,
      preparingText: '准备刷新 Antigravity 配额...',
      progressText: ({ completed, total }) => `正在刷新 Antigravity 配额 (${completed}/${total})...`,
      successText: '全部账号配额刷新完成',
      concurrency: 2,
      refreshAccount: (accountId) => Promise.resolve(svc.refreshQuotaOrUsage(accountId)),
      resolveIssue: (item) => item.ok ? getQuotaRefreshIssueMessage(item.value) : (item.error?.message || String(item.error || '刷新失败')),
      onCompleted: async ({ total, failures }) => {
        refresh()
        try {
          await maybeAutoSwitchAfterQuotaRefresh(source)
        } catch (error) {
          logRequestEvent('antigravity.auto-switch', '自动切号流程异常', {
            source,
            error: error?.message || String(error)
          }, 'error')
          toast.warning('批量刷新已完成，但自动切号流程异常: ' + (error?.message || String(error)))
        }
        logRequestEvent('antigravity.batch-refresh', '批量刷新配额完成', {
          source,
          silent,
          total,
          failures: failures.length
        }, failures.length > 0 ? 'warn' : 'info')
      },
      onFailed: (error) => {
        logRequestEvent('antigravity.batch-refresh', '批量刷新配额异常', {
          source,
          silent,
          error: error?.message || String(error)
        }, 'error')
      }
    })
  }

  async function handleRefreshAll() {
    if (accounts.length === 0) return
    if (loading) return
    await refreshAllQuotas({ silent: false, source: 'manual' })
  }

  async function handleExport(ids) {
    const picked = Array.isArray(ids) ? ids.filter(Boolean) : []
    if (picked.length === 0) {
      toast.warning('请先选择要导出的账号')
      return
    }

    const json = svc.exportAccounts(picked)
    openExportDialog(json, picked.length)
  }

  function handleOpenTagEditor(account) {
    setTagEditor({
      id: account.id,
      value: (account.tags || []).join(', ')
    })
  }

  function handleSaveTags() {
    const id = tagEditor.id
    if (!id) return
    const tags = tagEditor.value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
    svc.updateTags(id, tags)
    setTagEditor({ id: '', value: '' })
    toast.success('标签已更新')
    refresh()
  }

  function handleSaveBatchTags() {
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

  async function handleCopyAccountId(account) {
    const ok = await copyText(account.id)
    if (ok) toast.success('账号 ID 已复制')
    else toast.warning('复制失败')
  }

  const invalidCount = accounts.filter(a => {
    const quotaErrorMeta = resolveQuotaErrorMeta(a?.quota_error, a?.quota?.error || '')
    return Boolean(a?.invalid || a?.quota?.invalid || quotaErrorMeta.disabled)
  }).length
  const validCount = accounts.length - invalidCount
  const detailDeviceMeta = useMemo(() => getAntigravityDeviceIdentityMeta(detailAccount), [detailAccount])
  const detailDeviceFields = useMemo(() => {
    const profile = detailDeviceMeta.profile || {}
    return [
      ['machine_id', profile.machine_id],
      ['mac_machine_id', profile.mac_machine_id],
      ['dev_device_id', profile.dev_device_id],
      ['sqm_id', profile.sqm_id],
      ['service_machine_id', profile.service_machine_id]
    ]
  }, [detailDeviceMeta])

  return (
    <div>
      <div className='page-header'>
        <div>
          <h1 className='page-title'>
            <PlatformIcon platform="antigravity" size={24} /> Antigravity
            <UsageGuide
              platform='Antigravity'
              title='Antigravity 账号管理说明'
              description='用于管理 Antigravity 登录账号，查看模型配额和可用 AI 积分，导入本机运行态，切换当前账号，并可按账号同步设备身份以模拟更接近真实客户端的本地环境。'
              permissions={[
                '读取并写入 `~/.ai_deck/antigravity/token.json`，用于存储当前切换到的运行态凭证。',
                '读取并写入本地官方客户端默认位置中的 `storage.json`、`machineid` 与 `state.vscdb`，用于导入当前本地登录账号并在启用“更换设备身份”时同步设备指纹。'
              ]}
              network={[
                'OAuth 与凭证授权会调用 Google 官方接口（`accounts.google.com`、`oauth2.googleapis.com`）。',
                '配额查询会调用 Google Cloud Code 内部接口（`cloudcode-pa.googleapis.com`），仅发送必要的认证字段。'
              ]}
            />
          </h1>
          <p className='page-subtitle' style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
            共 {accounts.length} 个账号, 有效 {validCount}, 失效 {invalidCount}
            {selectedCount > 0 ? ` · 已选 ${selectedCount} 个` : ''}
          </p>
        </div>

        <div className='page-actions'>
          <button className='action-bar-btn action-bar-btn-primary' onClick={() => openAddModal('oauth')} data-tip='添加账号'>
            <PlusIcon size={18} />
          </button>
          {accounts.length > 0 && (
            <>
              <button className={`action-bar-btn ${loading ? 'is-loading' : ''}`} onClick={handleRefreshAll} disabled={loading} data-tip='刷新全量配额'>
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
              {selectedCount > 0 && (
                <button className='action-bar-btn action-bar-btn-danger' onClick={() => setConfirmBatchDelete(true)} data-tip='删除已选'>
                  <TrashIcon size={18} />
                </button>
              )}
            </>
          )}
          <PrivacyToggleButton />
          <button className='action-bar-btn' onClick={() => setShowAdvancedConfig(true)} data-tip='Antigravity 设置'>
            <SettingsIcon size={18} />
          </button>
        </div>
      </div>

      {accounts.length === 0 && !localImportHint.visible
        ? (
          <div className='empty-state'>
            <div className='empty-state-icon'>🚀</div>
            <div className='empty-state-text'>
              暂无 Antigravity 账号<br />
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
              <AntigravityAccountItem
                key={account.id}
                account={account}
                quotaAggregatedDisplay={coerceBooleanSetting(advancedSettings.quotaAggregatedDisplay, true)}
                isCurrent={account.id === currentId}
                isSelected={selectedIds.has(account.id)}
                refreshingIds={quotaActions.runningIds}
                globalLoading={loading}
                onToggleSelect={() => toggleSelection(account.id)}
                onActivate={() => handleActivate(account.id)}
                onRefresh={() => handleRefreshQuota(account.id)}
                onDelete={() => setConfirmDelete(account.id)}
                onShowDetails={() => setDetailAccount(account)}
                onEditTags={() => handleOpenTagEditor(account)}
                onWakeup={() => openWakeupTaskModal(account)}
              />
            ))}
          </div>
        )}

      <AntigravityAddAccountModal
        open={showAddModal}
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
        refreshTokenInput={refreshTokenInput}
        onRefreshTokenInputChange={setRefreshTokenInput}
        onAddWithToken={handleAddWithToken}
        importJson={importJson}
        onImportJsonChange={setImportJson}
        jsonImportRequiredText={ANTIGRAVITY_JSON_IMPORT_REQUIRED_TEXT}
        jsonImportExample={ANTIGRAVITY_JSON_IMPORT_EXAMPLE}
        onImportJson={handleImportJson}
        importingLocal={importingLocal}
        onImportLocal={() => handleImportLocal({ closeAfter: true })}
        toast={toast}
      />

      <AntigravityTagModals
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

      <AntigravityDeviceIdentityModal
        detailAccount={detailAccount}
        detailDeviceMeta={detailDeviceMeta}
        detailDeviceFields={detailDeviceFields}
        onClose={() => setDetailAccount(null)}
      />

      <AntigravitySettingsModal
        open={showAdvancedConfig}
        onClose={() => setShowAdvancedConfig(false)}
        toast={toast}
        settings={advancedSettings}
        onSettingsChange={setAdvancedSettings}
        svc={svc}
      />

      {/* 删除确认 */}
      <ConfirmModal
        title='删除账号'
        message='确定要删除此账号吗？此操作不可恢复。'
        open={confirmDelete !== null}
        danger
        onConfirm={() => handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* 批量删除确认 */}
      <ConfirmModal
        title='批量删除账号'
        message={`确定要删除已选 ${selectedCount} 个账号吗？此操作不可恢复。`}
        open={confirmBatchDelete}
        danger
        onConfirm={handleDeleteSelected}
        onCancel={() => setConfirmBatchDelete(false)}
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
        title='Antigravity 唤醒任务'
        open={showWakeupTask}
        onClose={() => { setShowWakeupTask(false) }}
        contentClassName='codex-wakeup-modal'
        footer={
          <>
            <button className='btn' onClick={() => setShowWakeupTask(false)} disabled={wakeupSaving}>关闭</button>
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
              <button type='button' className={`codex-wakeup-segment-btn ${wakeupForm.enabled ? 'active' : ''}`} onClick={() => setWakeupForm(prev => ({ ...prev, enabled: true }))} disabled={wakeupRunning || wakeupSaving}>启用</button>
              <button type='button' className={`codex-wakeup-segment-btn ${!wakeupForm.enabled ? 'active' : ''}`} onClick={() => setWakeupForm(prev => ({ ...prev, enabled: false }))} disabled={wakeupRunning || wakeupSaving}>停用</button>
            </div>
          </div>
          <div className='form-group'>
            <label className='form-label'>调度模式</label>
            <div className='codex-wakeup-segmented'>
              {WAKEUP_SCHEDULE_OPTIONS.map(option => (
                <button type='button' key={option.value} className={`codex-wakeup-segment-btn ${wakeupForm.scheduleKind === option.value ? 'active' : ''}`} onClick={() => setWakeupForm(prev => ({ ...prev, scheduleKind: option.value }))} disabled={wakeupRunning || wakeupSaving}>{option.label}</button>
              ))}
            </div>
          </div>
          {wakeupForm.scheduleKind === 'daily' && (
            <div className='form-group'>
              <label className='form-label'>每日唤醒时间</label>
              <input
                type='time'
                className='form-input'
                style={{ width: 160 }}
                value={wakeupForm.dailyTime || '09:00'}
                onChange={(e) => setWakeupForm(prev => ({ ...prev, dailyTime: e.target.value || '09:00' }))}
                disabled={wakeupRunning || wakeupSaving}
              />
            </div>
          )}
          {wakeupForm.scheduleKind === 'weekly' && (
            <div className='codex-wakeup-grid'>
              <div className='form-group'>
                <label className='form-label'>每周日期</label>
                <div className='codex-wakeup-weekdays'>
                  {WAKEUP_WEEKDAY_OPTIONS.map(option => (
                    <button type='button' key={option.value} className={`codex-wakeup-day-btn ${wakeupForm.weeklyDays.includes(option.value) ? 'active' : ''}`} onClick={() => toggleWakeupWeeklyDay(option.value)} disabled={wakeupRunning || wakeupSaving}>{option.label}</button>
                  ))}
                </div>
              </div>
              <div className='form-group'>
                <label className='form-label'>每周唤醒时间</label>
                <input
                  type='time'
                  className='form-input'
                  style={{ width: 160 }}
                  value={wakeupForm.weeklyTime || '09:00'}
                  onChange={(e) => setWakeupForm(prev => ({ ...prev, weeklyTime: e.target.value || '09:00' }))}
                  disabled={wakeupRunning || wakeupSaving}
                />
              </div>
            </div>
          )}
          {wakeupForm.scheduleKind === 'interval' && (
            <div className='form-group'>
              <label className='form-label'>间隔小时</label>
              <input type='number' min='1' max='24' className='form-input' value={wakeupForm.intervalHours} onChange={(e) => setWakeupForm(prev => ({ ...prev, intervalHours: e.target.value.replace(/[^\d]/g, '') }))} disabled={wakeupRunning || wakeupSaving} />
            </div>
          )}
          {wakeupForm.scheduleKind === 'quota_reset' && (
            <div className='form-group'>
              <label className='form-label'>配额重置窗口</label>
              <select className='form-input' value={wakeupForm.quotaResetWindow} onChange={(e) => setWakeupForm(prev => ({ ...prev, quotaResetWindow: e.target.value }))} disabled={wakeupRunning || wakeupSaving}>
                {WAKEUP_QUOTA_RESET_WINDOW_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className='form-hint'>依赖账号配额中的重置时间；没有重置时间时不会自动触发。</div>
            </div>
          )}
          {wakeupForm.scheduleKind === 'startup' && (
            <div className='form-group'>
              <label className='form-label'>启动后延迟分钟</label>
              <input type='number' min='0' max='1440' className='form-input' value={wakeupForm.startupDelayMinutes} onChange={(e) => setWakeupForm(prev => ({ ...prev, startupDelayMinutes: e.target.value.replace(/[^\d]/g, '') }))} disabled={wakeupRunning || wakeupSaving} />
              <div className='form-hint'>设置为 0 表示插件启动后立即触发；停用后不会执行。</div>
            </div>
          )}
          <div className='form-group'>
            <label className='form-label'>模型</label>
            <select
              className='form-input'
              value={resolveWakeupModelSelectValue(wakeupForm.model, wakeupCustomModelMode)}
              onChange={(e) => {
                const value = e.target.value
                if (value === AG_WAKEUP_CUSTOM_MODEL_VALUE) {
                  setWakeupCustomModelMode(true)
                  setWakeupForm(prev => ({ ...prev, model: isWakeupPresetModel(prev.model) ? '' : String(prev.model || '').trim() }))
                  return
                }
                setWakeupCustomModelMode(false)
                setWakeupForm(prev => ({ ...prev, model: value }))
              }}
              disabled={wakeupRunning || wakeupSaving}
            >
              {AG_WAKEUP_MODEL_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {wakeupCustomModelMode && (
              <input
                className='form-input codex-wakeup-custom-model-input'
                value={wakeupForm.model}
                onChange={(e) => setWakeupForm(prev => ({ ...prev, model: String(e.target.value || '').trim() }))}
                placeholder='例如 gemini-3.1-pro-low'
                disabled={wakeupRunning || wakeupSaving}
              />
            )}
          </div>
          <div className='form-group'>
            <label className='form-label'>提示词</label>
            <textarea
              className='form-textarea codex-wakeup-prompt'
              value={wakeupForm.prompt}
              onChange={(e) => setWakeupForm(prev => ({ ...prev, prompt: e.target.value }))}
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
                      <div className='codex-wakeup-result-message'>{record.success ? (record.reply || '唤醒完成') : formatWakeupErrorMessage(record.error)}</div>
                    </div>
                    <span className='codex-wakeup-result-badge'>{record.success ? '成功' : '失败'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={`codex-wakeup-overview ${wakeupOverview?.latest?.status === 'running' ? 'is-running' : ''}`}>
            {wakeupOverview?.latest?.status === 'running' && <div className='codex-wakeup-progress-bar' />}
            <div className='codex-wakeup-overview-grid'>
              <div><strong>最近结果:</strong> {resolveWakeupLatestSummary(wakeupOverview?.latest, true)}</div>
              <div><strong>最近耗时:</strong> {formatWakeupDuration(wakeupOverview?.latest?.duration_ms)}</div>
              <div><strong>上次执行</strong> {formatWakeupDateTime(wakeupOverview?.latest?.started_at || wakeupOverview?.schedule?.last_run_at)}</div>
              <div><strong>下次触发</strong> {formatWakeupDateTime(wakeupOverview?.next_run_at || wakeupOverview?.schedule?.next_run_at)}</div>
              <div><strong>触发方式</strong> {wakeupOverview?.latest?.trigger_label || '-'}</div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
