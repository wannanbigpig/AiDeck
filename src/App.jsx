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
  const toast = useToast()

  useEffect(() => {
    // uTools 插件入口事件
    if (window.utools) {
      window.utools.onPluginEnter((action) => {
        window.utools.setSubInput(({ text }) => {
          setSearchQuery(text)
        }, '搜索账号或配置...')

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
        <Settings onNavigate={handleSelectPlatform} />
      ) : (
        <>
          <div className='app-layout'>
            <Sidebar
              activePlatform={activePlatform}
              onSelectPlatform={handleSelectPlatform}
              platformData={platformData}
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
    </div>
  )
}

function renderPage (page, onRefresh, onActivity, onNavigate, searchQuery, platformData) {
  switch (page) {
    case 'antigravity':
      return <Antigravity onRefresh={onRefresh} onActivity={onActivity} searchQuery={searchQuery} />
    case 'codex':
      return <Codex onRefresh={onRefresh} onActivity={onActivity} searchQuery={searchQuery} />
    case 'gemini':
      return <Gemini onRefresh={onRefresh} onActivity={onActivity} searchQuery={searchQuery} />
    case 'dashboard':
    default:
      return <Dashboard onNavigate={onNavigate} onRefresh={onRefresh} searchQuery={searchQuery} platformData={platformData} />
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
