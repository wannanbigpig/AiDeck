import { useEffect, useState } from 'react'
import { ConfirmModal } from '../components/Modal'
import ExportJsonModal from '../components/ExportJsonModal'
import { useToast } from '../components/Toast'
import { useGlobalNotice } from '../components/GlobalNotice'
import { normalizeGeminiAdvancedSettings, readGeminiAdvancedSettings } from '../utils/gemini'
import { PlatformIcon } from '../components/Icons/PlatformIcons'
import PrivacyToggleButton from '../components/PrivacyToggleButton'
import LocalPendingCard from '../components/LocalPendingCard'
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
import { resolveQuotaErrorMeta } from '../utils/codex'
import GeminiSettingsModal from './gemini/GeminiSettingsModal'
import GeminiAddAccountModal from './gemini/GeminiAddAccountModal'
import GeminiTagModals from './gemini/GeminiTagModals'
import GeminiAccountItem from './gemini/GeminiAccountItem'
import { useGeminiOAuthFlow } from './gemini/useGeminiOAuthFlow'
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
import { launchPlatformCli } from '../runtime/launchPlatformCli.js'

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
export default function Gemini ({ onActivity, searchQuery = '' }) {
  const [settings, setSettings] = useState(() => normalizeGeminiAdvancedSettings(readGeminiAdvancedSettings()))
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)
  const [addTab, setAddTab] = useState('oauth')
  const [importJson, setImportJson] = useState('')
  const [idTokenInput, setIdTokenInput] = useState('')
  const [accessTokenInput, setAccessTokenInput] = useState('')
  const [refreshTokenInput, setRefreshTokenInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [loading, setLoading] = useState(false)
  const [importingLocal, setImportingLocal] = useState(false)
  const [tagEditor, setTagEditor] = useState({ id: '', value: '' })
  const [localImportHint, setLocalImportHint] = useState({ visible: false, email: '' })
  const toast = useToast()
  const notice = useGlobalNotice()
  const platformSnapshot = usePlatformSnapshot('gemini', {
    watchLocalState: true,
    watchStorageRevision: true,
    syncCurrentFromLocal: true,
    autoImport: false,
    onAfterSync: refreshLocalImportHint
  })
  const { svc, accounts, currentId, setAccounts, setCurrentId, refreshSnapshot } = platformSnapshot
  const quotaActions = usePlatformActions()
  const {
    selectedIds,
    selectedCount,
    toggleSelection
  } = useSelectionSet(accounts, { getId: (account) => account && account.id })
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
    filenamePrefix: 'gemini-accounts'
  })
  const oauthFlow = useGeminiOAuthFlow({
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
      onActivity?.(`OAuth 添加 Gemini 账号 -> ${account.email || account.id}`)
      closeAddModalFromFlow()
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
    reconcileOAuthSession,
    resetOAuthFlow
  } = oauthFlow

  usePlatformAutoRefresh({
    platform: 'gemini',
    svc,
    accounts,
    refreshSnapshot,
    autoRefreshMinutes: settings.autoRefreshMinutes,
    onRefreshAll: refreshAllQuotas
  })

  const {
    handleSwitchAddTab: handleSwitchAddTabFromFlow,
    openAddModal: openAddModalFromFlow,
    closeAddModal: closeAddModalFromFlow
  } = usePlatformAddFlow({
    setOpen: setShowAddModal,
    setTab: setAddTab,
    resetForm: resetAddForm,
    ensureOAuthReady,
    resetOAuth: resetAddFlowState
  })

  useEffect(() => {
    if (!showAddModal || addTab !== 'oauth' || oauthBusy) return

    let cancelled = false

    async function syncOAuthSession () {
      if (cancelled) return
      // 弹窗打开时不自动检查或恢复会话，等待用户操作
      // 注释掉自动恢复逻辑，避免一打开弹窗就显示"授权中..."
      // await reconcileOAuthSession()
      // if (cancelled) return
      // if (!oauthSessionId && !oauthAuthUrl && !oauthPreparing) {
      //   await ensureOAuthReady()
      // }
    }

    void syncOAuthSession()

    return () => {
      cancelled = true
    }
  }, [showAddModal, addTab, oauthBusy, oauthSessionId, oauthAuthUrl, oauthPreparing])

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

  function refresh () {
    if (!svc) return
    refreshSnapshot()
    void refreshLocalImportHint()
  }

  function resetAddForm () {
    setImportJson('')
    setIdTokenInput('')
    setAccessTokenInput('')
    setRefreshTokenInput('')
  }

  function resetAddFlowState () {
    resetOAuthFlow()
    resetAddForm()
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
          closeAddModalFromFlow()
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
    closeAddModalFromFlow()
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
    closeAddModalFromFlow()
    refresh()
  }

  async function handleActivate (id) {
    const result = await Promise.resolve(svc.activateAccount(id))
    if (result.success) {
      toast.success('已设为当前')
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toast.info(result.warnings[0])
      }
      onActivity?.(`Gemini 激活账号 -> ${id}`)
      refresh()
      return true
    } else {
      toast.error(result.error || '激活失败')
      return false
    }
  }

  async function handleLaunchCli (account) {
    return await launchPlatformCli({
      platform: 'gemini',
      command: 'gemini',
      account,
      toast,
      notice,
      onActivity,
      refresh,
      activate: (target) => handleActivate(target.id)
    })
  }

  function handleDelete (id) {
    svc.deleteAccount(id)
    toast.success('已删除')
    setConfirmDelete(null)
    refresh()
  }

  async function handleRefreshQuota (id) {
    if (loading) return
    try {
      const result = await quotaActions.runSingle(id, (accountId) => Promise.resolve(svc.refreshQuotaOrUsage(accountId)))
      const issue = getQuotaRefreshIssueMessage(result)
      if (issue) {
        toast.warning(issue)
      } else if (result?.message) {
        toast.info(result.message)
      }
      refresh()
    } catch (e) {
      toast.error('刷新失败: ' + (e?.message || String(e)))
    }
  }

  async function refreshAllQuotas (opts = {}) {
    if (!svc) return
    const { silent = false } = opts
    return await runPlatformBatchRefresh({
      svc,
      quotaActions,
      toast,
      batchId: 'gemini-batch-refresh',
      silent,
      setLoading,
      preparingText: '准备刷新 Gemini 配额...',
      progressText: ({ completed, total }) => `正在刷新 Gemini 配额 (${completed}/${total})...`,
      successText: '全部账号配额刷新完成',
      concurrency: 2,
      refreshAccount: (accountId) => Promise.resolve(svc.refreshQuotaOrUsage(accountId)),
      resolveIssue: (item) => item.ok ? getQuotaRefreshIssueMessage(item.value) : (item.error?.message || String(item.error || '刷新失败')),
      onCompleted: () => {
        refresh()
      }
    })
  }

  async function handleRefreshAll () {
    if (accounts.length === 0) return
    if (loading) return
    await refreshAllQuotas({ silent: false, source: 'manual' })
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
  const visibleAccounts = usePlatformSearch(accounts, searchQuery, {
    getSearchText: (acc) => {
      const tagsStr = Array.isArray(acc?.tags) ? acc.tags.join(' ') : ''
      return `${acc?.email || ''} ${acc?.username || ''} ${acc?.id || ''} ${acc?.tier_id || ''} ${acc?.plan_name || ''} ${tagsStr}`
    },
    sort: (a, b) => {
      const aCurrent = a.id === currentId ? 1 : 0
      const bCurrent = b.id === currentId ? 1 : 0
      if (bCurrent !== aCurrent) return bCurrent - aCurrent
      return (b.created_at || 0) - (a.created_at || 0)
    }
  })

  return (
    <div>
      <div className='page-header'>
        <div>
          <h1 className='page-title'>
            <PlatformIcon platform='gemini' size={24} /> Gemini CLI
            <UsageGuide
              platform='Gemini CLI'
              title='Gemini CLI 账号管理说明'
              description='用于管理 Gemini CLI 账号，查看 Pro / Flash 配额，导入本机登录态，或通过 OAuth、Token/JSON 添加账号，并将选中的账号同步为当前 Gemini CLI 使用的本地登录态。'
              permissions={[
                '读取并写入当前系统默认 Gemini 配置目录中的 `oauth_creds.json`、`google_accounts.json` 和 `settings.json`，用于同步当前本地登录态及切号。'
              ]}
              network={[
                'OAuth 与凭证刷新会调用 Google 官方接口（`accounts.google.com`、`oauth2.googleapis.com`）。',
                '配额查询会调用 Gemini 内部接口（`cloudcode-pa.googleapis.com`），仅发送必要的认证字段。'
              ]}
            />
          </h1>
          <p className='page-subtitle' style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
            共 {accounts.length} 个账号，有效 {validCount}，失效 {invalidCount}
            {selectedCount > 0 ? ` · 已选 ${selectedCount} 个` : ''}
          </p>
        </div>

        <div className='page-actions'>
          <button className='action-bar-btn action-bar-btn-primary' onClick={() => openAddModalFromFlow('oauth')} data-tip='添加账号'>
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
            </>
          )}
          <PrivacyToggleButton />
          <button className='action-bar-btn' onClick={() => setShowAdvancedConfig(true)} data-tip='Gemini 设置'>
            <SettingsIcon size={18} />
          </button>
        </div>
      </div>

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
                refreshingIds={quotaActions.runningIds}
                globalLoading={loading}
                onToggleSelect={() => toggleSelection(account.id)}
                onActivate={() => handleActivate(account.id)}
                onRefresh={() => void handleRefreshQuota(account.id)}
                onDelete={() => setConfirmDelete(account.id)}
                onEditTags={() => handleOpenTagEditor(account)}
                onLaunchCli={() => handleLaunchCli(account)}
              />
            ))}
          </div>
          )}

      <GeminiAddAccountModal
        open={showAddModal}
        onClose={closeAddModalFromFlow}
        addTab={addTab}
        onSwitchTab={handleSwitchAddTabFromFlow}
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
        oauthRecovered={oauthRecovered}
        oauthPolling={oauthPolling}
        onSubmitOAuthCallback={handleSubmitOAuthCallback}
        idTokenInput={idTokenInput}
        onIdTokenInputChange={setIdTokenInput}
        accessTokenInput={accessTokenInput}
        onAccessTokenInputChange={setAccessTokenInput}
        refreshTokenInput={refreshTokenInput}
        onRefreshTokenInputChange={setRefreshTokenInput}
        onAddWithToken={handleAddWithToken}
        importJson={importJson}
        onImportJsonChange={setImportJson}
        jsonImportRequiredText={GEMINI_JSON_IMPORT_REQUIRED_TEXT}
        jsonImportExample={GEMINI_JSON_IMPORT_EXAMPLE}
        onImportJson={handleImportJson}
        importingLocal={importingLocal}
        onImportLocal={() => handleImportLocal({ closeAfter: true })}
        toast={toast}
      />

      <GeminiTagModals
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
        onCopy={copyExportJson}
        onDownload={downloadExportJson}
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
