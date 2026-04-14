import { lazy, Suspense, useEffect, useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import { ToastProvider, useToast } from './components/Toast'
import { ThemeProvider } from './components/ThemeToggle'
import { PrivacyProvider } from './components/PrivacyMode'
import { readGlobalSettings, writeGlobalSettings } from './utils/globalSettings'
import { setRequestLogEnabled } from './utils/requestLogClient'
import { bindPluginSubInput, subscribeHostNavigation, subscribePluginEnter } from './utils/hostBridge.js'
import { useDashboardPlatformData } from './runtime/useDashboardPlatformData.js'
import { useQuotaWarningNotifications } from './runtime/useQuotaWarningNotifications.js'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Antigravity = lazy(() => import('./pages/Antigravity.jsx'))
const Codex = lazy(() => import('./pages/Codex.jsx'))
const Gemini = lazy(() => import('./pages/Gemini.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))
const RequestLogModal = lazy(() => import('./components/RequestLogModal.jsx'))

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
  const [lastActivity, setLastActivity] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [globalSettings, setGlobalSettings] = useState(() => readGlobalSettings())
  const [showRequestLogModal, setShowRequestLogModal] = useState(false)
  const toast = useToast()
  const { platformData } = useDashboardPlatformData(activePlatform)

  useQuotaWarningNotifications(platformData)

  const applyGlobalSettings = useCallback((patch) => {
    const next = writeGlobalSettings(patch)
    setGlobalSettings(next)
    setRequestLogEnabled(next.requestLogEnabled === true)
    return next
  }, [])

  useEffect(() => {
    const bindSubInput = () => {
      bindPluginSubInput(({ text }) => {
        setSearchQuery(String(text || ''))
      }, '搜索账号或配置...')
    }

    bindSubInput()

    const unsubscribePluginEnter = subscribePluginEnter((action) => {
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
    const unsubscribeHostNavigation = subscribeHostNavigation((detail) => {
      const platform = String(detail?.platform || '').trim()
      if (!platform) return
      setActivePlatform(platform)
    })
    return () => {
      unsubscribePluginEnter()
      unsubscribeHostNavigation()
    }
  }, [])

  useEffect(() => {
    setRequestLogEnabled(globalSettings.requestLogEnabled === true)
    if (!globalSettings.requestLogEnabled) {
      setShowRequestLogModal(false)
    }
  }, [globalSettings.requestLogEnabled])

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
      <div className='app-layout'>
        {activePlatform !== 'settings' && (
          <Sidebar
            activePlatform={activePlatform}
            onSelectPlatform={handleSelectPlatform}
            platformData={platformData}
            searchQuery={searchQuery}
            showRequestLog={globalSettings.requestLogEnabled === true}
            onOpenRequestLog={() => setShowRequestLogModal(true)}
          />
        )}
        <main className={`main-content ${activePlatform === 'settings' ? 'no-padding' : ''}`}>
          <Suspense fallback={<PageLoading />}>
            {renderPage(activePlatform, handleActivityLog, handleSelectPlatform, searchQuery, platformData, globalSettings, applyGlobalSettings)}
          </Suspense>
        </main>
      </div>
      <StatusBar
        stats={stats}
        lastActivity={lastActivity}
      />
      <RequestLogModal
        open={showRequestLogModal && globalSettings.requestLogEnabled === true}
        onClose={() => setShowRequestLogModal(false)}
        toast={toast}
      />
    </div>
  )
}

function PageLoading () {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>正在加载...</div>
    </div>
  )
}

function renderPage (page, onActivity, onNavigate, searchQuery, platformData, globalSettings, onGlobalSettingsChange) {
  switch (page) {
    case 'settings':
      return (
        <Settings
          onNavigate={onNavigate}
          globalSettings={globalSettings}
          onGlobalSettingsChange={onGlobalSettingsChange}
        />
      )
    case 'antigravity':
      return (
        <PrivacyProvider key="antigravity" namespace="antigravity">
          <Antigravity onActivity={onActivity} searchQuery={searchQuery} />
        </PrivacyProvider>
      )
    case 'codex':
      return (
        <PrivacyProvider key="codex" namespace="codex">
          <Codex onActivity={onActivity} searchQuery={searchQuery} />
        </PrivacyProvider>
      )
    case 'gemini':
      return (
        <PrivacyProvider key="gemini" namespace="gemini">
          <Gemini onActivity={onActivity} searchQuery={searchQuery} />
        </PrivacyProvider>
      )
    case 'dashboard':
    default:
      return (
        <PrivacyProvider key="dashboard" namespace="dashboard">
          <Dashboard onNavigate={onNavigate} searchQuery={searchQuery} platformData={platformData} />
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
