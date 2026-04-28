import { lazy, Suspense, useEffect, useRef, useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import { ToastProvider, useToast } from './components/Toast'
import { GlobalNoticeProvider } from './components/GlobalNotice'
import AnnouncementCenter from './components/AnnouncementCenter'
import { ThemeProvider } from './components/ThemeToggle'
import { PrivacyProvider } from './components/PrivacyMode'
import { readGlobalSettings, writeGlobalSettings } from './utils/globalSettings'
import { setRequestLogEnabled } from './utils/requestLogClient'
import { bindPluginSubInput, readSharedSetting, subscribeHostNavigation, subscribePluginEnter, writeSharedSetting } from './utils/hostBridge.js'
import { useDashboardPlatformData } from './runtime/useDashboardPlatformData.js'
import { useQuotaWarningNotifications } from './runtime/useQuotaWarningNotifications.js'
import { useAnnouncements } from './runtime/useAnnouncements.js'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Antigravity = lazy(() => import('./pages/Antigravity.jsx'))
const Codex = lazy(() => import('./pages/Codex.jsx'))
const Gemini = lazy(() => import('./pages/Gemini.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))
const RequestLogModal = lazy(() => import('./components/RequestLogModal.jsx'))

const LAST_ACTIVE_PLATFORM_KEY = 'aideck_last_active_platform'
const CODEX_ACTIVE_VIEW_KEY = 'codex_active_view'
const RESTORABLE_PLATFORMS = new Set(['dashboard', 'antigravity', 'codex', 'gemini'])
const DEFAULT_SEARCH_PLACEHOLDER = '搜索账号或配置...'
const CODEX_SESSION_SEARCH_PLACEHOLDER = '搜索会话或工作区...'

function normalizeRestorablePlatform (value, fallback = 'dashboard') {
  const platform = String(value || '').trim()
  return RESTORABLE_PLATFORMS.has(platform) ? platform : fallback
}

function readLastActivePlatform () {
  return normalizeRestorablePlatform(readSharedSetting(LAST_ACTIVE_PLATFORM_KEY, 'dashboard'))
}

function writeLastActivePlatform (platform) {
  const normalized = normalizeRestorablePlatform(platform, '')
  if (!normalized) return
  writeSharedSetting(LAST_ACTIVE_PLATFORM_KEY, normalized)
}

function normalizeCodexActiveView (value) {
  return value === 'sessions' ? 'sessions' : 'accounts'
}

function readCodexActiveView () {
  return normalizeCodexActiveView(readSharedSetting(CODEX_ACTIVE_VIEW_KEY, 'accounts'))
}

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
  const [activePlatform, setActivePlatform] = useState(() => readLastActivePlatform())
  const [settingsReturnPlatform, setSettingsReturnPlatform] = useState(() => readLastActivePlatform())
  const [codexActiveView, setCodexActiveView] = useState(() => readCodexActiveView())
  const [lastActivity, setLastActivity] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [globalSettings, setGlobalSettings] = useState(() => readGlobalSettings())
  const [showRequestLogModal, setShowRequestLogModal] = useState(false)
  const [showAnnouncementCenter, setShowAnnouncementCenter] = useState(false)
  const activePlatformRef = useRef(activePlatform)
  const toast = useToast()
  const { platformData } = useDashboardPlatformData(activePlatform)
  const announcements = useAnnouncements()
  const searchPlaceholder = activePlatform === 'codex' && codexActiveView === 'sessions'
    ? CODEX_SESSION_SEARCH_PLACEHOLDER
    : DEFAULT_SEARCH_PLACEHOLDER

  useQuotaWarningNotifications(platformData)

  useEffect(() => {
    activePlatformRef.current = activePlatform
  }, [activePlatform])

  const applyGlobalSettings = useCallback((patch) => {
    const next = writeGlobalSettings(patch)
    setGlobalSettings(next)
    setRequestLogEnabled(next.requestLogEnabled === true)
    return next
  }, [])

  const bindSubInput = useCallback(() => {
    bindPluginSubInput(({ text }) => {
      setSearchQuery(String(text || ''))
    }, searchPlaceholder)
  }, [searchPlaceholder])

  useEffect(() => {
    bindSubInput()

    const unsubscribePluginEnter = subscribePluginEnter((action) => {
      const codeMap = {
        'AiDeck-antigravity': 'antigravity',
        'AiDeck-codex': 'codex',
        'AiDeck-gemini': 'gemini'
      }
      const nextPlatform = codeMap[action.code] || readLastActivePlatform()
      if (nextPlatform === 'codex') {
        setCodexActiveView(readCodexActiveView())
      }
      setActivePlatform(nextPlatform)
      activePlatformRef.current = nextPlatform
      if (nextPlatform !== 'settings') {
        setSettingsReturnPlatform(nextPlatform)
        writeLastActivePlatform(nextPlatform)
      }
    })
    const unsubscribeHostNavigation = subscribeHostNavigation((detail) => {
      const platform = String(detail?.platform || '').trim()
      if (!platform) return
      const currentPlatform = activePlatformRef.current
      if (platform === 'settings' && currentPlatform !== 'settings') {
        setSettingsReturnPlatform(currentPlatform)
      } else if (platform !== 'settings') {
        setSettingsReturnPlatform(platform)
        writeLastActivePlatform(platform)
      }
      if (platform === 'codex') {
        setCodexActiveView(readCodexActiveView())
      }
      setActivePlatform(platform)
      activePlatformRef.current = platform
    })
    return () => {
      unsubscribePluginEnter()
      unsubscribeHostNavigation()
    }
  }, [bindSubInput])

  useEffect(() => {
    setRequestLogEnabled(globalSettings.requestLogEnabled === true)
    if (!globalSettings.requestLogEnabled) {
      setShowRequestLogModal(false)
    }
  }, [globalSettings.requestLogEnabled])

  function handleSelectPlatform (id) {
    if (id === 'settings' && activePlatform !== 'settings') {
      setSettingsReturnPlatform(activePlatform)
    } else if (id !== 'settings') {
      setSettingsReturnPlatform(id)
      writeLastActivePlatform(id)
    }
    setActivePlatform(id)
    activePlatformRef.current = id
  }

  function handleSelectAccount (platformId, accountId) {
    setSettingsReturnPlatform(platformId)
    writeLastActivePlatform(platformId)
    setActivePlatform(platformId)
    activePlatformRef.current = platformId
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
            announcementUnreadCount={announcements.state.unreadIds.length}
            onOpenAnnouncements={() => setShowAnnouncementCenter(true)}
          />
        )}
        <main className={`main-content ${activePlatform === 'settings' ? 'no-padding' : ''}`}>
          <Suspense fallback={<PageLoading />}>
            {renderPage(activePlatform, handleActivityLog, handleSelectPlatform, searchQuery, platformData, globalSettings, applyGlobalSettings, settingsReturnPlatform, setCodexActiveView)}
          </Suspense>
        </main>
      </div>
      <StatusBar
        stats={stats}
        lastActivity={lastActivity}
      />
      <Suspense fallback={null}>
        <RequestLogModal
          open={showRequestLogModal && globalSettings.requestLogEnabled === true}
          onClose={() => setShowRequestLogModal(false)}
          toast={toast}
        />
      </Suspense>
      <AnnouncementCenter
        open={showAnnouncementCenter}
        onClose={() => setShowAnnouncementCenter(false)}
        announcementState={announcements.state}
        loading={announcements.loading}
        onRefresh={announcements.refresh}
        onMarkAsRead={announcements.markAsRead}
        onMarkAllAsRead={announcements.markAllAsRead}
        onNavigate={handleSelectPlatform}
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

function renderPage (page, onActivity, onNavigate, searchQuery, platformData, globalSettings, onGlobalSettingsChange, settingsReturnPlatform, onCodexViewChange) {
  switch (page) {
    case 'settings':
      return (
        <Settings
          onNavigate={onNavigate}
          returnPlatform={settingsReturnPlatform}
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
          <Codex onActivity={onActivity} searchQuery={searchQuery} onViewChange={onCodexViewChange} />
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
        <GlobalNoticeProvider>
          <AppInner />
        </GlobalNoticeProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
