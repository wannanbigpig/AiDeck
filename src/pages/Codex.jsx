import { useEffect, useRef, useState } from 'react'
import QuotaBar from '../components/QuotaBar'
import Modal, { ConfirmModal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { formatDate, truncateEmail, formatResetTime } from '../utils/format'
import { PlatformIcon } from '../components/PlatformIcons'

const CODEX_SETTINGS_KEY = 'codex_advanced_settings'
const CODEX_AUTO_SWITCH_LOCK_KEY = 'codex_auto_switch_lock'

const DEFAULT_ADVANCED_SETTINGS = {
  autoRefreshMinutes: 10,
  startupPath: '/Applications/Codex.app',
  autoStartCodexApp: false,
  overrideOpenClaw: true,
  overrideOpenCode: true,
  autoRestartOpenCode: true,
  showCodeReviewQuota: true,
  autoSwitch: true,
  autoSwitchHourlyThreshold: 20,
  autoSwitchWeeklyThreshold: 1,
  autoSwitchLockMinutes: 5,
  autoSwitchPreferSameEmail: true
}

function readCodexAdvancedSettings () {
  try {
    if (window.utools) {
      const saved = window.utools.dbStorage.getItem(CODEX_SETTINGS_KEY)
      if (saved && typeof saved === 'object') {
        return { ...DEFAULT_ADVANCED_SETTINGS, ...saved }
      }
    } else {
      const raw = localStorage.getItem(CODEX_SETTINGS_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved && typeof saved === 'object') {
          return { ...DEFAULT_ADVANCED_SETTINGS, ...saved }
        }
      }
    }
  } catch (e) {}
  return { ...DEFAULT_ADVANCED_SETTINGS }
}

function readAutoSwitchLock () {
  try {
    if (window.utools) {
      return window.utools.dbStorage.getItem(CODEX_AUTO_SWITCH_LOCK_KEY)
    }
    const raw = localStorage.getItem(CODEX_AUTO_SWITCH_LOCK_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

function writeAutoSwitchLock (payload) {
  try {
    if (window.utools) {
      window.utools.dbStorage.setItem(CODEX_AUTO_SWITCH_LOCK_KEY, payload)
    } else {
      localStorage.setItem(CODEX_AUTO_SWITCH_LOCK_KEY, JSON.stringify(payload))
    }
  } catch (e) {}
}

function clearAutoSwitchLock () {
  try {
    if (window.utools) {
      window.utools.dbStorage.removeItem(CODEX_AUTO_SWITCH_LOCK_KEY)
    } else {
      localStorage.removeItem(CODEX_AUTO_SWITCH_LOCK_KEY)
    }
  } catch (e) {}
}

/**
 * Codex 账号管理页
 */
export default function Codex ({ onRefresh, onActivity, searchQuery = '' }) {
  const [accounts, setAccounts] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)
  const [advancedSettings, setAdvancedSettings] = useState(() => readCodexAdvancedSettings())
  const toast = useToast()
  const autoRefreshRunningRef = useRef(false)

  const svc = window.services?.codex

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    setAdvancedSettings(readCodexAdvancedSettings())
  }, [])

  function refresh () {
    if (!svc) return
    setAccounts(svc.list())
    const cur = svc.getCurrent()
    setCurrentId(cur?.id || null)
    onRefresh?.()
  }

  function isLockedForAutoSwitch (accountId) {
    if (!accountId) return false
    const lock = readAutoSwitchLock()
    if (!lock || lock.accountId !== accountId) return false
    if (typeof lock.lockedUntil !== 'number' || lock.lockedUntil <= Date.now()) {
      clearAutoSwitchLock()
      return false
    }
    return true
  }

  async function maybeAutoSwitchAfterQuotaRefresh (source = 'manual') {
    if (!svc) return false
    const settings = readCodexAdvancedSettings()
    setAdvancedSettings(settings)
    if (!settings.autoSwitch) return false

    const current = svc.getCurrent()
    if (!current || !current.id) return false
    if (isLockedForAutoSwitch(current.id)) return false

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
    if (!next) return false

    const switchResult = svc.switchAccount(next.id, settings)
    if (!switchResult.success) {
      toast.warning('自动切号失败: ' + (switchResult.error || '未知错误'))
      return false
    }

    clearAutoSwitchLock()
    refresh()
    toast.success(`自动切号成功：${next.email || next.id}`)
    if (Array.isArray(switchResult.warnings) && switchResult.warnings.length > 0) {
      toast.warning(switchResult.warnings[0])
    }
    onActivity?.(`自动切号(${source}) -> ${next.email || next.id}`)
    return true
  }

  async function refreshAllQuotas (opts = {}) {
    if (!svc) return
    const { silent = false, source = 'manual' } = opts

    if (autoRefreshRunningRef.current) return
    autoRefreshRunningRef.current = true

    try {
      if (!silent) {
        setLoading(true)
        toast.success('开始刷新全量配额...')
      }

      const latestAccounts = svc.list() || []
      for (let i = 0; i < latestAccounts.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 300))
        await svc.refreshQuota(latestAccounts[i].id)
      }

      refresh()
      await maybeAutoSwitchAfterQuotaRefresh(source)

      if (!silent) {
        toast.success('刷新全部配额完毕')
      }
    } finally {
      autoRefreshRunningRef.current = false
      if (!silent) {
        setLoading(false)
      }
    }
  }

  function handleImportLocal () {
    setLoading(true)
    try {
      const result = svc.importFromLocal()
      if (result.error) {
        toast.error(result.error)
      } else if (result.imported) {
        toast.success('成功导入 Codex 账号')
        refresh()
      }
    } catch (e) {
      toast.error('导入失败: ' + e.message)
    }
    setLoading(false)
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
      setShowImport(false)
      setImportJson('')
      refresh()
    }
  }

  function handleSwitch (id) {
    const settings = readCodexAdvancedSettings()
    setAdvancedSettings(settings)
    const result = svc.switchAccount(id, settings)
    if (result.success) {
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
    refresh()
  }

  async function handleRefreshQuota (id) {
    const result = await svc.refreshQuota(id)
    if (result && result.error) {
      toast.warning(result.error)
    } else if (result && result.message) {
      toast.info(result.message)
    }
    refresh()
    await maybeAutoSwitchAfterQuotaRefresh('single-refresh')
  }

  const handleRefreshAll = async () => {
    await refreshAllQuotas({ silent: false, source: 'manual-all' })
  }

  const handleTempLock = () => {
    const settings = readCodexAdvancedSettings()
    const lockMinutes = Math.max(0, Number(settings.autoSwitchLockMinutes) || 5)
    if (!currentId) {
      toast.warning('当前没有激活账号，无法锁定')
      return
    }
    if (lockMinutes <= 0) {
      clearAutoSwitchLock()
      toast.info('已关闭临时锁定')
      return
    }
    const lockedUntil = Date.now() + lockMinutes * 60 * 1000
    writeAutoSwitchLock({ accountId: currentId, lockedUntil })
    toast.success(`已锁定当前号 ${lockMinutes} 分钟，自动切号会跳过它`)
  }

  function handleExport () {
    const ids = accounts.map(a => a.id)
    const json = svc.exportAccounts(ids)
    if (window.utools) {
      window.utools.copyText(json)
      toast.success('已复制到剪贴板')
    }
  }

  useEffect(() => {
    const minutes = Number(advancedSettings.autoRefreshMinutes)
    if (!minutes || minutes <= 0) return

    const timer = setInterval(() => {
      void refreshAllQuotas({ silent: true, source: 'auto-refresh' })
    }, minutes * 60 * 1000)

    return () => clearInterval(timer)
  }, [advancedSettings.autoRefreshMinutes])

  return (
    <div>
      <div className='page-header'>
        <div>
          <h1 className='page-title'>
            <PlatformIcon platform="codex" size={24} /> Codex
            <button className='icon-btn' style={{ marginLeft: 8 }} onClick={() => setShowAdvancedConfig(true)} title='高级偏好设置'>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </h1>
          <p className='page-subtitle'>
            {accounts.length} 个账号
            {currentId ? ' · 已激活' : ''} · 凭证路径: ~/.codex/auth.json
          </p>
        </div>
        <div className='page-actions'>
          <button className='btn' onClick={handleImportLocal} disabled={loading}>
            📂 本地导入
          </button>
          <button className='btn' onClick={() => setShowImport(true)}>
            📋 JSON 导入
          </button>
          {accounts.length > 0 && (
            <>
              <button className='btn' onClick={handleRefreshAll} disabled={loading}>
                🔄 刷新全套配额
              </button>
              <button className='btn' onClick={handleTempLock}>
                🔒 临时锁定切号
              </button>
              <button className='btn' onClick={handleExport}>
                📤 导出
              </button>
            </>
          )}
        </div>
      </div>

      {accounts.length === 0
        ? (
          <div className='empty-state'>
            <div className='empty-state-icon'>💻</div>
            <div className='empty-state-text'>
              暂无 Codex 账号<br />
              点击"本地导入"从 ~/.codex/auth.json 读取当前登录账号
            </div>
          </div>
          )
        : (
          <div className='account-grid'>
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
                onSwitch={() => handleSwitch(account.id)}
                onRefresh={() => handleRefreshQuota(account.id)}
                onDelete={() => setConfirmDelete(account.id)}
                svc={svc}
                showCodeReviewQuota={advancedSettings.showCodeReviewQuota}
              />
            ))}
          </div>
          )}

      <Modal
        title='JSON 导入 Codex 账号'
        open={showImport}
        onClose={() => setShowImport(false)}
        footer={
          <>
            <button className='btn' onClick={() => setShowImport(false)}>取消</button>
            <button className='btn btn-primary' onClick={handleImportJson}>导入</button>
          </>
        }
      >
        <div className='form-group'>
          <label className='form-label'>粘贴账号 JSON 数据</label>
          <textarea
            className='form-textarea'
            placeholder='[{"email":"...","tokens":{"id_token":"...","access_token":"...","refresh_token":"..."}}]'
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
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

function CodexSettingsModal ({ open, onClose, toast, settings: outerSettings, onSettingsChange, svc }) {
  const [settings, setSettings] = useState({ ...DEFAULT_ADVANCED_SETTINGS, ...(outerSettings || {}) })

  useEffect(() => {
    if (open) {
      let saved = null
      try {
        if (window.utools) {
          saved = window.utools.dbStorage.getItem('codex_advanced_settings')
        } else {
          const s = localStorage.getItem('codex_advanced_settings')
          if (s) saved = JSON.parse(s)
        }
      } catch (e) {}
      if (saved) {
        const merged = { ...DEFAULT_ADVANCED_SETTINGS, ...saved }
        setSettings(merged)
      } else {
        const fallback = { ...DEFAULT_ADVANCED_SETTINGS, ...(outerSettings || {}) }
        setSettings(fallback)
      }
    }
  }, [open, outerSettings])

  const handleChange = (key, val) => {
    setSettings(prev => {
      const next = { ...prev, [key]: val }
      if (window.utools) {
        window.utools.dbStorage.setItem('codex_advanced_settings', next)
      } else {
        localStorage.setItem('codex_advanced_settings', JSON.stringify(next))
      }
      onSettingsChange?.(next)
      return next
    })
  }

  const handlePickStartupPath = () => {
    if (!window.utools) {
      toast.info('当前环境不支持文件选择器，请手动填写路径')
      return
    }
    const files = window.utools.showOpenDialog({
      title: '选择 Codex App 路径',
      properties: ['openFile', 'openDirectory']
    })
    if (!files || !files[0]) return
    handleChange('startupPath', files[0])
    toast.success('已更新启动路径')
  }

  const handleAutoDetectStartupPath = () => {
    if (!svc || typeof svc.detectCodexAppPath !== 'function') {
      toast.warning('当前版本不支持自动探测')
      return
    }
    const detected = svc.detectCodexAppPath(settings.startupPath || '')
    if (!detected) {
      toast.warning('未探测到 Codex App，请手动选择')
      return
    }
    handleChange('startupPath', detected)
    toast.success('已自动探测 Codex App 路径')
  }

  const ToggleSwitch = ({ checked, onChange }) => (
    <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, flexShrink: 0 }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{
        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: checked ? 'var(--accent-blue)' : 'var(--border-muted)',
        transition: '.2s', borderRadius: 22
      }}>
        <span style={{
          position: 'absolute', content: '""', height: 18, width: 18, left: 2, bottom: 2,
          backgroundColor: 'white', transition: '.2s', borderRadius: '50%',
          transform: checked ? 'translateX(18px)' : 'translateX(0)'
        }} />
      </span>
    </label>
  )

  const TitleLabel = ({ icon, text }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
      {icon} {text}
    </div>
  )

  const RefreshIcon = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.8"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
  const FolderIcon = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>

  const SwitchRow = ({ label, propKey, isSub = false }) => (
    <div style={{ padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: isSub ? 'var(--text-secondary)' : 'var(--text-primary)', paddingLeft: isSub ? 24 : 0 }}>
        {label}
      </div>
      <ToggleSwitch checked={settings[propKey]} onChange={e => handleChange(propKey, e.target.checked)} />
    </div>
  )

  return (
    <Modal title='Codex 设置' open={open} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        
        {/* 配额自动刷新 */}
        <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
          <TitleLabel icon={RefreshIcon} text="配额自动刷新" />
          <select className='settings-input' style={{ width: '100%', background: 'var(--bg-surface)' }} value={settings.autoRefreshMinutes} onChange={e => handleChange('autoRefreshMinutes', Number(e.target.value))}>
            <option value={0}>禁用自动刷新</option>
            <option value={5}>每 5 分钟</option>
            <option value={10}>10 分</option>
            <option value={30}>30 分</option>
          </select>
        </div>

        {/* 启动路径 */}
        <div style={{ padding: '16px 0', borderBottom: '1px solid var(--border-default)' }}>
          <TitleLabel icon={FolderIcon} text="启动路径" />
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" className='settings-input' style={{ flex: 1 }} value={settings.startupPath} onChange={e => handleChange('startupPath', e.target.value)} />
            <button className='btn' style={{ background: 'var(--bg-surface)' }} onClick={handlePickStartupPath}>选择</button>
            <button className='btn' style={{ background: 'var(--bg-surface)' }} onClick={handleAutoDetectStartupPath}>{RefreshIcon}</button>
          </div>
        </div>

        {/* 开关功能组 */}
        <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border-default)' }}>
          <SwitchRow label="切换 Codex 时自动启动 Codex App" propKey="autoStartCodexApp" />
          <SwitchRow label="切换 Codex 时覆盖 OpenClaw 登录信息" propKey="overrideOpenClaw" />
          <SwitchRow label="切换 Codex 时覆盖 OpenCode 登录信息" propKey="overrideOpenCode" />
          <SwitchRow label="切换 Codex 时自动重启 OpenCode" propKey="autoRestartOpenCode" />
          <SwitchRow label="显示 Code Review 配额" propKey="showCodeReviewQuota" />
        </div>

        {/* 自动切号高阶控制组 */}
        <div style={{ paddingTop: 8 }}>
          <SwitchRow label="自动切号" propKey="autoSwitch" />
          
          {settings.autoSwitch && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>primary_window (5小时配额) 切号阈值</span>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-muted)' }}>
                  <input type='number' style={{ width: 40, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-primary)', textAlign: 'right', fontSize: 14 }} value={settings.autoSwitchHourlyThreshold} onChange={e => handleChange('autoSwitchHourlyThreshold', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                  <span style={{ color: 'var(--text-muted)', fontSize: 14, marginLeft: 8 }}>%</span>
                </div>
              </div>

              <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 6, fontSize: 12, color: 'var(--text-muted)', border: '1px solid var(--border-muted)' }}>
                OR (命中任一即触发)
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>secondary_window (周配额) 切号阈值</span>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-muted)' }}>
                  <input type='number' style={{ width: 40, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-primary)', textAlign: 'right', fontSize: 14 }} value={settings.autoSwitchWeeklyThreshold} onChange={e => handleChange('autoSwitchWeeklyThreshold', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                  <span style={{ color: 'var(--text-muted)', fontSize: 14, marginLeft: 8 }}>%</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>临时锁定时长</span>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-muted)' }}>
                  <input
                    type='number'
                    min='0'
                    style={{ width: 40, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-primary)', textAlign: 'right', fontSize: 14 }}
                    value={settings.autoSwitchLockMinutes}
                    onChange={e => handleChange('autoSwitchLockMinutes', Math.max(0, Number(e.target.value) || 0))}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: 14, marginLeft: 8 }}>分钟</span>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </Modal>
  )
}

function CodexAccountItem ({ account, isCurrent, onSwitch, onRefresh, onDelete, svc, showCodeReviewQuota = true }) {
  const quota = account.quota
  const planName = svc?.getPlanDisplayName(account.plan_type) || ''

  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [flipped, setFlipped] = useState(false)

  const handleRefreshWrap = async () => {
    if (refreshing) return
    setRefreshing(true)
    try { await onRefresh() } catch (e) {}
    setRefreshing(false)
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

  const SpinnerBtnIcon = () => (
    <svg className="spin-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
    </svg>
  )

  const planBadgeClass = (() => {
    const upper = (planName || '').toUpperCase()
    if (upper === 'PLUS') return 'badge-plus'
    if (upper === 'PRO') return 'badge-pro'
    if (upper === 'TEAM') return 'badge-team'
    return 'badge-free'
  })()

  return (
    <div className={`account-card-container ${isCurrent ? 'current' : ''}`}>
      <div className={`account-card-inner ${flipped ? 'flipped' : ''}`}>
        
        {/* ====== 翻转卡片：正面 ====== */}
        <div className='account-card-front account-card' onClick={() => setFlipped(true)} style={{ cursor: 'pointer' }}>
          <div className='account-card-row'>
            <span className='account-email'>{truncateEmail(account.email, 28)}</span>
            {planName && <span className={`badge ${planBadgeClass}`}>{planName}</span>}
            {isCurrent && <span className='badge badge-active'>当前</span>}
          </div>

          {account.tags && account.tags.length > 0 && (
            <div className='account-tags'>
              {account.tags.map((tag, i) => <span key={i} className='tag'>{tag}</span>)}
            </div>
          )}

          {quota && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {((planName || '').toUpperCase() !== 'FREE' && typeof quota.hourly_percentage === 'number') && (
                <QuotaBar
                  percentage={quota.hourly_percentage}
                  label='5小时'
                  resetTime={quota.hourly_reset_time ? formatResetTime(quota.hourly_reset_time) : ''}
                  requestsLeft={quota.hourly_requests_left}
                  requestsLimit={quota.hourly_requests_limit}
                />
              )}
              {typeof quota.weekly_percentage === 'number' && (
                <QuotaBar
                  percentage={quota.weekly_percentage}
                  label='每周'
                  resetTime={quota.weekly_reset_time ? formatResetTime(quota.weekly_reset_time) : ''}
                  requestsLeft={quota.weekly_requests_left}
                  requestsLimit={quota.weekly_requests_limit}
                />
              )}
              {showCodeReviewQuota && typeof quota.code_review_percentage === 'number' && (
                <QuotaBar
                  percentage={quota.code_review_percentage}
                  label='代码审查'
                  resetTime={quota.code_review_reset_time ? formatResetTime(quota.code_review_reset_time) : ''}
                  requestsLeft={quota.code_review_requests_left}
                  requestsLimit={quota.code_review_requests_limit}
                />
              )}
            </div>
          )}

          <div className='account-meta'>
            {account.auth_mode && <span>方式: {account.auth_mode}</span>}
            {account.created_at
              ? <span>· 创建: {formatDate(account.created_at)}</span>
              : null}
          </div>

          <div className='account-actions' style={{ justifyContent: 'flex-end', gap: '8px' }} onClick={e => e.stopPropagation()}>
            <button className={`action-icon-btn ${syncing ? 'is-loading' : ''}`} onClick={handleSyncWrap} title='同步账号信息'>
              {syncing ? <SpinnerBtnIcon /> : (
                <svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true" fill="currentColor">
                  <path d="M315.8 960.5H196.24c-70.99 0-128.74-57.75-128.74-128.75V199.24c0-70.99 57.75-128.74 128.74-128.74h632.51c70.99 0 128.75 57.75 128.75 128.74v376.87c0 17.67-14.33 32-32 32s-32-14.33-32-32V199.24c0-35.7-29.04-64.74-64.75-64.74H196.24c-35.7 0-64.74 29.04-64.74 64.74v632.51c0 35.7 29.04 64.75 64.74 64.75H315.8c17.67 0 32 14.33 32 32s-14.32 32-32 32z" />
                  <path d="M598.48 479.15 480.09 363.4 361.7 479.15c-12.64 12.35-12.87 32.61-0.51 45.25 6.27 6.41 14.57 9.63 22.88 9.63 8.07 0 16.14-3.03 22.37-9.12L449 483.3V928c0 17.67 14.33 32 32 32s32-14.33 32-32V485.08l40.74 39.83c12.64 12.35 32.9 12.13 45.25-0.51 12.36-12.64 12.13-32.9-0.51-45.25zM875.79 800.33c-12.36-12.64-32.62-12.87-45.25-0.51L789 840.43V399c0-17.67-14.33-32-32-32s-32 14.33-32 32v441.64l-41.76-40.82c-12.64-12.35-32.9-12.13-45.25 0.51-12.36 12.64-12.13 32.9 0.51 45.25l118.39 115.75 118.39-115.75c12.64-12.35 12.87-32.61 0.51-45.25z" />
                </svg>
              )}
            </button>

            {!isCurrent && (
              <button className={`action-icon-btn primary ${switching ? 'is-loading' : ''}`} onClick={handleSwitchWrap} title='切换此号'>
                {switching ? <SpinnerBtnIcon /> : (
                  <svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true" fill="currentColor">
                    <path d="M575.914667 725.333333a21.397333 21.397333 0 0 1-21.248-21.162666V319.829333A21.184 21.184 0 0 1 576 298.666667c11.776 0 21.333333 9.706667 21.333333 21.162666v333.909334l85.568-85.568a21.226667 21.226667 0 0 1 30.101334 0.064c8.32 8.32 8.213333 21.973333 0.085333 30.101333l-120.832 120.810667a21.141333 21.141333 0 0 1-16.341333 6.186666z m-152.789334-426.325333a21.418667 21.418667 0 0 1 24.896 20.864V704.213333a21.205333 21.205333 0 0 1-21.333333 21.162667c-11.797333 0-21.354667-9.706667-21.354667-21.162667V364.266667l-91.669333 91.605333a21.248 21.248 0 0 1-30.122667-0.064 21.418667 21.418667 0 0 1-0.064-30.101333l120.896-120.810667a21.184 21.184 0 0 1 18.752-5.888z m252.202667-181.290667A425.429333 425.429333 0 0 0 512 85.333333C276.352 85.333333 85.333333 276.352 85.333333 512s191.018667 426.666667 426.666667 426.666667 426.666667-191.018667 426.666667-426.666667c0-56.746667-11.093333-112-32.384-163.328a21.333333 21.333333 0 0 0-39.402667 16.341333A382.762667 382.762667 0 0 1 896 512c0 212.074667-171.925333 384-384 384S128 724.074667 128 512 299.925333 128 512 128c51.114667 0 100.8 9.984 146.986667 29.12a21.333333 21.333333 0 0 0 16.341333-39.402667z" />
                  </svg>
                )}
              </button>
            )}

            <button className={`action-icon-btn ${refreshing ? 'is-loading' : ''}`} onClick={handleRefreshWrap} title='提取最新配额详情'>
              {refreshing ? <SpinnerBtnIcon /> : (
                <svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true" fill="currentColor" opacity="0.8">
                  <path d="M989.311588 512.085547a36.053318 36.053318 0 0 0-38.613317 33.194652 438.570484 438.570484 0 0 1-138.794609 288.63988A438.186484 438.186484 0 0 1 511.999787 951.978697c-87.039964 0-171.093262-25.258656-243.199899-73.258636a439.63715 439.63715 0 0 1-148.778605-166.698598h99.967959a35.967985 35.967985 0 1 0 0-72.021303H36.010652a35.967985 35.967985 0 0 0-36.010652 36.010652v183.97859a35.967985 35.967985 0 1 0 72.021303 0v-85.973298A513.066453 513.066453 0 0 0 228.863905 938.666702C312.917203 994.517346 410.666496 1024 511.999787 1024c130.005279 0 253.994561-48.810646 349.013188-137.386609a509.653121 509.653121 0 0 0 161.493266-335.914527 35.967985 35.967985 0 0 0-33.194653-38.613317zM988.031588 128.000373a35.967985 35.967985 0 0 0-36.053318 36.010652v85.973298A512.298453 512.298453 0 0 0 795.007669 85.333724 509.439788 509.439788 0 0 0 511.999787 0.000427a510.122454 510.122454 0 0 0-349.013188 137.386609 510.207787 510.207787 0 0 0-161.5786 335.914527 36.053318 36.053318 0 0 0 33.194653 38.613317 36.053318 36.053318 0 0 0 38.613317-33.194653 438.570484 438.570484 0 0 1 138.794609-288.63988A438.613151 438.613151 0 0 1 511.999787 71.979063c87.039964 0 171.093262 25.301323 243.199898 73.301303a439.63715 439.63715 0 0 1 148.821272 166.741264h-100.010625a35.967985 35.967985 0 1 0 0 71.978637h183.97859A35.967985 35.967985 0 0 0 1023.999573 347.989615V164.011025A35.967985 35.967985 0 0 0 987.988922 128.000373z" />
                </svg>
              )}
            </button>

            <button className='action-icon-btn danger' onClick={onDelete} title='删除弃用此账号'>
              <svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true" fill="currentColor">
                <path d="M92.748283 203.507071h838.503434v44.140606H92.748283zM644.402424 115.238788v44.127677h44.127677V115.238788c0-24.384646-19.75596-44.127677-43.998384-44.127677h-265.050505a43.97899 43.97899 0 0 0-31.172525 12.916364 43.918222 43.918222 0 0 0-12.825859 31.211313v44.127677h44.127677V115.238788h264.791919z" />
                <path d="M203.073939 909.614545v-661.979798H158.946263V909.575758c0 24.410505 19.639596 44.179394 44.179394 44.179394h617.761616c24.410505 0 44.179394-19.639596 44.179394-44.179394V247.634747H820.926061v661.979798H203.073939z" />
                <path d="M313.412525 335.90303h44.127677V733.090909h-44.127677V335.90303z m176.523637 0h44.127676V733.090909H489.936162V335.90303z m176.523636 0h44.127677V733.090909h-44.127677V335.90303z" />
              </svg>
            </button>
          </div>
        </div>

        {/* ====== 翻转卡片：反面 ====== */}
        <div className='account-card-back account-card' onClick={() => setFlipped(false)}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 12, borderBottom: '1px solid var(--border-muted)', marginBottom: 12 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--text-muted)' }} />
              <span style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--text-primary)' }}>{account.email}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
              <div><span style={{ color: 'var(--text-muted)', display: 'inline-block', width: 60 }}>分组属性</span> {account.tags?.[0] || 'Personal'}</div>
              <div><span style={{ color: 'var(--text-muted)', display: 'inline-block', width: 60 }}>登录凭据</span> {account.auth_mode === 'oauth' ? 'google OAuth / Third-party' : account.auth_mode || '本地凭证'}</div>
              <div><span style={{ color: 'var(--text-muted)', display: 'inline-block', width: 60 }}>活跃状态</span> <span style={{ color: 'var(--accent-green)' }}>正常运行中</span></div>
              <div style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--text-muted)', display: 'inline-block', width: 60 }}>底层 ID</span> {account.id || 'N/A'}
              </div>
            </div>

            <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', paddingTop: 16 }}>
              点击卡片任意区域返回配额监控
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
