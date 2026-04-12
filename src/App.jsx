import { useEffect, useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import { ToastProvider, useToast } from './components/Toast'
import { ThemeProvider } from './components/ThemeToggle'
import Dashboard from './pages/Dashboard'
import Antigravity from './pages/Antigravity'
import Codex from './pages/Codex'
import Gemini from './pages/Gemini'
import Settings from './pages/Settings'
import { PrivacyProvider } from './components/PrivacyMode'
import RequestLogModal from './components/RequestLogModal'
import { readGlobalSettings, writeGlobalSettings } from './utils/globalSettings'
import { setRequestLogEnabled } from './utils/requestLogClient'

/**
 * App — 主布局
 *
 * 布局参考草图：
 * ┌──────────────────────────────────────────────┐
 * │ [Platform Manager]  │  [Active Instances]    │
 * │  树形结构            │  卡片网格              │
 * │                     │                        │
 * ├──────────────────────────────────────────────┤
 * │ [Status Bar]  Platforms: 3 | Accounts: 5     │
 * └──────────────────────────────────────────────┘
 */
function AppInner () {
  const [activePlatform, setActivePlatform] = useState('dashboard')
  const [platformData, setPlatformData] = useState({
    antigravity: { accounts: [], currentId: null },
    codex: { accounts: [], currentId: null },
    gemini: { accounts: [], currentId: null }
  })
  const [lastActivity, setLastActivity] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [globalSettings, setGlobalSettings] = useState(() => readGlobalSettings())
  const [showRequestLogModal, setShowRequestLogModal] = useState(false)
  const toast = useToast()

  const applyGlobalSettings = useCallback((patch) => {
    const next = writeGlobalSettings(patch)
    setGlobalSettings(next)
    setRequestLogEnabled(next.requestLogEnabled === true)
    return next
  }, [])

  const refreshAll = useCallback(() => {
    const s = window.services
    if (!s) return

    const agList = s.antigravity.list()
    const cxList = s.codex.list()
    const gmList = s.gemini.list()

    setPlatformData({
      antigravity: {
        accounts: agList,
        currentId: s.antigravity.getCurrent()?.id || null
      },
      codex: {
        accounts: cxList,
        currentId: s.codex.getCurrent()?.id || null
      },
      gemini: {
        accounts: gmList,
        currentId: s.gemini.getCurrent()?.id || null
      }
    })
  }, [])

  useEffect(() => {
    // uTools 插件入口事件
    if (window.utools) {
      const bindSubInput = () => {
        if (typeof window.utools.setSubInput !== 'function') return
        window.utools.setSubInput(({ text }) => {
          setSearchQuery(String(text || ''))
        }, '搜索账号或配置...')
      }

      // 双保险：初始化时即绑定一次，避免 onPluginEnter 未触发导致搜索失效
      bindSubInput()

      window.utools.onPluginEnter((action) => {
        bindSubInput()

        const codeMap = {
          AiDeck: 'dashboard',
          'AiDeck-antigravity': 'antigravity',
          'AiDeck-codex': 'codex',
          'AiDeck-gemini': 'gemini',
          aideck: 'dashboard'
        }
        setActivePlatform(codeMap[action.code] || 'dashboard')
      })
    }
    refreshAll()
  }, [])

  useEffect(() => {
    setRequestLogEnabled(globalSettings.requestLogEnabled === true)
    if (!globalSettings.requestLogEnabled) {
      setShowRequestLogModal(false)
    }
  }, [globalSettings.requestLogEnabled])

  useEffect(() => {
    const s = window.services
    if (!s) return
    let disposed = false
    let syncing = false

    const syncCurrentFromLocalAll = async (platformHint) => {
      if (disposed || syncing) return
      syncing = true
      try {
        const autoImport = false
        const platform = String(platformHint || '').trim().toLowerCase()
        const shouldSyncAg = !platform || platform === 'all' || platform === 'antigravity'
        const shouldSyncCx = !platform || platform === 'all' || platform === 'codex'
        const shouldSyncGm = !platform || platform === 'all' || platform === 'gemini'
        const [agRes, cxRes, gmRes] = await Promise.all([
          shouldSyncAg && (s.antigravity && typeof s.antigravity.syncCurrentFromLocal === 'function')
            ? Promise.resolve(s.antigravity.syncCurrentFromLocal({ autoImport }))
            : Promise.resolve(null),
          shouldSyncCx && (s.codex && typeof s.codex.syncCurrentFromLocal === 'function')
            ? Promise.resolve(s.codex.syncCurrentFromLocal({ autoImport }))
            : Promise.resolve(null),
          shouldSyncGm && (s.gemini && typeof s.gemini.syncCurrentFromLocal === 'function')
            ? Promise.resolve(s.gemini.syncCurrentFromLocal({ autoImport }))
            : Promise.resolve(null)
        ])

        if (disposed) return
        const results = [agRes, cxRes, gmRes]
        const changed = results.some(res => res && res.success && res.changed)
        if (changed) {
          refreshAll()
        }

        setPlatformData(prev => {
          let next = prev
          let mutated = false

          const patchCurrent = (key, res) => {
            if (!res || !res.success) return
            const cur = typeof res.currentId === 'string' && res.currentId.trim()
              ? res.currentId.trim()
              : null
            const prevPlatform = prev[key] || { accounts: [], currentId: null }
            const shouldReloadAccounts = !!res.changed
            const nextAccounts = shouldReloadAccounts ? (s[key]?.list?.() || prevPlatform.accounts || []) : (prevPlatform.accounts || [])
            const currentChanged = (prevPlatform.currentId || null) !== cur
            const accountsChanged = shouldReloadAccounts
            if (!currentChanged && !accountsChanged) return
            if (!mutated) {
              next = { ...prev }
              mutated = true
            }
            next[key] = {
              accounts: nextAccounts,
              currentId: cur
            }
          }

          patchCurrent('antigravity', agRes)
          patchCurrent('codex', cxRes)
          patchCurrent('gemini', gmRes)

          return mutated ? next : prev
        })
      } catch (e) {
      } finally {
        syncing = false
      }
    }

    const onLocalStateChange = (event) => {
      const platform = String(event?.detail?.platform || '').trim().toLowerCase()
      void syncCurrentFromLocalAll(platform || 'all')
    }

    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      window.addEventListener('aideck:local-state-change', onLocalStateChange)
    }

    void syncCurrentFromLocalAll('all')

    return () => {
      disposed = true
      if (typeof window !== 'undefined' && window && typeof window.removeEventListener === 'function') {
        window.removeEventListener('aideck:local-state-change', onLocalStateChange)
      }
    }
  }, [refreshAll])

  function handleSelectPlatform (id) {
    setActivePlatform(id)
  }

  function handleSelectAccount (platformId, accountId) {
    setActivePlatform(platformId)
    // 后续可以高亮/滚动到指定账号
  }

  function handleActivityLog (msg) {
    setLastActivity(msg)
  }

  // 统计数据
  const totalAccounts =
    platformData.antigravity.accounts.length +
    platformData.codex.accounts.length +
    platformData.gemini.accounts.length

  const activeCount = [
    platformData.antigravity.currentId,
    platformData.codex.currentId,
    platformData.gemini.currentId
  ].filter(Boolean).length

  const stats = {
    platforms: 3,
    accounts: totalAccounts,
    instances: activeCount,
    running: activeCount
  }

  return (
    <div className='app-root'>
      {activePlatform === 'settings' ? (
        <Settings
          onNavigate={handleSelectPlatform}
          globalSettings={globalSettings}
          onGlobalSettingsChange={applyGlobalSettings}
        />
      ) : (
        <>
          <div className='app-layout'>
            <Sidebar
              activePlatform={activePlatform}
              onSelectPlatform={handleSelectPlatform}
              platformData={platformData}
              searchQuery={searchQuery}
              showRequestLog={globalSettings.requestLogEnabled === true}
              onOpenRequestLog={() => setShowRequestLogModal(true)}
            />
            <main className='main-content'>
              {renderPage(activePlatform, refreshAll, handleActivityLog, handleSelectPlatform, searchQuery, platformData)}
            </main>
          </div>
          <StatusBar
            stats={stats}
            lastActivity={lastActivity}
          />
        </>
      )}
      <RequestLogModal
        open={showRequestLogModal && globalSettings.requestLogEnabled === true}
        onClose={() => setShowRequestLogModal(false)}
        toast={toast}
      />
    </div>
  )
}

function renderPage (page, onRefresh, onActivity, onNavigate, searchQuery, platformData) {
  switch (page) {
    case 'antigravity':
      return (
        <PrivacyProvider key="antigravity" namespace="antigravity">
          <Antigravity onRefresh={onRefresh} onActivity={onActivity} searchQuery={searchQuery} />
        </PrivacyProvider>
      )
    case 'codex':
      return (
        <PrivacyProvider key="codex" namespace="codex">
          <Codex onRefresh={onRefresh} onActivity={onActivity} searchQuery={searchQuery} />
        </PrivacyProvider>
      )
    case 'gemini':
      return (
        <PrivacyProvider key="gemini" namespace="gemini">
          <Gemini onRefresh={onRefresh} onActivity={onActivity} searchQuery={searchQuery} />
        </PrivacyProvider>
      )
    case 'dashboard':
    default:
      return (
        <PrivacyProvider key="dashboard" namespace="dashboard">
          <Dashboard onNavigate={onNavigate} onRefresh={onRefresh} searchQuery={searchQuery} platformData={platformData} />
        </PrivacyProvider>
      )
  }
}

export default function App () {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </ThemeProvider>
  )
}
