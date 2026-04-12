import { useEffect, useMemo, useState } from 'react'
import QuotaBar from '../components/QuotaBar'
import Modal, { ConfirmModal } from '../components/Modal'
import ExportJsonModal from '../components/ExportJsonModal'
import { useToast } from '../components/Toast'
import { formatDate, truncateEmail, formatResetTime, maskText } from '../utils/format'
import { getGeminiQuotaDisplayItems, normalizeGeminiAdvancedSettings, readGeminiAdvancedSettings } from '../utils/gemini'
import { PlatformIcon } from '../components/Icons/PlatformIcons'
import { getStableCapsuleStyle } from '../utils/capsuleColor'
import PrivacyToggleButton from '../components/PrivacyToggleButton'
import { usePrivacy } from '../components/PrivacyMode'
import AutoTip from '../components/AutoTip'
import JsonImportHelp from '../components/JsonImportHelp'
import LocalPendingCard from '../components/LocalPendingCard'
import SpinnerBtnIcon from '../components/SpinnerIcon'
import UsageGuide from '../components/UsageGuide'
import {
  SyncIcon,
  RefreshIcon,
  TagIcon,
  TrashIcon,
  PlusIcon,
  UploadIcon,
  SettingsIcon
} from '../components/Icons/ActionIcons'
import { readPendingOAuthSession, writePendingOAuthSession, clearPendingOAuthSession } from '../utils/oauth'
import { resolveQuotaErrorMeta } from '../utils/codex'
import GeminiSettingsModal from './gemini/GeminiSettingsModal'

const GEMINI_JSON_IMPORT_REQUIRED_TEXT = '必填字段：access_token 或 refresh_token 至少一个（支持 tokens.access_token / tokens.refresh_token 或顶层字段）。建议补充 id、email、auth_id、name、selected_auth_type、project_id、tier_id、plan_name、created_at、last_used。'

const GEMINI_JSON_IMPORT_EXAMPLE = `[
  {
    "id": "gem_7f1b2d9a",
    "email": "user@gmail.com",
    "auth_id": "113044403884822001122",
    "name": "Example User",
    "selected_auth_type": "oauth-personal",
    "tokens": {
      "id_token": "eyJhbGciOi...",
      "access_token": "ya29.a0AfH6SMA...",
      "refresh_token": "1//0gxxxxxxxx",
      "token_type": "Bearer",
      "scope": "openid email profile",
      "expiry_date": 1770003600000
    },
    "project_id": "projects/my-project",
    "tier_id": "pro",
    "plan_name": "Gemini Pro",
    "subscription_status": "active",
    "created_at": 1770000000000,
    "last_used": 1770003600000
  }
]`

function getQuotaRefreshIssueMessage (result) {
  if (!result || typeof result !== 'object') return ''
  const direct = String(result.error || result.warning || result?.quota_error?.message || '').trim()
  if (direct) return direct
  const msg = String(result.message || '').trim()
  if (msg.includes('未获取到') || msg.includes('暂无配额')) return msg
  return ''
}



/**
 * Gemini CLI 账号管理页
 */
export default function Gemini ({ onRefresh, onActivity, searchQuery = '' }) {
  const [accounts, setAccounts] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [settings, setSettings] = useState(() => normalizeGeminiAdvancedSettings(readGeminiAdvancedSettings()))
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)
  const [addTab, setAddTab] = useState('oauth')
  const [importJson, setImportJson] = useState('')
  const [idTokenInput, setIdTokenInput] = useState('')
  const [accessTokenInput, setAccessTokenInput] = useState('')
  const [refreshTokenInput, setRefreshTokenInput] = useState('')
  const [oauthSessionId, setOauthSessionId] = useState('')
  const [oauthAuthUrl, setOauthAuthUrl] = useState('')
  const [oauthRedirectUri, setOauthRedirectUri] = useState('')
  const [oauthCallbackInput, setOauthCallbackInput] = useState('')
  const [oauthPreparing, setOauthPreparing] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthPrepareError, setOauthPrepareError] = useState('')
  const [oauthUrlCopied, setOauthUrlCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [loading, setLoading] = useState(false)
  const [importingLocal, setImportingLocal] = useState(false)
  const [tagEditor, setTagEditor] = useState({ id: '', value: '' })
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [batchTagEditor, setBatchTagEditor] = useState({ open: false, value: '' })
  const [refreshingIds, setRefreshingIds] = useState(new Set())
  const [localImportHint, setLocalImportHint] = useState({ visible: false, email: '' })
  const [exportDialog, setExportDialog] = useState({ open: false, json: '', count: 0 })
  const toast = useToast()

  const svc = window.services?.gemini

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
      if (platform && platform !== 'gemini' && platform !== 'all') return
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
    const pending = readPendingOAuthSession('gemini')
    if (!pending || typeof pending !== 'object') return
    if (!pending.sessionId || !pending.authUrl) return

    const createdAt = typeof pending.createdAt === 'number' ? pending.createdAt : 0
    if (createdAt && Date.now() - createdAt > 10 * 60 * 1000) {
      clearPendingOAuthSession('gemini')
      return
    }

    setOauthSessionId(pending.sessionId)
    setOauthAuthUrl(pending.authUrl || '')
    setOauthRedirectUri(pending.redirectUri || '')
    setShowAddModal(true)
    setAddTab('oauth')
    toast.info('检测到未完成的 Gemini OAuth，会话已恢复')
  }, [toast])

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

  function handleSettingsChange (next) {
    setSettings(normalizeGeminiAdvancedSettings(next))
  }

  function applyImportedAccounts (items) {
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

  function handleToggleSelect (accountId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
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
      } else {
        applyImportedAccounts(result.imported)
        toast.success(`成功导入 ${result.imported.length} 个 Gemini 账号`)
        onActivity?.(`本地导入 Gemini 账号: ${result.imported.length} 个`)
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
      return
    }

    toast.success(`成功导入 ${result.imported.length} 个账号`)
    onActivity?.(`JSON 导入 Gemini 账号: ${result.imported.length} 个`)
    closeAddModal()
    refresh()
  }

  async function handleAddWithToken () {
    const idToken = idTokenInput.trim()
    const accessToken = accessTokenInput.trim()
    const refreshToken = refreshTokenInput.trim()

    if (!idToken && !accessToken) {
      toast.warning('请至少填写 id_token 或 access_token')
      return
    }

    if (!svc || typeof svc.addWithToken !== 'function') {
      toast.error('当前版本不支持 Token 添加')
      return
    }

    const account = await Promise.resolve(svc.addWithToken(idToken, accessToken, refreshToken))
    if (!account || !account.id) {
      toast.error('添加 Token 账号失败')
      return
    }

    toast.success(`已添加账号: ${account.email || account.id}`)
    onActivity?.(`Token 添加 Gemini 账号 -> ${account.email || account.id}`)
    closeAddModal()
    refresh()
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
        const err = (result && result.error) || '生成授权链接失败'
        setOauthPrepareError(err)
        return null
      }

      const session = result.session
      setOauthSessionId(session.sessionId || '')
      setOauthAuthUrl(session.authUrl || '')
      setOauthRedirectUri(session.redirectUri || '')
      setOauthCallbackInput('')
      setOauthUrlCopied(false)

      writePendingOAuthSession('gemini',{
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
      toast.warning('复制失败，请手动复制')
      return
    }
    setOauthUrlCopied(true)
    toast.success('授权链接已复制')
  }

  async function handleOpenOAuthInBrowser () {
    let authUrl = oauthAuthUrl
    if (!authUrl) {
      const prepared = await prepareOAuthSession()
      authUrl = prepared?.authUrl || ''
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

    toast.success('已在浏览器打开 Gemini OAuth 页面')
  }

  async function handleSubmitOAuthCallback () {
    if (!oauthSessionId) {
      toast.warning('授权会话不存在，请先生成授权链接')
      return
    }
    if (!oauthCallbackInput.trim()) {
      toast.warning('请粘贴完整回调地址')
      return
    }
    if (!svc || typeof svc.completeOAuthSession !== 'function') {
      toast.error('当前版本不支持 OAuth 回调提交')
      return
    }

    setOauthBusy(true)
    try {
      const result = await svc.completeOAuthSession(oauthSessionId, oauthCallbackInput.trim())
      if (!result || !result.success || !result.account) {
        const err = (result && result.error) || 'OAuth 授权失败'
        if (err.includes('会话不存在') || err.includes('已过期')) {
          clearPendingOAuthSession('gemini')
          setOauthSessionId('')
        }
        toast.error(err)
        return
      }

      const account = result.account
      clearPendingOAuthSession('gemini')
      toast.success(`OAuth 授权成功: ${account.email || account.id}`)
      onActivity?.(`OAuth 添加 Gemini 账号 -> ${account.email || account.id}`)
      closeAddModal()
      refresh()
    } catch (e) {
      toast.error('OAuth 授权失败: ' + (e?.message || String(e)))
    } finally {
      setOauthBusy(false)
    }
  }

  function handleSwitchAddTab (nextTab) {
    setAddTab(nextTab)

    if (nextTab === 'oauth' && !oauthSessionId && !oauthPreparing) {
      const pending = readPendingOAuthSession('gemini')
      if (pending && pending.sessionId && pending.authUrl) {
        setOauthSessionId(pending.sessionId)
        setOauthAuthUrl(pending.authUrl || '')
        setOauthRedirectUri(pending.redirectUri || '')
      } else {
        void prepareOAuthSession()
      }
    }
  }

  function openAddModal (initialTab = 'oauth') {
    setShowAddModal(true)
    setAddTab(initialTab)
    setImportJson('')
    setIdTokenInput('')
    setAccessTokenInput('')
    setRefreshTokenInput('')
    setOauthCallbackInput('')
    setOauthPrepareError('')
    setOauthUrlCopied(false)

    if (initialTab === 'oauth') {
      const pending = readPendingOAuthSession('gemini')
      if (pending && pending.sessionId && pending.authUrl) {
        setOauthSessionId(pending.sessionId)
        setOauthAuthUrl(pending.authUrl || '')
        setOauthRedirectUri(pending.redirectUri || '')
      } else {
        void prepareOAuthSession()
      }
    } else {
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

    clearPendingOAuthSession('gemini')
    setShowAddModal(false)
    setAddTab('oauth')
    setImportJson('')
    setIdTokenInput('')
    setAccessTokenInput('')
    setRefreshTokenInput('')
    setOauthSessionId('')
    setOauthAuthUrl('')
    setOauthRedirectUri('')
    setOauthCallbackInput('')
    setOauthPrepareError('')
    setOauthUrlCopied(false)
    setOauthPreparing(false)
    setOauthBusy(false)
  }

  function handleInject (id) {
    const result = svc.inject(id)
    if (result.success) {
      toast.success('注入成功 — 当前系统默认 Gemini 配置目录中的凭证已更新')
      onActivity?.(`Gemini 注入账号 -> ${id}`)
      refresh()
    } else {
      toast.error(result.error || '注入失败')
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

  async function handleRefreshToken (id) {
    if (loading) return
    if (refreshingIds.has(id)) return
    setRefreshingIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    try {
      const result = await Promise.resolve(svc.refreshToken(id))
      const issue = getQuotaRefreshIssueMessage(result)
      if (issue) {
        toast.warning(issue)
      } else if (result?.message) {
        toast.info(result.message)
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

  async function handleRefreshAll () {
    if (accounts.length === 0) return
    if (loading) return

    const BATCH_ID = 'gemini-batch-refresh'
    setLoading(true)
    try {
      toast.upsert(BATCH_ID, '准备刷新 Gemini 配额...', 'info', 0)
      const total = accounts.length
      const failures = []
      for (let i = 0; i < total; i++) {
        const progress = Math.round(((i + 1) / total) * 100)
        toast.upsert(BATCH_ID, `正在刷新 Gemini 配额 (${i + 1}/${total})...`, 'info', progress)
        const result = await Promise.resolve(svc.refreshToken(accounts[i].id))
        const issue = getQuotaRefreshIssueMessage(result)
        if (issue) {
          failures.push({
            email: accounts[i].email || accounts[i].id,
            error: issue
          })
        }
      }
      if (failures.length > 0) {
        const first = failures[0]
        toast.warning(`其中 ${failures.length} 个账号刷新失败：${first.email} - ${first.error}`)
      } else {
        toast.success('全部账号配额刷新完成')
      }
      refresh()
    } catch (e) {
      toast.error('批量刷新失败: ' + (e?.message || String(e)))
    } finally {
      setLoading(false)
      setTimeout(() => toast.remove(BATCH_ID), 1000)
    }
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
      link.download = `gemini-accounts-${stamp}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success('已开始下载 JSON 文件')
    } catch (e) {
      toast.warning('下载失败，请先复制再手动保存')
    }
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

  const invalidCount = accounts.filter(a => {
    const quotaErrorMeta = resolveQuotaErrorMeta(a?.quota_error, a?.quota?.error || '')
    return Boolean(a?.invalid || a?.quota?.invalid || quotaErrorMeta.disabled)
  }).length
  const validCount = accounts.length - invalidCount
  const selectedCount = selectedIds.size
  const visibleAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return accounts
      .filter(acc => {
        if (!q) return true
        const tagsStr = acc.tags ? acc.tags.join(' ') : ''
        return `${acc.email || ''} ${acc.username || ''} ${acc.id || ''} ${acc.tier_id || ''} ${acc.plan_name || ''} ${tagsStr}`
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

  return (
    <div>
      <div className='page-header'>
        <div>
          <h1 className='page-title'>
            <PlatformIcon platform='gemini' size={24} /> Gemini CLI
          </h1>
          <p className='page-subtitle' style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
            共 {accounts.length} 个账号，有效 {validCount}，失效 {invalidCount}
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
            </>
          )}
          <PrivacyToggleButton />
          <button className='action-bar-btn' onClick={() => setShowAdvancedConfig(true)} data-tip='Gemini 设置'>
            <SettingsIcon size={18} />
          </button>
        </div>
      </div>

      <UsageGuide
        platform='Gemini CLI'
        title='Gemini Cli 账号管理说明'
        description='支持读取当前系统默认 Gemini 配置目录中的本地登录态，也支持粘贴 Token/JSON 或 OAuth 授权登录来管理 Gemini Cli 账号。'
        permissions={[
          '读取并写入当前系统默认 Gemini 配置目录中的 `oauth_creds.json`、`google_accounts.json` 和 `settings.json`，用于同步当前本地登录态及切号。'
        ]}
        network={[
          'OAuth 与凭证刷新会调用 Google 官方接口（`accounts.google.com`、`oauth2.googleapis.com`）。',
          '配额查询会调用 Gemini 内部接口（`cloudcode-pa.googleapis.com`），仅发送必要的认证字段。'
        ]}
      />



      {accounts.length === 0 && !localImportHint.visible
        ? (
          <div className='empty-state'>
            <div className='empty-state-icon'>✨</div>
            <div className='empty-state-text'>
              暂无 Gemini CLI 账号<br />
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
              <GeminiAccountItem
                key={account.id}
                account={account}
                svc={svc}
                isCurrent={account.id === currentId}
                isSelected={selectedIds.has(account.id)}
                refreshingIds={refreshingIds}
                globalLoading={loading}
                onToggleSelect={() => handleToggleSelect(account.id)}
                onInject={() => handleInject(account.id)}
                onRefresh={() => void handleRefreshToken(account.id)}
                onDelete={() => setConfirmDelete(account.id)}
                onEditTags={() => handleOpenTagEditor(account)}
              />
            ))}
          </div>
          )}

      <Modal
        title='添加 Gemini CLI 账号'
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
                  placeholder={oauthRedirectUri ? `粘贴完整回调地址，例如：${oauthRedirectUri}?code=...&state=...` : '粘贴完整回调地址，例如：http://127.0.0.1:1458/oauth2callback?...'}
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
              完成浏览器授权后，将完整回调地址粘贴到这里即可继续。
              <br />
              若悬浮窗口会失焦收起，建议先按 Ctrl+D 分离窗口，或在插件菜单中勾选“自动分离为独立窗口”。
            </div>
          </>
        )}

        {addTab === 'token' && (
          <>
            <div className='form-group'>
              <label className='form-label'>手动添加 Token</label>
              <input
                className='form-input'
                placeholder='id_token（可选）'
                value={idTokenInput}
                onChange={(e) => setIdTokenInput(e.target.value)}
              />
              <input
                className='form-input'
                style={{ marginTop: 8 }}
                placeholder='access_token（至少填写 id_token/access_token 之一）'
                value={accessTokenInput}
                onChange={(e) => setAccessTokenInput(e.target.value)}
              />
              <input
                className='form-input'
                style={{ marginTop: 8 }}
                placeholder='refresh_token（可选）'
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
                placeholder='[{"email":"...","access_token":"...","refresh_token":"..."}]'
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
              />
              <JsonImportHelp
                requiredText={GEMINI_JSON_IMPORT_REQUIRED_TEXT}
                example={GEMINI_JSON_IMPORT_EXAMPLE}
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
                支持从当前系统默认 Gemini CLI 配置目录中自动探测并导入当前登录账号。
              </div>
              <div className='oauth-action-row'>
                <button
                  className='btn btn-primary'
                  onClick={() => handleImportLocal({ closeAfter: true })}
                  disabled={importingLocal}
                >
                  {importingLocal ? '导入中...' : '💾 从本机 Gemini 导入'}
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
            placeholder='例如: 主力, 日常, 低风险'
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
            placeholder='例如: 主力, 日常, 低风险'
          />
        </div>
      </Modal>

      <ConfirmModal
        title='删除账号'
        message='确定要删除此 Gemini 账号吗？此操作不可恢复。'
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

      <GeminiSettingsModal
        open={showAdvancedConfig}
        onClose={() => setShowAdvancedConfig(false)}
        toast={toast}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  )
}


function GeminiAccountItem ({ account, isCurrent, isSelected, refreshingIds, globalLoading, onToggleSelect, onInject, onRefresh, onDelete, onEditTags, svc }) {
  const { isPrivacyMode } = usePrivacy()
  const planBadge = svc?.getPlanBadge(account) || ''
  const [flipped, setFlipped] = useState(false)
  const [injecting, setInjecting] = useState(false)

  const planBadgeClass = (() => {
    switch (planBadge) {
      case 'PRO': return 'badge-pro'
      case 'ULTRA': return 'badge-ultra'
      case 'FREE': return 'badge-free'
      default: return 'badge-free'
    }
  })()

  const quota = account.quota
  const quotaErrorMeta = resolveQuotaErrorMeta(account.quota_error, quota?.error || '')
  const hasQuotaError = Boolean(quotaErrorMeta.rawMessage)
  const isDeactivated = quotaErrorMeta.disabled
  const showQuotaErrorOnFront = hasQuotaError && !isDeactivated
  const isInvalid = Boolean(isDeactivated || account.invalid || quota?.invalid)
  const statusLabels = isDeactivated ? '已停用' : '已失效'
  const statusText = isInvalid ? '无效' : (hasQuotaError ? '配额异常' : (isCurrent ? '当前激活' : '有效'))
  const statusColor = (isInvalid || hasQuotaError) ? '#ef4444' : (isCurrent ? 'var(--accent-green)' : 'var(--text-secondary)')
  const tagList = Array.isArray(account.tags)
    ? account.tags.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const tagTip = tagList.length > 0 ? tagList.join(', ') : '暂无标签'
  const tagPills = tagList.slice(0, 3)
  const hasMoreTags = tagList.length > tagPills.length
  const isRefreshBusy = globalLoading || refreshingIds.has(account.id)

  const quotaItems = getGeminiQuotaDisplayItems(quota)

  const handleRefreshWrap = async (e) => {
    e.stopPropagation()
    try { await onRefresh() } catch (e) {}
  }

  const handleInjectWrap = async (e) => {
    e.stopPropagation()
    if (injecting) return
    setInjecting(true)
    try { await onInject() } catch (e) {}
    setInjecting(false)
  }

  const handleDeleteWrap = (e) => {
    e.stopPropagation()
    onDelete()
  }



  return (
    <div className={`account-card-container ${isCurrent ? 'current' : ''} ${isInvalid ? 'status-invalid' : ''} ${hasQuotaError ? 'status-quota-error' : ''} ${isSelected ? 'ag-selected' : ''}`}>
      <div className={`account-card-inner ${flipped ? 'flipped' : ''}`}>
        
        {/* ====== 正面 ====== */}
        <div className='account-card-front account-card' onClick={() => setFlipped(true)} style={{ cursor: 'pointer' }}>
          <div className='account-card-row'>
            <label className='ag-checkbox-wrap' onClick={(e) => e.stopPropagation()}>
              <input type='checkbox' checked={!!isSelected} onChange={onToggleSelect} />
              <span className='ag-checkbox-ui' />
            </label>
            <span className='account-email'>{isPrivacyMode ? maskText(account.email, 'email') : truncateEmail(account.email, 28)}</span>
            {planBadge && <span className={`badge ${planBadgeClass}`}>{planBadge}</span>}
            {showQuotaErrorOnFront && <span className='codex-status-pill quota-error'>配额异常</span>}
            {isInvalid && <span className='badge badge-danger'>{statusLabels}</span>}
            {isCurrent && <span className='badge badge-active'>当前</span>}
          </div>

          <div className='account-card-quota'>
            {quotaItems.length > 0
              ? quotaItems.map(item => (
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
          </div>

          <div className='account-card-divider' />
          <div className='account-actions' style={{ justifyContent: 'flex-end', gap: 2, color: 'var(--text-secondary)' }}>
            <button className={`action-icon-btn primary ${injecting ? 'is-loading' : ''}`} onClick={handleInjectWrap}>
              <span className="action-icon-tip">{isCurrent ? '重新关联' : '激活绑定'}</span>
              {injecting ? <SpinnerBtnIcon /> : <SyncIcon size={16} />}
            </button>

            <button className={`action-icon-btn ${isRefreshBusy ? 'is-loading' : ''}`} disabled={isRefreshBusy} onClick={handleRefreshWrap}>
              <span className="action-icon-tip">刷新配额</span>
              {isRefreshBusy ? <SpinnerBtnIcon /> : <RefreshIcon size={16} />}
            </button>

            <button className='action-icon-btn' onClick={(e) => { e.stopPropagation(); onEditTags?.() }}>
              <span className="action-icon-tip">编辑标签</span>
              <TagIcon size={16} />
            </button>

            <button className='action-icon-btn danger' onClick={handleDeleteWrap}>
              <span className="action-icon-tip">删除账号</span>
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
                <AutoTip text={account.workspace || account.project_id || '个人'}>
                  {isPrivacyMode ? maskText(account.workspace || account.project_id || '个人', 'text') : (account.workspace || account.project_id || '个人')}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>登录方式:</span>
                <AutoTip text={account.auth_mode === 'oauth' ? 'OAuth 授权' : (account.auth_mode || '本地')}>
                  {account.auth_mode === 'oauth' ? 'OAuth 授权' : (account.auth_mode || '本地')}
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
                <AutoTip text={account.user_id || account.tier_id || '-'}>
                  {isPrivacyMode ? maskText(account.user_id || account.tier_id || '-', 'id') : (account.user_id || account.tier_id || '-')}
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
                      key={`gemini-tag-${account.id}-${idx}`}
                      style={getStableCapsuleStyle(`gemini:${account.id}:${tag}:${idx}`)}
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
