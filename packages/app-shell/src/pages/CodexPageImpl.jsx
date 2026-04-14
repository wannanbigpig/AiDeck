import { useEffect, useRef, useState } from 'react'
import { ConfirmModal } from '../components/Modal'
import ExportJsonModal from '../components/ExportJsonModal'
import { useToast } from '../components/Toast'
import { PlatformIcon } from '../components/Icons/PlatformIcons'
import PrivacyToggleButton from '../components/PrivacyToggleButton'
import LocalPendingCard from '../components/LocalPendingCard'
import UsageGuide from '../components/UsageGuide'
import {
  RefreshIcon,
  TagIcon,
  PlusIcon,
  UploadIcon,
  SettingsIcon
} from '../components/Icons/ActionIcons'
import CodexSettingsModal from './codex/CodexSettingsModal'
import CodexAccountItem from './codex/CodexAccountItem'
import CodexAddAccountModal from './codex/CodexAddAccountModal'
import CodexTagModals from './codex/CodexTagModals'
import { useCodexOAuthFlow } from './codex/useCodexOAuthFlow'
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
  resolveQuotaErrorMeta,
  shouldOfferReauthorizeAction,
  normalizeCodexAdvancedSettings,
  readCodexAdvancedSettings
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

/**
 * Codex 账号管理页
 */
export default function Codex ({ onActivity, searchQuery = '' }) {
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
  const [advancedSettings, setAdvancedSettings] = useState(() => initialSettingsRef.current)
  const [tagEditor, setTagEditor] = useState({ id: '', value: '' })
  const [localImportHint, setLocalImportHint] = useState({ visible: false, email: '' })
  const toast = useToast()
  const prevShowCodeReviewQuotaRef = useRef(coerceBooleanSetting(initialSettingsRef.current.showCodeReviewQuota, true))
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
    const currentShow = coerceBooleanSetting(advancedSettings.showCodeReviewQuota, true)
    const prevShow = prevShowCodeReviewQuotaRef.current
    prevShowCodeReviewQuotaRef.current = currentShow
    if (currentShow && !prevShow) {
      void refreshAllQuotas({ silent: true, source: 'show-code-review-toggle' })
    }
  }, [advancedSettings.showCodeReviewQuota])

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
    } else {
      toast.error(result.error || '激活失败')
    }
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
                <button className='action-bar-btn' onClick={() => openBatchTagEditor('')} data-tip='批量设置标签'>
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
                svc={svc}
                showCodeReviewQuota={coerceBooleanSetting(advancedSettings.showCodeReviewQuota, true)}
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
