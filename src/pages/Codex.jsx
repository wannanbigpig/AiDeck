import { useEffect, useRef, useState } from 'react'
import QuotaBar from '../components/QuotaBar'
import Modal, { ConfirmModal } from '../components/Modal'
import ExportJsonModal from '../components/ExportJsonModal'
import { useToast } from '../components/Toast'
import { formatDate, truncateEmail, formatResetTime, maskText } from '../utils/format'
import { PlatformIcon } from '../components/Icons/PlatformIcons'
import { getStableCapsuleStyle } from '../utils/capsuleColor'
import { usePrivacy } from '../components/PrivacyMode'
import PrivacyToggleButton from '../components/PrivacyToggleButton'
import AutoTip from '../components/AutoTip'
import JsonImportHelp from '../components/JsonImportHelp'
import LocalPendingCard from '../components/LocalPendingCard'
import SpinnerBtnIcon from '../components/SpinnerIcon'
import UsageGuide from '../components/UsageGuide'
import {
  ShieldIcon,
  SyncIcon,
  PlayIcon,
  RefreshIcon,
  TagIcon,
  TrashIcon,
  PlusIcon,
  UploadIcon,
  SettingsIcon
} from '../components/Icons/ActionIcons'
import CodexSettingsModal from './codex/CodexSettingsModal'
import { readPendingOAuthSession, writePendingOAuthSession, clearPendingOAuthSession } from '../utils/oauth'
import { logRequestEvent } from '../utils/requestLogClient'

const CODEX_SETTINGS_KEY = 'codex_advanced_settings'
import { coerceBooleanSetting } from '../utils/globalSettings'
import {
  resolveQuotaErrorMeta,
  isCodexTeamLikePlan,
  decodeJwtPayload,
  formatCodexLoginProvider,
  firstNonEmptyString,
  resolveCodexIdentityDisplay,
  resolveCodexAddMethodDisplay,
  resolveCodexProviderLoginDisplay,
  resolveWorkspaceTitleFromToken,
  resolveWorkspaceDisplay,
  shouldOfferReauthorizeAction,
  DEFAULT_CODEX_ADVANCED_SETTINGS,
  normalizeCodexAdvancedSettings
} from '../utils/codex'

const CODEX_JSON_IMPORT_REQUIRED_TEXT = '必填字段：tokens.access_token 或 tokens.refresh_token 至少一个（也支持顶层 access_token / refresh_token）。建议补充 id、email、tokens.id_token、tokens.access_token、tokens.refresh_token、created_at、last_used。'

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

function readCodexAdvancedSettings () {
  try {
    if (window.utools) {
      const saved = window.utools.dbStorage.getItem(CODEX_SETTINGS_KEY)
      return normalizeCodexAdvancedSettings(saved)
    } else {
      const raw = localStorage.getItem(CODEX_SETTINGS_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        return normalizeCodexAdvancedSettings(saved)
      }
    }
  } catch (e) {}
  return normalizeCodexAdvancedSettings(null)
}



/**
 * Codex 账号管理页
 */
export default function Codex ({ onRefresh, onActivity, searchQuery = '' }) {
  const [accounts, setAccounts] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [addTab, setAddTab] = useState('oauth')
  const [importJson, setImportJson] = useState('')
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
  const [loading, setLoading] = useState(false)
  const [importingLocal, setImportingLocal] = useState(false)
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)
  const [advancedSettings, setAdvancedSettings] = useState(() => readCodexAdvancedSettings())
  const [tagEditor, setTagEditor] = useState({ id: '', value: '' })
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [batchTagEditor, setBatchTagEditor] = useState({ open: false, value: '' })
  const [localImportHint, setLocalImportHint] = useState({ visible: false, email: '' })
  const [exportDialog, setExportDialog] = useState({ open: false, json: '', count: 0 })
  const toast = useToast()
  const autoRefreshRunningRef = useRef(false)
  const oauthPollTimerRef = useRef(null)
  const [refreshingIds, setRefreshingIds] = useState(new Set())
  const prevShowCodeReviewQuotaRef = useRef(coerceBooleanSetting(readCodexAdvancedSettings().showCodeReviewQuota, true))

  const svc = window.services?.codex

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

  function stopOAuthPolling () {
    if (oauthPollTimerRef.current) {
      clearInterval(oauthPollTimerRef.current)
      oauthPollTimerRef.current = null
    }
    setOauthPolling(false)
  }

  function startOAuthPolling (sessionId) {
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

  async function restorePendingOAuthSession () {
    const pending = readPendingOAuthSession('codex')
    if (!pending || typeof pending !== 'object') return false
    if (!pending.sessionId || !pending.authUrl) {
      clearPendingOAuthSession('codex')
      return false
    }

    const createdAt = typeof pending.createdAt === 'number' ? pending.createdAt : 0
    if (createdAt && Date.now() - createdAt > 10 * 60 * 1000) {
      clearPendingOAuthSession('codex')
      return false
    }

    const sid = (pending.sessionId || '').trim()
    if (!sid) {
      clearPendingOAuthSession('codex')
      return false
    }

    if (svc && typeof svc.getOAuthSessionStatus === 'function') {
      try {
        const status = await Promise.resolve(svc.getOAuthSessionStatus(sid))
        if (!status || !status.success) {
          clearPendingOAuthSession('codex')
          return false
        }
      } catch (e) {
        clearPendingOAuthSession('codex')
        return false
      }
    }

    setOauthSessionId(sid)
    setOauthAuthUrl(pending.authUrl || '')
    setOauthRedirectUri(pending.redirectUri || '')
    setShowImport(true)
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
      if (platform && platform !== 'codex' && platform !== 'all') return
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
    setAdvancedSettings(readCodexAdvancedSettings())
  }, [])

  useEffect(() => {
    const currentShow = coerceBooleanSetting(advancedSettings.showCodeReviewQuota, true)
    const prevShow = prevShowCodeReviewQuotaRef.current
    prevShowCodeReviewQuotaRef.current = currentShow
    if (currentShow && !prevShow) {
      void refreshAllQuotas({ silent: true, source: 'show-code-review-toggle' })
    }
  }, [advancedSettings.showCodeReviewQuota])

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

  function refresh () {
    if (!svc) return
    setAccounts(svc.list())
    const cur = svc.getCurrent()
    setCurrentId(cur?.id || null)
    void refreshLocalImportHint()
    onRefresh?.()
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

  function handleToggleSelect (accountId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
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

    const switchResult = await Promise.resolve(svc.switchAccount(next.id, settings))
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

    clearAutoSwitchLock()
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

    if (autoRefreshRunningRef.current) return
    autoRefreshRunningRef.current = true

    const BATCH_ID = 'codex-batch-refresh'
    try {
      if (!silent) {
        setLoading(true)
        toast.upsert(BATCH_ID, '准备开始刷新全量配额...', 'info', 0)
      }

      const latestAccounts = svc.list() || []
      const total = latestAccounts.length
      const failures = []
      logRequestEvent('codex.batch-refresh', '开始批量刷新配额', {
        source,
        silent,
        total
      })
      for (let i = 0; i < total; i++) {
        const acc = latestAccounts[i]
        const progress = Math.round(((i + 1) / total) * 100)
        if (!silent) {
          toast.upsert(BATCH_ID, `正在刷新配额 (${i + 1}/${total})...`, 'info', progress)
        }
        await new Promise(resolve => setTimeout(resolve, 300))
        const result = await svc.refreshQuota(acc.id)
        if (result && result.error) {
          failures.push({
            email: acc.email || acc.id,
            error: result.error
          })
        }
      }

      refresh()
      await maybeAutoSwitchAfterQuotaRefresh(source)
      logRequestEvent('codex.batch-refresh', '批量刷新配额完成', {
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
          toast.success('刷新全部配额完毕')
        }
      }
    } catch (e) {
      logRequestEvent('codex.batch-refresh', '批量刷新配额异常', {
        source,
        silent,
        error: e?.message || String(e)
      }, 'error')
      if (!silent) {
        toast.error('批量刷新失败: ' + (e?.message || String(e)))
      }
    } finally {
      autoRefreshRunningRef.current = false
      if (!silent) {
        setLoading(false)
        setTimeout(() => toast.remove(BATCH_ID), 1000)
      }
    }
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

  async function prepareOAuthSession () {
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
      writePendingOAuthSession('codex',{
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

  async function copyText (text) {
    const val = (text || '').trim()
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
    } catch (e) {}
    return false
  }

  async function handleCopyOAuthUrl () {
    if (!oauthAuthUrl) return
    const ok = await copyText(oauthAuthUrl)
    if (!ok) {
      toast.warning('复制失败，请手动复制链接')
      return
    }
    setOauthUrlCopied(true)
    toast.success('授权链接已复制')
  }

  async function handleOpenOAuthInBrowser () {
    let authUrl = oauthAuthUrl
    let sid = oauthSessionId

    if (sid && svc && typeof svc.getOAuthSessionStatus === 'function') {
      try {
        const status = await Promise.resolve(svc.getOAuthSessionStatus(sid))
        if (!status || !status.success || status.status === 'missing') {
          clearPendingOAuthSession('codex')
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
        }
      } catch (e) {
        clearPendingOAuthSession('codex')
        stopOAuthPolling()
        setOauthSessionId('')
        setOauthAuthUrl('')
        setOauthRedirectUri('')
        setOauthRecovered(false)
        const prepared = await prepareOAuthSession()
        authUrl = prepared?.authUrl || ''
        sid = prepared?.sessionId || ''
      }
    }

    if (!authUrl) {
      const prepared = await prepareOAuthSession()
      authUrl = prepared?.authUrl || ''
      sid = prepared?.sessionId || sid
    }
    if (!authUrl) {
      toast.error(oauthPrepareError || '授权链接未就绪')
      return
    }

    if (!svc || typeof svc.openExternalUrl !== 'function') {
      const copied = await copyText(authUrl)
      if (copied) {
        toast.info('当前环境不支持自动打开，已复制授权链接')
      } else {
        toast.warning('当前环境不支持自动打开，请手动复制链接')
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
    toast.success('已在浏览器打开授权页')
  }

  async function completeOAuthBySession (sessionId, callbackUrl, source = 'manual') {
    const sid = (sessionId || '').trim()
    if (!sid) {
      toast.warning('授权会话不存在，请先生成授权链接')
      return false
    }
    const callback = (callbackUrl || '').trim()
    if (source === 'manual' && !callback) {
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
          clearPendingOAuthSession('codex')
          setOauthSessionId('')
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
      clearPendingOAuthSession('codex')
      setOauthRecovered(false)
      toast.success(`OAuth 授权成功: ${account.email || account.id}`)
      onActivity?.(`OAuth 添加账号 -> ${account.email || account.id}`)
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

  async function handleSubmitOAuthCallback () {
    await completeOAuthBySession(oauthSessionId, oauthCallbackInput, 'manual')
  }

  function handleSwitchAddTab (nextTab) {
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

  function openAddModal (initialTab = 'oauth') {
    setShowImport(true)
    setAddTab(initialTab)
    setImportJson('')
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

  function closeAddModal () {
    if (oauthSessionId && svc && typeof svc.cancelOAuthSession === 'function') {
      try {
        svc.cancelOAuthSession(oauthSessionId)
      } catch (e) {}
    }
    stopOAuthPolling()
    clearPendingOAuthSession('codex')
    setShowImport(false)
    setAddTab('oauth')
    setImportJson('')
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

  async function handleSwitch (id) {
    const settings = readCodexAdvancedSettings()
    setAdvancedSettings(settings)
    const result = await Promise.resolve(svc.switchAccount(id, settings))
    if (result.success) {
      setCurrentId(id)
      toast.success('Codex 切换成功 — auth.json 已更新')
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toast.warning(result.warnings[0])
      }
      clearAutoSwitchLock()
      refresh()
    } else {
      toast.error(result.error || '切换失败')
    }
  }

  function handleDelete (id) {
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

  async function handleRefreshQuota (id) {
    if (loading || autoRefreshRunningRef.current) return
    if (refreshingIds.has(id)) return
    setRefreshingIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    try {
      const result = await svc.refreshQuota(id)
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
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleRefreshAll = async () => {
    await refreshAllQuotas({ silent: false, source: 'manual-all' })
  }

  async function handleExport (ids) {
    const picked = Array.isArray(ids) ? ids.filter(Boolean) : []
    if (picked.length === 0) {
      toast.warning('请先选择要导出的账号')
      return
    }
    const json = svc.exportAccounts(picked)
    setExportDialog({ open: true, json, count: picked.length })
  }

  function closeExportDialog () {
    setExportDialog(prev => ({ ...prev, open: false }))
  }

  async function handleCopyExportJson () {
    const content = String(exportDialog.json || '')
    if (!content) {
      toast.warning('暂无可导出的 JSON 内容')
      return
    }
    const ok = await copyText(content)
    if (ok) toast.success('已复制到剪贴板')
    else toast.warning('复制失败，请手动复制')
  }

  function handleDownloadExportJson () {
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
      link.download = `codex-accounts-${stamp}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success('已开始下载 JSON 文件')
    } catch (e) {
      toast.warning('下载失败，请先复制再手动保存')
    }
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
    setBatchTagEditor({ open: false, value: '' })
    toast.success(`已更新 ${ids.length} 个账号标签`)
    refresh()
  }

  useEffect(() => {
    const minutes = Number(advancedSettings.autoRefreshMinutes)
    if (!minutes || minutes <= 0) return
    const timer = setInterval(() => {
      void refreshAllQuotas({ silent: true, source: 'auto-refresh' })
    }, minutes * 60 * 1000)
    return () => clearInterval(timer)
  }, [advancedSettings.autoRefreshMinutes])

  const invalidCount = accounts.filter(a => !!a?.quota?.error || !!a?.quota_error?.message || a.invalid || a.quota?.invalid).length
  const validCount = accounts.length - invalidCount
  const selectedCount = selectedIds.size

  return (
    <div>
      <div className='page-header'>
        <div>
          <h1 className='page-title'>
            <PlatformIcon platform="codex" size={24} /> Codex
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
                <button className='action-bar-btn' onClick={() => setBatchTagEditor({ open: true, value: '' })} data-tip='批量设置标签'>
                  <TagIcon size={18} />
                </button>
              )}
            </>
          )}
          <PrivacyToggleButton />
          <button className='action-bar-btn' onClick={() => setShowAdvancedConfig(true)} data-tip='高级偏好设置'>
            <SettingsIcon size={18} />
          </button>
        </div>
      </div>

      <UsageGuide
        platform='Codex'
        title='Codex 账号管理说明'
        description='支持读取当前系统默认配置目录中的本地登录态，也支持粘贴 Token/JSON 或 OAuth 授权登录来管理 Codex (OpenAI) 账号。'
        permissions={[
          '读取并写入当前系统默认配置目录中的 `auth.json`，用于同步当前本地登录态、账户 Token 及本地应用切号。'
        ]}
        network={[
          'OAuth 与凭证刷新会调用 OpenAI 官方接口（`auth.openai.com`）。',
          '配额查询会调用 OpenAI/ChatGPT 接口（`chatgpt.com/backend-api/wham/usage`），仅发送必要的授权字段。'
        ]}
      />

      {accounts.length === 0 && !localImportHint.visible
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
            {accounts.filter(acc => {
              if (!searchQuery) return true
              const tagsStr = acc.tags ? acc.tags.join(' ') : ''
              const textToSearch = `${acc.email || ''} ${acc.username || ''} ${acc.id || ''} ${acc.teamName || ''} ${acc.org || ''} ${acc.team || ''} ${tagsStr}`
                .toLowerCase()
              return textToSearch.includes(searchQuery.trim().toLowerCase())
            })
            .sort((a, b) => {
              const aIsCurrent = a.id === currentId ? 1 : 0
              const bIsCurrent = b.id === currentId ? 1 : 0
              return bIsCurrent - aIsCurrent
            })
            .map(account => (
              <CodexAccountItem
                key={account.id}
                account={account}
                isCurrent={account.id === currentId}
                isSelected={selectedIds.has(account.id)}
                refreshingIds={refreshingIds}
                globalLoading={loading}
                onToggleSelect={() => handleToggleSelect(account.id)}
                onSwitch={() => handleSwitch(account.id)}
                onRefresh={() => handleRefreshQuota(account.id)}
                onDelete={() => setConfirmDelete(account.id)}
                onEditTags={() => handleOpenTagEditor(account)}
                onReauthorize={() => openAddModal('oauth')}
                svc={svc}
                showCodeReviewQuota={coerceBooleanSetting(advancedSettings.showCodeReviewQuota, true)}
              />
            ))}
          </div>
          )}

      <Modal
        title='添加 Codex 账号'
        open={showImport}
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
                  placeholder={oauthRedirectUri ? `粘贴完整回调地址，例如：${oauthRedirectUri}?code=...&state=...` : '粘贴完整回调地址，例如：http://localhost:1455/auth/callback?...'}
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
              <br />
              若悬浮窗口会失焦收起，建议先按 Ctrl+D 分离窗口，或在插件菜单中勾选“自动分离为独立窗口”。
            </div>
          </>
        )}

        {addTab === 'token' && (
          <>
            <div className='form-group' style={{ marginBottom: 0 }}>
              <label className='form-label'>粘贴 JSON 导入账号</label>
              <textarea
                className='form-textarea'
                placeholder='[{"email":"...","tokens":{"id_token":"...","access_token":"...","refresh_token":"..."}}]'
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
              />
              <JsonImportHelp
                requiredText={CODEX_JSON_IMPORT_REQUIRED_TEXT}
                example={CODEX_JSON_IMPORT_EXAMPLE}
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
              <label className='form-label'>从本机导入</label>
              <div className='oauth-hint' style={{ marginBottom: 10 }}>
                支持从当前系统默认配置目录中自动探测并导入本机账号。
              </div>
              <div className='oauth-action-row'>
                <button
                  className='btn btn-primary'
                  onClick={() => handleImportLocal({ closeAfter: true })}
                  disabled={importingLocal}
                >
                  {importingLocal ? '导入中...' : '💾 从本机 Codex 导入'}
                </button>
              </div>
            </div>
          </>
        )}

      </Modal>

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
            placeholder='例如: 主力, 备用, 稳定'
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
            placeholder='例如: 主力, 备用, 稳定'
          />
        </div>
      </Modal>

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
        onCopy={handleCopyExportJson}
        onDownload={handleDownloadExportJson}
      />

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


function CodexAccountItem ({ account, isCurrent, isSelected, refreshingIds, globalLoading, onToggleSelect, onSwitch, onRefresh, onDelete, onEditTags, onReauthorize, svc, showCodeReviewQuota = true }) {
  const { isPrivacyMode } = usePrivacy()
  const quota = account.quota
  const planName = svc?.getPlanDisplayName(account.plan_type) || ''

  const [flipped, setFlipped] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [switching, setSwitching] = useState(false)

  const handleRefreshWrap = async () => {
    await onRefresh()
  }

  const handleSyncWrap = async () => {
    if (syncing) return
    setSyncing(true)
    try { await new Promise(r => setTimeout(r, 600)) } catch (e) {}
    setSyncing(false)
  }

  const handleSwitchWrap = async () => {
    if (switching) return
    setSwitching(true)
    try { await onSwitch() } catch (e) {}
    setSwitching(false)
  }



  const planBadgeClass = (() => {
    const upper = (planName || '').toUpperCase()
    if (upper === 'PLUS') return 'badge-plus'
    if (upper === 'PRO') return 'badge-pro'
    if (upper === 'TEAM') return 'badge-team'
    return 'badge-free'
  })()

  const quotaErrorMeta = resolveQuotaErrorMeta(account.quota_error, quota?.error || '')
  const hasQuotaError = Boolean(quotaErrorMeta.rawMessage)
  const showReauthorizeAction = hasQuotaError && shouldOfferReauthorizeAction(quotaErrorMeta)
  const isDeactivated = quotaErrorMeta.errorCode.toLowerCase() === 'deactivated_workspace' ||
    quotaErrorMeta.statusCode === '402' ||
    quotaErrorMeta.rawMessage.toLowerCase().includes('deactivated_workspace')
  const showQuotaErrorOnFront = hasQuotaError && !isDeactivated
  const isInvalid = isDeactivated || account.invalid || account.quota?.invalid || false
  const statusLabels = isDeactivated ? '已停用' : '已失效'
  const statusText = isCurrent
    ? '当前激活'
    : ((isInvalid || showReauthorizeAction) ? '无效' : (hasQuotaError ? '配额异常' : '有效'))
  const statusColor = isCurrent ? 'var(--accent-green)' : ((isInvalid || hasQuotaError) ? '#ef4444' : 'var(--text-secondary)')
  const codeReviewPercentage = typeof quota?.code_review_percentage === 'number'
    ? quota.code_review_percentage
    : (typeof quota?.weekly_percentage === 'number' ? quota.weekly_percentage : null)
  const codeReviewResetTime = quota?.code_review_reset_time || quota?.weekly_reset_time || ''
  const codeReviewRequestsLeft = typeof quota?.code_review_requests_left === 'number'
    ? quota.code_review_requests_left
    : quota?.weekly_requests_left
  const codeReviewRequestsLimit = typeof quota?.code_review_requests_limit === 'number'
    ? quota.code_review_requests_limit
    : quota?.weekly_requests_limit
  const workspaceDisplay = resolveWorkspaceDisplay(account)
  const addMethodDisplay = resolveCodexAddMethodDisplay(account)
  const providerLoginDisplay = resolveCodexProviderLoginDisplay(account)
  const loginMethodDisplay = `${addMethodDisplay} | ${providerLoginDisplay}`
  const identityDisplay = resolveCodexIdentityDisplay(account)
  const tagList = Array.isArray(account.tags)
    ? account.tags.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const tagTip = tagList.length > 0 ? tagList.join(', ') : '暂无标签'
  const tagPills = tagList.slice(0, 3)
  const hasMoreTags = tagList.length > tagPills.length
  const isRefreshBusy = globalLoading || refreshingIds.has(account.id)

  return (
    <div className={`account-card-container ${isCurrent ? 'current' : ''} ${isInvalid ? 'status-invalid' : ''} ${hasQuotaError ? 'status-quota-error' : ''} ${isSelected ? 'ag-selected' : ''}`}>
      <div className={`account-card-inner ${flipped ? 'flipped' : ''}`}>
        
        {/* ====== 翻转卡片：正面 ====== */}
        <div className='account-card-front account-card' onClick={() => setFlipped(true)} style={{ cursor: 'pointer' }}>
          <div className='account-card-row'>
            <label className='ag-checkbox-wrap' onClick={(e) => e.stopPropagation()}>
              <input type='checkbox' checked={!!isSelected} onChange={onToggleSelect} />
              <span className='ag-checkbox-ui' />
            </label>
            <span className='account-email'>{isPrivacyMode ? maskText(account.email, 'email') : truncateEmail(account.email, 28)}</span>
            {planName && <span className={`badge ${planBadgeClass}`}>{planName}</span>}
            {showQuotaErrorOnFront && (
              <span className='codex-status-pill quota-error' title={quotaErrorMeta.rawMessage}>
                {showReauthorizeAction ? '需重新授权' : (quotaErrorMeta.statusCode || '配额异常')}
              </span>
            )}
            {isInvalid && <span className='badge badge-danger'>{statusLabels}</span>}
            {isCurrent && <span className='badge badge-active'>当前</span>}
          </div>

          <div className='account-card-quota'>
            {(() => {
              const hasHourly = (planName || '').toUpperCase() !== 'FREE' && typeof quota?.hourly_percentage === 'number'
              const hasWeekly = typeof quota?.weekly_percentage === 'number'
              const hasCR = showCodeReviewQuota && typeof codeReviewPercentage === 'number'
              
              if (!hasHourly && !hasWeekly && !hasCR) {
                return <div className='quota-empty-placeholder'>暂无配额数据</div>
              }

              return (
                <>
                  {hasHourly && (
                    <QuotaBar
                      percentage={quota.hourly_percentage}
                      label='5小时'
                      resetTime={quota.hourly_reset_time ? formatResetTime(quota.hourly_reset_time) : ''}
                      requestsLeft={quota.hourly_requests_left}
                      requestsLimit={quota.hourly_requests_limit}
                    />
                  )}
                  {hasWeekly && (
                    <QuotaBar
                      percentage={quota.weekly_percentage}
                      label='每周'
                      resetTime={quota.weekly_reset_time ? formatResetTime(quota.weekly_reset_time) : ''}
                      requestsLeft={quota.weekly_requests_left}
                      requestsLimit={quota.weekly_requests_limit}
                    />
                  )}
                  {hasCR && (
                    <QuotaBar
                      percentage={codeReviewPercentage}
                      label='代码审查'
                      resetTime={codeReviewResetTime ? formatResetTime(codeReviewResetTime) : ''}
                      requestsLeft={codeReviewRequestsLeft}
                      requestsLimit={codeReviewRequestsLimit}
                    />
                  )}
                </>
              )
            })()}
          </div>

          <div className='account-card-divider' />
          <div className='account-actions' style={{ justifyContent: 'flex-end', gap: 2, color: 'var(--text-secondary)' }} onClick={e => e.stopPropagation()}>
            {showReauthorizeAction && (
              <button className='action-icon-btn' onClick={() => onReauthorize?.()}>
                <span className="action-icon-tip">重新授权</span>
                <ShieldIcon size={16} />
              </button>
            )}
            <button className={`action-icon-btn ${syncing ? 'is-loading' : ''}`} onClick={handleSyncWrap}>
              <span className="action-icon-tip">同步账号信息</span>
              {syncing ? <SpinnerBtnIcon /> : <SyncIcon size={16} />}
            </button>

            {!isCurrent && (
              <button className={`action-icon-btn primary ${switching ? 'is-loading' : ''}`} onClick={handleSwitchWrap}>
                <span className="action-icon-tip">切换此号</span>
                {switching ? <SpinnerBtnIcon /> : (
                  <svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true" fill="currentColor">
                    <path d="M918.072889 966.769778c-26.908444 0-48.753778-30.378667-48.753778-67.697778V96.426667c0-37.319111 21.845333-67.697778 48.753778-67.697778s48.810667 30.378667 48.810667 67.697778v802.645333c0 37.319111-21.902222 67.697778-48.810667 67.697778z m-195.697778-411.477334l-563.768889 400.327112a63.886222 63.886222 0 0 1-34.702222 9.898666c-11.605333 0-22.755556-2.958222-32.426667-8.533333-22.129778-13.539556-35.100444-35.896889-34.531555-59.790222V97.28c0-24.917333 13.198222-47.900444 34.474666-60.074667 9.671111-5.518222 20.935111-8.476444 32.426667-8.476444 12.8 0 24.974222 3.527111 35.271111 10.24l562.915556 399.644444c19.626667 12.686222 31.744 35.100444 31.744 58.595556 0 23.495111-12.060444 45.738667-31.402667 58.083555zM549.944889 448.682667L241.834667 215.836444a55.978667 55.978667 0 0 0-58.766223-1.991111 58.311111 58.311111 0 0 0-29.240888 50.574223v466.602666c-0.398222 20.252444 10.410667 39.139556 28.956444 50.517334a56.718222 56.718222 0 0 0 58.311111-1.308445l309.418667-233.927111c15.872-10.069333 25.884444-28.728889 25.884444-48.526222 0-19.740444-10.126222-38.570667-26.453333-49.095111z" />
                </svg>
                )}
              </button>
            )}

            <button className={`action-icon-btn ${isRefreshBusy ? 'is-loading' : ''}`} disabled={isRefreshBusy} onClick={handleRefreshWrap}>
              <span className="action-icon-tip">提取最新配额详情</span>
              {isRefreshBusy ? <SpinnerBtnIcon /> : <RefreshIcon size={16} />}
            </button>

            <button className='action-icon-btn' onClick={() => onEditTags?.()}>
              <span className="action-icon-tip">编辑标签</span>
              <TagIcon size={16} />
            </button>

            <button className='action-icon-btn danger' onClick={onDelete}>
              <span className="action-icon-tip">删除弃用此账号</span>
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
                <AutoTip text={workspaceDisplay.text}>
                  {isPrivacyMode ? maskText(workspaceDisplay.text, 'text') : workspaceDisplay.text}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>添加方式:</span>
                <AutoTip text={loginMethodDisplay}>
                  {loginMethodDisplay}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>添加时间:</span>
                <AutoTip text={account.added_at ? formatDate(account.added_at) : (account.created_at ? formatDate(account.created_at) : '-')}>
                  {account.added_at ? formatDate(account.added_at) : (account.created_at ? formatDate(account.created_at) : '-')}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>用户 ID:</span>
                <AutoTip text={identityDisplay.userId}>
                  {isPrivacyMode ? maskText(identityDisplay.userId, 'id') : identityDisplay.userId}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>状态:</span>
                <AutoTip text={statusText} style={{ color: statusColor }}>
                  {statusText}
                </AutoTip>
              </div>
            </div>

            <div className='account-back-tags'>
              <div className='account-tags-line' data-tip={tagTip}>
                {tagPills.length > 0
                  ? tagPills.map((tag, idx) => (
                    <span
                      className='account-tag-pill'
                      key={`codex-tag-${account.id}-${idx}`}
                      style={getStableCapsuleStyle(`codex:${account.id}:${tag}:${idx}`)}
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
