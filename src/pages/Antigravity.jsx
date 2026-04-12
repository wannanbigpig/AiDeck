import { useEffect, useMemo, useRef, useState } from 'react'
import QuotaBar from '../components/QuotaBar'
import Modal, { ConfirmModal } from '../components/Modal'
import ExportJsonModal from '../components/ExportJsonModal'
import { useToast } from '../components/Toast'
import { formatDate, truncateEmail, maskText, formatResetTime } from '../utils/format'
import { PlatformIcon } from '../components/Icons/PlatformIcons'
import { usePrivacy } from '../components/PrivacyMode'
import PrivacyToggleButton from '../components/PrivacyToggleButton'
import AutoTip from '../components/AutoTip'
import JsonImportHelp from '../components/JsonImportHelp'
import LocalPendingCard from '../components/LocalPendingCard'
import SpinnerBtnIcon from '../components/SpinnerIcon'
import UsageGuide from '../components/UsageGuide'
import AntigravitySettingsModal from './antigravity/AntigravitySettingsModal'
import { readPendingOAuthSession, writePendingOAuthSession, clearPendingOAuthSession } from '../utils/oauth'
import {
  InfoIcon,
  FingerprintIcon,
  DeviceIdentityIcon,
  TagIcon,
  PlayIcon,
  RefreshIcon,
  UploadIcon,
  TrashIcon,
  SyncIcon,
  ShieldIcon,
  PlusIcon,
  SettingsIcon
} from '../components/Icons/ActionIcons'
import {
  getAntigravityQuotaDisplayItems,
  getAntigravityTierBadge,
  getAvailableAICreditsDisplay,
  DEFAULT_ANTIGRAVITY_SETTINGS,
  normalizeAntigravityAdvancedSettings,
  ANTIGRAVITY_BOOLEAN_SETTING_KEYS,
  ANTIGRAVITY_MODEL_GROUPS
} from '../utils/antigravity'
import { resolveQuotaErrorMeta } from '../utils/codex'
import { getStableCapsuleStyle } from '../utils/capsuleColor'
import { logRequestEvent } from '../utils/requestLogClient'
import { coerceBooleanSetting } from '../utils/globalSettings'

const ANTIGRAVITY_SETTINGS_KEY = 'antigravity_advanced_settings'

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

function truncateMiddleText(value, head = 14, tail = 8) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.length <= head + tail + 1) return text
  return text.slice(0, head) + '...' + text.slice(-tail)
}

function getQuotaRefreshIssueMessage(result) {
  if (!result || typeof result !== 'object') return ''
  const direct = String(result.error || result.warning || result?.quota_error?.message || '').trim()
  if (direct) return direct
  const msg = String(result.message || '').trim()
  if (msg.includes('未获取到') || msg.includes('暂无配额')) return msg
  return ''
}

function getAntigravityDeviceIdentityMeta(account) {
  const profile = account && account.device_profile && typeof account.device_profile === 'object'
    ? account.device_profile
    : null
  const sourceKey = String(account?.device_profile_source || '').trim().toLowerCase()
  const sourceMap = {
    captured: '本地捕获',
    generated: '自动生成',
    imported: '导入继承'
  }
  return {
    profile,
    sourceKey,
    sourceLabel: sourceMap[sourceKey] || (profile ? '已绑定' : '未绑定')
  }
}

function getAntigravityDeviceIdentityDisplay(account, isPrivacyMode) {
  const { profile, sourceLabel } = getAntigravityDeviceIdentityMeta(account)
  if (!profile) {
    return { text: '未绑定', displayText: '未绑定' }
  }

  const machineIdRaw = String(profile.machine_id || '').trim()
  const serviceMachineIdRaw = String(profile.service_machine_id || '').trim()
  const machineId = isPrivacyMode ? maskText(machineIdRaw || '-', 'id') : truncateMiddleText(machineIdRaw || '-', 16, 8)
  const serviceMachineId = isPrivacyMode ? maskText(serviceMachineIdRaw || '-', 'id') : truncateMiddleText(serviceMachineIdRaw || '-', 8, 6)
  const rawText = sourceLabel + ' | ' + (machineIdRaw || '-') + (serviceMachineIdRaw ? (' · ' + serviceMachineIdRaw) : '')
  const displayText = sourceLabel + ' | ' + machineId + (serviceMachineIdRaw ? (' · ' + serviceMachineId) : '')

  return {
    text: rawText,
    displayText
  }
}

function readAntigravityAdvancedSettings() {
  try {
    if (window.utools) {
      const saved = window.utools.dbStorage.getItem(ANTIGRAVITY_SETTINGS_KEY)
      return normalizeAntigravityAdvancedSettings(saved)
    }
    const raw = localStorage.getItem(ANTIGRAVITY_SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      return normalizeAntigravityAdvancedSettings(saved)
    }
  } catch (e) { }
  return normalizeAntigravityAdvancedSettings(null)
}



/**
 * Antigravity 账号管理页
 */
export default function Antigravity({ onRefresh, onActivity, searchQuery = '' }) {
  const [accounts, setAccounts] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addTab, setAddTab] = useState('oauth')
  const [importJson, setImportJson] = useState('')
  const [refreshTokenInput, setRefreshTokenInput] = useState('')
  const [oauthSessionId, setOauthSessionId] = useState('')
  const [oauthAuthUrl, setOauthAuthUrl] = useState('')
  const [oauthRedirectUri, setOauthRedirectUri] = useState('')
  const [oauthCallbackInput, setOauthCallbackInput] = useState('')
  const [oauthPreparing, setOauthPreparing] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthPolling, setOauthPolling] = useState(false)
  const [oauthPrepareError, setOauthPrepareError] = useState('')
  const [oauthUrlCopied, setOauthUrlCopied] = useState(false)
  const [oauthRecovered, setOauthRecovered] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importingLocal, setImportingLocal] = useState(false)
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)
  const [advancedSettings, setAdvancedSettings] = useState(() => readAntigravityAdvancedSettings())
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [detailAccount, setDetailAccount] = useState(null)
  const [tagEditor, setTagEditor] = useState({ id: '', value: '' })
  const [batchTagEditor, setBatchTagEditor] = useState({ open: false, value: '' })
  const [refreshingIds, setRefreshingIds] = useState(new Set())
  const [localImportHint, setLocalImportHint] = useState({ visible: false, email: '' })
  const [exportDialog, setExportDialog] = useState({ open: false, json: '', count: 0 })
  const autoRefreshRunningRef = useRef(false)
  const oauthPollTimerRef = useRef(null)
  const toast = useToast()

  const svc = window.services?.antigravity

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

  function stopOAuthPolling() {
    if (oauthPollTimerRef.current) {
      clearInterval(oauthPollTimerRef.current)
      oauthPollTimerRef.current = null
    }
    setOauthPolling(false)
  }

  function startOAuthPolling(sessionId) {
    const sid = (sessionId || '').trim()
    if (!sid || !svc || typeof svc.getOAuthSessionStatus !== 'function') return

    stopOAuthPolling()
    setOauthPolling(true)

    let checking = false
    oauthPollTimerRef.current = setInterval(async () => {
      if (checking) return
      checking = true
      try {
        const status = await Promise.resolve(svc.getOAuthSessionStatus(sid))
        if (!status || !status.success) {
          if (status && status.status === 'missing') {
            stopOAuthPolling()
          }
          return
        }
        if (status.status === 'completed') {
          stopOAuthPolling()
          await completeOAuthBySession(sid, '', 'auto')
        }
      } catch (e) {
      } finally {
        checking = false
      }
    }, 1200)
  }

  async function restorePendingOAuthSession() {
    const pending = readPendingOAuthSession('antigravity')
    if (!pending || typeof pending !== 'object') return false
    if (!pending.sessionId || !pending.authUrl) {
      clearPendingOAuthSession('antigravity')
      return false
    }

    const createdAt = typeof pending.createdAt === 'number' ? pending.createdAt : 0
    if (createdAt && Date.now() - createdAt > 10 * 60 * 1000) {
      clearPendingOAuthSession('antigravity')
      return false
    }

    const sid = (pending.sessionId || '').trim()
    if (!sid) {
      clearPendingOAuthSession('antigravity')
      return false
    }

    if (svc && typeof svc.getOAuthSessionStatus === 'function') {
      try {
        const status = await Promise.resolve(svc.getOAuthSessionStatus(sid))
        if (!status || !status.success) {
          clearPendingOAuthSession('antigravity')
          return false
        }
      } catch (e) {
        clearPendingOAuthSession('antigravity')
        return false
      }
    }

    setOauthSessionId(sid)
    setOauthAuthUrl(pending.authUrl || '')
    setOauthRedirectUri(pending.redirectUri || '')
    setShowAddModal(true)
    setAddTab('oauth')
    setOauthRecovered(true)
    startOAuthPolling(sid)
    return true
  }

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    if (!svc || typeof svc.syncCurrentFromLocal !== 'function') return
    let syncing = false
    let disposed = false

    const syncCurrent = async () => {
      if (disposed || syncing) return
      syncing = true
      try {
        const result = await Promise.resolve(svc.syncCurrentFromLocal({
          autoImport: false
        }))
        if (result && result.success && result.changed) {
          refresh()
        }
        await refreshLocalImportHint()
      } catch (e) {
      } finally {
        syncing = false
      }
    }

    const onLocalStateChange = (event) => {
      const platform = String(event?.detail?.platform || '').trim().toLowerCase()
      if (platform && platform !== 'antigravity' && platform !== 'all') return
      void syncCurrent()
    }

    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      window.addEventListener('aideck:local-state-change', onLocalStateChange)
    }

    void syncCurrent()

    return () => {
      disposed = true
      if (typeof window !== 'undefined' && window && typeof window.removeEventListener === 'function') {
        window.removeEventListener('aideck:local-state-change', onLocalStateChange)
      }
    }
  }, [svc])

  useEffect(() => {
    return () => {
      stopOAuthPolling()
    }
  }, [])

  useEffect(() => {
    void restorePendingOAuthSession()
  }, [])

  useEffect(() => {
    const existing = new Set(accounts.map(a => a.id))
    setSelectedIds(prev => {
      const next = new Set(Array.from(prev).filter(id => existing.has(id)))
      return next
    })
  }, [accounts])

  const selectedCount = selectedIds.size

  const visibleAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return accounts
      .filter(acc => {
        if (!q) return true
        return `${acc.email || ''} ${acc.username || ''} ${acc.name || ''} ${acc.id || ''} ${(acc.tags || []).join(' ')}`
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => {
        const aCurrent = a.id === currentId ? 1 : 0
        const bCurrent = b.id === currentId ? 1 : 0
        if (bCurrent !== aCurrent) return bCurrent - aCurrent
        return (b.created_at || 0) - (a.created_at || 0)
      })
  }, [accounts, currentId, searchQuery])

  function refresh() {
    if (!svc) return
    setAccounts(svc.list())
    const cur = svc.getCurrent()
    setCurrentId(cur?.id || null)
    void refreshLocalImportHint()
    onRefresh?.()
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

  async function copyText(text) {
    const val = String(text || '').trim()
    if (!val) return false
    try {
      if (window.utools) {
        window.utools.copyText(val)
        return true
      }
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(val)
        return true
      }
    } catch (e) { }
    return false
  }

  function handleToggleSelect(accountId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
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
          const refreshed = await Promise.resolve(svc.refreshQuota(acc.id))
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
        const refreshed = await Promise.resolve(svc.refreshQuota(acc.id))
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

    const quotaRefreshed = await Promise.resolve(svc.refreshQuota(account.id))
    toast.success(`已添加账号: ${account.email || account.id}`)
    const quotaRefreshIssue = getQuotaRefreshIssueMessage(quotaRefreshed)
    if (quotaRefreshIssue) {
      toast.warning(`首次刷新配额失败: ${quotaRefreshIssue}`)
    }
    onActivity?.(`Token 添加 Antigravity 账号 -> ${account.email || account.id}`)
    closeAddModal()
    refresh()
  }

  async function prepareOAuthSession() {
    if (!svc || typeof svc.prepareOAuthSession !== 'function') {
      setOauthPrepareError('当前版本不支持 OAuth 授权')
      return null
    }

    setOauthPreparing(true)
    setOauthPrepareError('')
    try {
      const result = await Promise.resolve(svc.prepareOAuthSession())
      if (!result || !result.success || !result.session) {
        const errMsg = (result && result.error) || '生成授权链接失败'
        setOauthPrepareError(errMsg)
        return null
      }

      const session = result.session
      setOauthSessionId(session.sessionId || '')
      setOauthAuthUrl(session.authUrl || '')
      setOauthRedirectUri(session.redirectUri || '')
      setOauthCallbackInput('')
      setOauthUrlCopied(false)
      setOauthRecovered(false)
      startOAuthPolling(session.sessionId || '')
      writePendingOAuthSession('antigravity', {
        sessionId: session.sessionId || '',
        authUrl: session.authUrl || '',
        redirectUri: session.redirectUri || '',
        createdAt: Date.now()
      })
      return session
    } catch (e) {
      const msg = e?.message || String(e)
      setOauthPrepareError(msg)
      return null
    } finally {
      setOauthPreparing(false)
    }
  }

  async function handleCopyOAuthUrl() {
    if (!oauthAuthUrl) return
    const ok = await copyText(oauthAuthUrl)
    if (!ok) {
      toast.warning('复制失败，请手动复制链接')
      return
    }
    setOauthUrlCopied(true)
    toast.success('授权链接已复制')
  }

  async function handleOpenOAuthInBrowser() {
    let authUrl = oauthAuthUrl
    let sid = oauthSessionId

    if (sid && svc && typeof svc.getOAuthSessionStatus === 'function') {
      try {
        const status = await Promise.resolve(svc.getOAuthSessionStatus(sid))
        if (!status || !status.success || status.status === 'missing') {
          clearPendingOAuthSession('antigravity')
          stopOAuthPolling()
          setOauthSessionId('')
          setOauthAuthUrl('')
          setOauthRedirectUri('')
          setOauthRecovered(false)
          const prepared = await prepareOAuthSession()
          authUrl = prepared?.authUrl || ''
          sid = prepared?.sessionId || ''
        } else if (status.status === 'completed') {
          await completeOAuthBySession(sid, '', 'auto')
          return
        } else {
          startOAuthPolling(sid)
        }
      } catch {
      }
    }

    if (!authUrl) {
      const prepared = await prepareOAuthSession()
      authUrl = prepared?.authUrl || ''
      sid = prepared?.sessionId || ''
    }

    if (!authUrl) {
      toast.error(oauthPrepareError || '授权链接未就绪')
      return
    }

    if (!svc || typeof svc.openExternalUrl !== 'function') {
      const copied = await copyText(authUrl)
      if (copied) {
        toast.info('当前环境不支持自动打开，已复制链接')
      } else {
        toast.warning('当前环境不支持自动打开，请手动复制')
      }
      return
    }

    const opened = await Promise.resolve(svc.openExternalUrl(authUrl))
    if (!opened || !opened.success) {
      const copied = await copyText(authUrl)
      if (copied) {
        toast.warning((opened && opened.error) ? opened.error + '，已复制授权链接' : '打开浏览器失败，已复制授权链接')
      } else {
        toast.error((opened && opened.error) || '打开浏览器失败')
      }
      return
    }

    if (sid) {
      startOAuthPolling(sid)
    }
    toast.success('已在浏览器打开 Antigravity OAuth 页面')
  }

  async function completeOAuthBySession(sessionId, callbackUrl, source = 'manual') {
    const sid = (sessionId || '').trim()
    const callback = (callbackUrl || '').trim()

    if (!sid) {
      if (source === 'manual') toast.warning('授权会话不存在，请先生成授权链接')
      return false
    }
    if (!callback && source === 'manual') {
      toast.warning('请粘贴完整回调地址')
      return false
    }
    if (!svc || typeof svc.completeOAuthSession !== 'function') {
      toast.error('当前版本不支持 OAuth 回调提交')
      return false
    }

    setOauthBusy(true)
    try {
      const result = await svc.completeOAuthSession(sid, callback)
      if (!result || !result.success || !result.account) {
        const err = (result && result.error) || 'OAuth 授权失败'
        if (err.includes('会话不存在') || err.includes('已过期')) {
          stopOAuthPolling()
          clearPendingOAuthSession('antigravity')
          setOauthSessionId('')
          setOauthRecovered(false)
        }
        if (source === 'auto') {
          setOauthPrepareError(err)
        } else {
          toast.error(err)
        }
        return false
      }

      const account = result.account
      stopOAuthPolling()
      clearPendingOAuthSession('antigravity')
      setOauthRecovered(false)
      toast.success(`OAuth 授权成功: ${account.email || account.id}`)
      if (result.quotaRefreshError) {
        toast.warning(`账号已添加，但首次刷新配额失败: ${result.quotaRefreshError}`)
      }
      onActivity?.(`OAuth 添加 Antigravity 账号 -> ${account.email || account.id}`)
      closeAddModal()
      refresh()
      return true
    } catch (e) {
      const message = 'OAuth 授权失败: ' + (e?.message || String(e))
      if (source === 'auto') {
        setOauthPrepareError(message)
      } else {
        toast.error(message)
      }
      return false
    } finally {
      setOauthBusy(false)
    }
  }

  async function handleSubmitOAuthCallback() {
    await completeOAuthBySession(oauthSessionId, oauthCallbackInput, 'manual')
  }

  function handleSwitchAddTab(nextTab) {
    setAddTab(nextTab)
    if (nextTab === 'oauth' && !oauthSessionId && !oauthPreparing) {
      void (async () => {
        const restored = await restorePendingOAuthSession()
        if (!restored) {
          await prepareOAuthSession()
        }
      })()
    }
  }

  function openAddModal(initialTab = 'oauth') {
    setShowAddModal(true)
    setAddTab(initialTab)
    setImportJson('')
    setRefreshTokenInput('')
    setOauthCallbackInput('')
    setOauthPrepareError('')
    setOauthUrlCopied(false)
    setOauthRecovered(false)

    if (initialTab === 'oauth') {
      void (async () => {
        const restored = await restorePendingOAuthSession()
        if (!restored) {
          await prepareOAuthSession()
        }
      })()
    } else {
      stopOAuthPolling()
      setOauthSessionId('')
      setOauthAuthUrl('')
      setOauthRedirectUri('')
    }
  }

  function closeAddModal() {
    if (oauthSessionId && svc && typeof svc.cancelOAuthSession === 'function') {
      try {
        svc.cancelOAuthSession(oauthSessionId)
      } catch (e) { }
    }
    stopOAuthPolling()
    clearPendingOAuthSession('antigravity')
    setShowAddModal(false)
    setAddTab('oauth')
    setImportJson('')
    setRefreshTokenInput('')
    setOauthSessionId('')
    setOauthAuthUrl('')
    setOauthRedirectUri('')
    setOauthCallbackInput('')
    setOauthPrepareError('')
    setOauthUrlCopied(false)
    setOauthPreparing(false)
    setOauthBusy(false)
    setOauthRecovered(false)
  }

  async function handleSwitch(id) {
    const result = await Promise.resolve(svc.switchAccount(id, {
      switchDeviceIdentity: coerceBooleanSetting(advancedSettings.switchDeviceIdentity, true)
    }))
    if (result.success) {
      toast.success('切换成功')
      if (result.warning) {
        toast.info(result.warning)
      }
      onActivity?.(`Antigravity 切换账号 -> ${id}`)
      refresh()
    } else {
      toast.error(result.error || '切换失败')
    }
  }

  function handleDelete(id) {
    svc.deleteAccount(id)
    toast.success('已删除')
    setConfirmDelete(null)
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
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
    setSelectedIds(new Set())
    refresh()
  }

  async function handleRefreshQuota(id) {
    if (loading || autoRefreshRunningRef.current) return
    if (refreshingIds.has(id)) return
    setRefreshingIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    try {
      const result = await Promise.resolve(svc.refreshQuota(id))
      const issue = getQuotaRefreshIssueMessage(result)
      if (issue) {
        toast.warning(issue)
      } else if (result && result.message) {
        toast.info(result.message)
      } else {
        toast.success('配额已刷新')
      }
      refresh()
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  function getQuotaPercentageMap(account) {
    const items = getAntigravityQuotaDisplayItems(account?.quota, { aggregated: true })
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

    const result = await Promise.resolve(svc.switchAccount(next.id, {
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
    if (autoRefreshRunningRef.current) return
    const { silent = false, source = 'manual' } = opts

    autoRefreshRunningRef.current = true
    const BATCH_ID = 'antigravity-batch-refresh'
    try {
      if (!silent) {
        setLoading(true)
        toast.upsert(BATCH_ID, '准备刷新 Antigravity 配额...', 'info', 0)
      }
      const latestAccounts = svc.list() || []
      const total = latestAccounts.length
      const failures = []
      logRequestEvent('antigravity.batch-refresh', '开始批量刷新配额', {
        source,
        silent,
        total
      })
      for (let i = 0; i < total; i++) {
        const progress = Math.round(((i + 1) / total) * 100)
        if (!silent) {
          toast.upsert(BATCH_ID, `正在刷新 Antigravity 配额 (${i + 1}/${total})...`, 'info', progress)
        }
        const result = await Promise.resolve(svc.refreshQuota(latestAccounts[i].id))
        const issue = getQuotaRefreshIssueMessage(result)
        if (issue) {
          failures.push({
            email: latestAccounts[i].email || latestAccounts[i].id,
            error: issue
          })
        }
      }
      refresh()
      await maybeAutoSwitchAfterQuotaRefresh(source)
      logRequestEvent('antigravity.batch-refresh', '批量刷新配额完成', {
        source,
        silent,
        total,
        failures: failures.length
      }, failures.length > 0 ? 'warn' : 'info')
      if (!silent) {
        if (failures.length > 0) {
          const first = failures[0]
          toast.warning(`其中 ${failures.length} 个账号刷新失败：${first.email} - ${first.error}`)
        } else {
          toast.success('全部账号配额刷新完成')
        }
      }
    } catch (e) {
      if (!silent) {
        toast.error('批量刷新失败: ' + (e?.message || String(e)))
      }
      logRequestEvent('antigravity.batch-refresh', '批量刷新配额异常', {
        source,
        silent,
        error: e?.message || String(e)
      }, 'error')
    } finally {
      autoRefreshRunningRef.current = false
      if (!silent) {
        setLoading(false)
        setTimeout(() => toast.remove(BATCH_ID), 1000)
      }
    }
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
    setExportDialog({ open: true, json, count: picked.length })
  }

  function closeExportDialog() {
    setExportDialog(prev => ({ ...prev, open: false }))
  }

  async function handleCopyExportJson() {
    const content = String(exportDialog.json || '')
    if (!content) {
      toast.warning('暂无可导出的 JSON 内容')
      return
    }
    const ok = await copyText(content)
    if (ok) toast.success('已复制到剪贴板')
    else toast.warning('复制失败，请手动复制')
  }

  function handleDownloadExportJson() {
    const content = String(exportDialog.json || '')
    if (!content) {
      toast.warning('暂无可导出的 JSON 内容')
      return
    }
    try {
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      const link = document.createElement('a')
      link.href = url
      link.download = `antigravity-accounts-${stamp}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success('已开始下载 JSON 文件')
    } catch (e) {
      toast.warning('下载失败，请先复制再手动保存')
    }
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
    setBatchTagEditor({ open: false, value: '' })
    toast.success(`已更新 ${ids.length} 个账号标签`)
    refresh()
  }

  async function handleCopyAccountId(account) {
    const ok = await copyText(account.id)
    if (ok) toast.success('账号 ID 已复制')
    else toast.warning('复制失败')
  }

  useEffect(() => {
    const minutes = Number(advancedSettings.autoRefreshMinutes)
    if (!minutes || minutes <= 0) return
    const timer = setInterval(() => {
      void refreshAllQuotas({ silent: true, source: 'auto-refresh' })
    }, minutes * 60 * 1000)
    return () => clearInterval(timer)
  }, [advancedSettings.autoRefreshMinutes])

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
          <h1 className='page-title'><PlatformIcon platform="antigravity" size={24} /> Antigravity</h1>
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
                <button className='action-bar-btn' onClick={() => setBatchTagEditor({ open: true, value: '' })} data-tip='批量设置标签'>
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

      <UsageGuide
        platform='Antigravity'
        title='Antigravity 账号管理说明'
        description='支持读取默认本地运行态中的当前 Antigravity 登录账号，也支持粘贴 Token/JSON 或 OAuth 授权登录。卡片中的模型配额与可用 AI 积分均来自官方运行态；模型配额会按套餐周期自动重置，启用 AI Credit Overages 后会在模型配额耗尽时继续消耗 AI 积分。'
        permissions={[
          '读取并写入 `~/.ai_deck/antigravity/token.json`，用于存储当前切换到的运行态凭证。',
          '读取并写入本地官方客户端默认位置中的 `storage.json`、`machineid` 与 `state.vscdb`，用于导入当前本地登录账号并在启用“更换设备身份”时同步设备指纹。'
        ]}
        network={[
          'OAuth 与凭证授权会调用 Google 官方接口（`accounts.google.com`、`oauth2.googleapis.com`）。',
          '配额查询会调用 Google Cloud Code 内部接口（`cloudcode-pa.googleapis.com`），仅发送必要的认证字段。'
        ]}
      />

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
                svc={svc}
                isCurrent={account.id === currentId}
                isSelected={selectedIds.has(account.id)}
                refreshingIds={refreshingIds}
                globalLoading={loading}
                onToggleSelect={() => handleToggleSelect(account.id)}
                onSwitch={() => handleSwitch(account.id)}
                onRefresh={() => handleRefreshQuota(account.id)}
                onDelete={() => setConfirmDelete(account.id)}
                onShowDetails={() => setDetailAccount(account)}
                onEditTags={() => handleOpenTagEditor(account)}
                onExport={() => handleExport([account.id])}
                onCopyId={() => handleCopyAccountId(account)}
              />
            ))}
          </div>
        )}

      <Modal
        title='添加 Antigravity 账号'
        open={showAddModal}
        onClose={closeAddModal}
      >
        <div className='oauth-tab-switch'>
          <button
            className={`oauth-tab-btn ${addTab === 'oauth' ? 'active' : ''}`}
            onClick={() => handleSwitchAddTab('oauth')}
          >
            🌐 OAuth 授权
          </button>
          <button
            className={`oauth-tab-btn ${addTab === 'token' ? 'active' : ''}`}
            onClick={() => handleSwitchAddTab('token')}
          >
            🔑 Token / JSON
          </button>
          <button
            className={`oauth-tab-btn ${addTab === 'local' ? 'active' : ''}`}
            onClick={() => handleSwitchAddTab('local')}
          >
            💾 本地导入
          </button>
        </div>

        {addTab === 'oauth' && (
          <>
            <div className='form-group'>
              <label className='form-label'>授权链接</label>
              <div className='oauth-row'>
                <input
                  className='form-input'
                  readOnly
                  value={oauthAuthUrl}
                  placeholder={oauthPreparing ? '正在准备授权链接...' : '点击“重新生成授权链接”创建新的 OAuth 授权地址'}
                />
                <button className='btn btn-icon' onClick={handleCopyOAuthUrl} disabled={!oauthAuthUrl}>
                  {oauthUrlCopied ? '✅' : '📋'}
                </button>
              </div>
            </div>

            {oauthPrepareError && (
              <div className='oauth-error'>{oauthPrepareError}</div>
            )}

            <div className='oauth-action-row'>
              <button className='btn btn-primary' disabled={oauthPreparing || !oauthAuthUrl} onClick={handleOpenOAuthInBrowser}>
                🌐 在浏览器中打开
              </button>
              <button className='btn' disabled={oauthPreparing} onClick={() => void prepareOAuthSession()}>
                {oauthPreparing ? '准备中...' : '🔄 重新生成授权链接'}
              </button>
            </div>

            <div className='form-group' style={{ marginTop: 12 }}>
              <label className='form-label'>手动输入回调地址</label>
              <div className='oauth-row oauth-row-callback'>
                <input
                  className='form-input'
                  value={oauthCallbackInput}
                  onChange={(e) => setOauthCallbackInput(e.target.value)}
                  placeholder={oauthRedirectUri ? `粘贴完整回调地址，例如：${oauthRedirectUri}?code=...&state=...` : '粘贴完整回调地址，例如：http://localhost:1456/auth/callback?...'}
                />
                <button
                  className='btn btn-primary'
                  disabled={oauthBusy || !oauthSessionId || !oauthCallbackInput.trim()}
                  onClick={() => void handleSubmitOAuthCallback()}
                >
                  {oauthBusy ? '提交中...' : '提交回调'}
                </button>
              </div>
            </div>

            <div className='oauth-hint'>
              {oauthRecovered ? '已恢复上次未完成的 OAuth 会话，可直接继续提交回调。' : ''}
              {oauthRecovered ? <br /> : null}
              {oauthPolling ? '正在等待浏览器自动回调...' : ''}
              {oauthPolling ? <br /> : null}
              完成浏览器授权后，将完整回调地址粘贴到这里即可继续。
            </div>
          </>
        )}

        {addTab === 'token' && (
          <>
            <div className='form-group'>
              <label className='form-label'>手动添加 refresh_token</label>
              <input
                className='form-input'
                placeholder='refresh_token'
                value={refreshTokenInput}
                onChange={(e) => setRefreshTokenInput(e.target.value)}
              />
              <div className='oauth-action-row' style={{ marginTop: 10 }}>
                <button className='btn btn-primary' onClick={handleAddWithToken}>
                  添加 Token 账号
                </button>
              </div>
            </div>

            <div className='oauth-divider'>或粘贴 JSON 导入</div>

            <div className='form-group' style={{ marginBottom: 0 }}>
              <label className='form-label'>账号 JSON 数据</label>
              <textarea
                className='form-textarea'
                placeholder='[{"email":"...","token":{"access_token":"...","refresh_token":"..."}}]'
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
              />
              <JsonImportHelp
                requiredText={ANTIGRAVITY_JSON_IMPORT_REQUIRED_TEXT}
                example={ANTIGRAVITY_JSON_IMPORT_EXAMPLE}
              />
              <div className='oauth-action-row' style={{ marginTop: 10 }}>
                <button className='btn btn-primary' onClick={handleImportJson}>
                  导入 JSON
                </button>
              </div>
            </div>
          </>
        )}

        {addTab === 'local' && (
          <>
            <div className='form-group' style={{ marginBottom: 0 }}>
              <label className='form-label'>从本地数据库导入</label>
              <div className='oauth-hint' style={{ marginBottom: 10 }}>
                读取本机 Antigravity 客户端登录账号（`state.vscdb`）。
              </div>
              <div className='oauth-action-row'>
                <button
                  className='btn btn-primary'
                  onClick={() => handleImportLocal({ closeAfter: true })}
                  disabled={importingLocal}
                >
                  {importingLocal ? '导入中...' : '💾 从本地数据库导入'}
                </button>
              </div>
            </div>
          </>
        )}

      </Modal>

      {/* 标签编辑 */}
      <Modal
        title='编辑账号标签'
        open={!!tagEditor.id}
        onClose={() => setTagEditor({ id: '', value: '' })}
        footer={
          <>
            <button className='btn' onClick={() => setTagEditor({ id: '', value: '' })}>取消</button>
            <button className='btn btn-primary' onClick={handleSaveTags}>保存</button>
          </>
        }
      >
        <div className='form-group'>
          <label className='form-label'>标签（英文逗号分隔）</label>
          <input
            className='form-input'
            value={tagEditor.value}
            onChange={(e) => setTagEditor(prev => ({ ...prev, value: e.target.value }))}
            placeholder='例如: 工作号, 主力, 高余额'
          />
        </div>
      </Modal>

      <Modal
        title='批量设置标签'
        open={batchTagEditor.open}
        onClose={() => setBatchTagEditor({ open: false, value: '' })}
        footer={
          <>
            <button className='btn' onClick={() => setBatchTagEditor({ open: false, value: '' })}>取消</button>
            <button className='btn btn-primary' onClick={handleSaveBatchTags}>保存</button>
          </>
        }
      >
        <div className='form-group'>
          <label className='form-label'>已选 {selectedCount} 个账号，标签使用逗号分隔</label>
          <input
            className='form-input'
            value={batchTagEditor.value}
            onChange={(e) => setBatchTagEditor(prev => ({ ...prev, value: e.target.value }))}
            placeholder='例如: 主力, 低风险, 备用'
          />
        </div>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        title='绑定设备身份'
        open={!!detailAccount}
        onClose={() => setDetailAccount(null)}
      >
        {detailAccount && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              ['账号', detailAccount.email || detailAccount.id || '-', false],
              ['来源', detailDeviceMeta.sourceLabel, false],
              ['状态', detailDeviceMeta.profile ? '已绑定' : '未绑定', false]
            ].map(([label, value, mono]) => (
              <div
                key={label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px minmax(0, 1fr)',
                  alignItems: 'start',
                  gap: 18
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.6, wordBreak: 'break-word' }}>
                  {label}
                </div>
                <div
                  style={{
                    fontSize: label === '账号' ? 14 : 13,
                    color: 'var(--text-primary)',
                    fontWeight: label === '账号' ? 600 : 500,
                    fontFamily: mono ? 'SFMono-Regular, Consolas, monospace' : 'inherit',
                    lineHeight: 1.6,
                    wordBreak: 'break-all'
                  }}
                >
                  {String(value || '-')}
                </div>
              </div>
            ))}

            {detailDeviceMeta.profile
              ? detailDeviceFields.map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '180px minmax(0, 1fr)',
                    alignItems: 'start',
                    gap: 18
                  }}
                >
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.6, wordBreak: 'break-word' }}>
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      fontFamily: 'SFMono-Regular, Consolas, monospace',
                      lineHeight: 1.6,
                      wordBreak: 'break-all'
                    }}
                  >
                    {String(value || '-')}
                  </div>
                </div>
              ))
              : (
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    lineHeight: 1.7
                  }}
                >
                  当前账号尚未绑定设备身份。开启“切号时更换设备身份”后执行一次切号，或重新导入账号，即可为该账号建立绑定。
                </div>
              )}
          </div>
        )}
      </Modal>

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
        onCopy={handleCopyExportJson}
        onDownload={handleDownloadExportJson}
      />
    </div>
  )
}



function AntigravityAccountItem({
  account,
  quotaAggregatedDisplay,
  isCurrent,
  isSelected,
  refreshingIds,
  globalLoading,
  onToggleSelect,
  onSwitch,
  onRefresh,
  onDelete,
  onShowDetails,
  onEditTags,
  onExport,
  onCopyId
}) {
  const { isPrivacyMode } = usePrivacy()
  const [switching, setSwitching] = useState(false)

  const tierBadge = getAntigravityTierBadge(account.quota)
  const quotaItems = (() => {
    const grouped = getAntigravityQuotaDisplayItems(account.quota, { aggregated: quotaAggregatedDisplay })
    if (grouped.length > 0) return grouped

    const q = account.quota || {}
    const legacy = []
    if (typeof q.hourly_percentage === 'number') {
      legacy.push({
        key: 'hourly',
        label: '5小时',
        percentage: q.hourly_percentage,
        resetTime: q.hourly_reset_time,
        requestsLeft: q.hourly_requests_left,
        requestsLimit: q.hourly_requests_limit
      })
    }
    if (typeof q.weekly_percentage === 'number') {
      legacy.push({
        key: 'weekly',
        label: '每周',
        percentage: q.weekly_percentage,
        resetTime: q.weekly_reset_time,
        requestsLeft: q.weekly_requests_left,
        requestsLimit: q.weekly_requests_limit
      })
    }
    if (typeof q.code_review_percentage === 'number') {
      legacy.push({
        key: 'cr',
        label: '代码审查',
        percentage: q.code_review_percentage,
        resetTime: q.code_review_reset_time,
        requestsLeft: q.code_review_requests_left,
        requestsLimit: q.code_review_requests_limit
      })
    }
    return legacy
  })()
  const creditsDisplay = getAvailableAICreditsDisplay(account.quota)
  const cardDate = formatDate(account.last_used || account.created_at)

  const handleRefreshWrap = async () => {
    await Promise.resolve(onRefresh())
  }

  const handleSwitchWrap = async () => {
    if (switching || isCurrent) return
    setSwitching(true)
    try {
      await Promise.resolve(onSwitch())
    } finally {
      setSwitching(false)
    }
  }

  const quotaErrorMeta = resolveQuotaErrorMeta(account.quota_error, account.quota?.error || '')
  const hasQuotaError = Boolean(quotaErrorMeta.rawMessage)
  const isDeactivated = quotaErrorMeta.disabled
  const showQuotaErrorOnFront = hasQuotaError && !isDeactivated
  const isInvalid = Boolean(isDeactivated || account.invalid || account.quota?.invalid)
  const statusLabels = isDeactivated ? '已停用' : '已失效'
  const statusText = isInvalid ? '无效' : (hasQuotaError ? '配额异常' : (isCurrent ? '当前激活' : '有效'))
  const statusColor = (isInvalid || hasQuotaError) ? '#ef4444' : (isCurrent ? 'var(--accent-green)' : 'var(--text-secondary)')
  const deviceIdentityDisplay = getAntigravityDeviceIdentityDisplay(account, isPrivacyMode)
  const tagList = Array.isArray(account.tags)
    ? account.tags.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const tagTip = tagList.length > 0 ? tagList.join(', ') : '暂无标签'
  const tagPills = tagList.slice(0, 3)
  const hasMoreTags = tagList.length > tagPills.length
  const isRefreshBusy = globalLoading || refreshingIds.has(account.id)
  const [flipped, setFlipped] = useState(false)



  const handleRefreshWrapWithEvent = async (e) => {
    e.stopPropagation()
    handleRefreshWrap()
  }

  const handleSwitchWrapWithEvent = async (e) => {
    e.stopPropagation()
    handleSwitchWrap()
  }

  const handleDeleteWrap = (e) => {
    e.stopPropagation()
    onDelete()
  }

  return (
    <div className={`account-card-container ${isCurrent ? 'current' : ''} ${isInvalid ? 'status-invalid' : ''} ${hasQuotaError ? 'status-quota-error' : ''} ${isSelected ? 'ag-selected' : ''}`}>
      <div className={`account-card-inner ${flipped ? 'flipped' : ''}`}>

        {/* ====== 翻转卡片：正面 ====== */}
        <div className='account-card-front account-card' onClick={() => setFlipped(true)} style={{ cursor: 'pointer' }}>
          <div className='account-card-row'>
            <label className='ag-checkbox-wrap' onClick={(e) => e.stopPropagation()}>
              <input type='checkbox' checked={isSelected} onChange={onToggleSelect} />
              <span className='ag-checkbox-ui' />
            </label>

            <span className='account-email'>{isPrivacyMode ? maskText(account.email, 'email') : truncateEmail(account.email, 28)}</span>

            {isCurrent && <span className='badge badge-active'>当前</span>}
            {showQuotaErrorOnFront && <span className='codex-status-pill quota-error'>配额异常</span>}
            {isInvalid && <span className='badge badge-danger'>{statusLabels}</span>}
            {tierBadge.label && <span className={`badge ag-tier-badge ${tierBadge.className}`}>{tierBadge.label}</span>}
          </div>

          <div className='account-card-quota'>
            {quotaItems.length > 0
              ? quotaItems.map((item) => (
                <QuotaBar
                  key={item.key}
                  percentage={item.percentage}
                  label={item.label}
                  resetTime={item.resetTime ? formatResetTime(item.resetTime) : ''}
                  requestsLeft={item.requestsLeft}
                  requestsLimit={item.requestsLimit}
                />
              ))
              : <div className='quota-empty-placeholder'>暂无配额数据</div>}

            {creditsDisplay && (
              <div className='ag-credits-line' style={{ fontSize: 12, color: 'var(--text-secondary)' }}>可用 AI 积分: {creditsDisplay}</div>
            )}
          </div>

          <div className='account-card-divider' />
          <div className='account-actions' style={{ justifyContent: 'flex-end', gap: 2, color: 'var(--text-secondary)' }}>
            <button className='action-icon-btn' onClick={(e) => { e.stopPropagation(); onShowDetails?.() }}>
              <span className="action-icon-tip">查看绑定设备身份</span>
              <DeviceIdentityIcon size={16} />
            </button>

            <button className={`action-icon-btn ${isRefreshBusy ? 'is-loading' : ''}`} disabled={isRefreshBusy} onClick={handleRefreshWrapWithEvent}>
              <span className="action-icon-tip">刷新配额</span>
              {isRefreshBusy ? <SpinnerBtnIcon /> : <RefreshIcon size={16} />}
            </button>

            {!isCurrent && (
              <button className={`action-icon-btn primary ${switching ? 'is-loading' : ''}`} onClick={handleSwitchWrapWithEvent}>
                <span className="action-icon-tip">切换此账号</span>
                {switching ? <SpinnerBtnIcon /> : <PlayIcon size={16} />}
              </button>
            )}

            <button className='action-icon-btn' onClick={(e) => { e.stopPropagation(); onEditTags?.() }}>
              <span className="action-icon-tip">编辑标签</span>
              <TagIcon size={16} />
            </button>

            <button className='action-icon-btn danger' onClick={handleDeleteWrap}>
              <span className="action-icon-tip">删除此账号</span>
              <TrashIcon size={16} />
            </button>
          </div>
        </div>

        {/* ====== 翻转卡片：反面 ====== */}
        <div className='account-card-back account-card' onClick={() => setFlipped(false)}>
          <div className='account-back-body'>
            <div className='account-back-header'>
              <div className='account-back-header-icon' />
              <span className='account-back-header-email'>{isPrivacyMode ? maskText(account.email, 'email') : account.email}</span>
            </div>

            <div className='account-card-details'>
              <div className='account-detail-row'>
                <span className='account-detail-label'>工作空间:</span>
                <AutoTip text={account.workspace || '个人'}>
                  {isPrivacyMode ? maskText(account.workspace || '个人', 'text') : (account.workspace || '个人')}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>添加时间:</span>
                <AutoTip text={account.created_at ? formatDate(account.created_at) : '-'}>
                  {account.created_at ? formatDate(account.created_at) : '-'}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>用户 ID:</span>
                <AutoTip text={account.user_id || account.id || '-'}>
                  {isPrivacyMode ? maskText(account.user_id || account.id || '-', 'id') : (account.user_id || account.id || '-')}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>状态:</span>
                <AutoTip text={statusText} style={{ color: statusColor }}>
                  {statusText}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>设备身份:</span>
                <AutoTip text={deviceIdentityDisplay.text}>
                  {deviceIdentityDisplay.displayText}
                </AutoTip>
              </div>
            </div>

            <div className='account-back-tags'>
              <div className='account-tags-line' data-tip={tagTip}>
                {tagPills.length > 0
                  ? tagPills.map((tag, idx) => (
                    <span
                      className='account-tag-pill'
                      key={`ag-tag-${account.id}-${idx}`}
                      style={getStableCapsuleStyle(`antigravity:${account.id}:${tag}:${idx}`)}
                    >
                      {tag}
                    </span>
                  ))
                  : <span className='account-tag-pill account-tag-pill-empty'>暂无标签</span>}
                {hasMoreTags && <span className='account-tag-pill account-tag-pill-ellipsis'>...</span>}
              </div>
            </div>
            <div className='account-back-hint'>点击卡片任意区域返回配额监控</div>
          </div>
        </div>

      </div>
    </div>
  )
}
