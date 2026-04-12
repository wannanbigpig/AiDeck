import { useState } from 'react'
import { useTheme } from './ThemeToggle'
import { PlatformIcon } from './Icons/PlatformIcons'
import { SidebarCollapseIcon, LogIcon, SettingsIcon } from './Icons/ActionIcons'

/**
 * 侧边栏 — 简洁平台列表 + 主题切换
 */
function matchesSidebarSearch (account, query) {
  if (!query) return true
  const acc = account && typeof account === 'object' ? account : {}
  const tagsText = Array.isArray(acc.tags) ? acc.tags.join(' ') : ''
  const textToSearch = [
    acc.email,
    acc.username,
    acc.name,
    acc.id,
    acc.teamName,
    acc.org,
    acc.workspace,
    acc.account_name,
    acc.plan_type,
    acc.plan_name,
    acc.tier_id,
    tagsText
  ].join(' ').toLowerCase()
  return textToSearch.includes(query)
}

export default function Sidebar ({
  activePlatform,
  onSelectPlatform,
  platformData,
  searchQuery = '',
  showRequestLog = false,
  onOpenRequestLog
}) {
  const [collapsed, setCollapsed] = useState(false)
  const query = String(searchQuery || '').trim().toLowerCase()

  const platforms = [
    { id: 'dashboard', name: '仪表盘' },
    { id: 'antigravity', name: 'Antigravity' },
    { id: 'codex', name: 'Codex' },
    { id: 'gemini', name: 'Gemini CLI' }
  ]

  return (
    <div className='sidebar-shell'>
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className='sidebar-header'>
          <div className='sidebar-brand'>
            <img src='./logo.png' alt='AiDeck' style={{ width: '28px', height: '28px', flexShrink: 0, borderRadius: '6px' }} />
            <span className='sidebar-brand-text'>AiDeck</span>
          </div>
        </div>
        <nav className='sidebar-nav'>
          {platforms.map(p => {
            const data = platformData[p.id]
            const count = data
              ? (query
                  ? (Array.isArray(data.accounts) ? data.accounts.filter(acc => matchesSidebarSearch(acc, query)).length : 0)
                  : (Array.isArray(data.accounts) ? data.accounts.length : 0))
              : null

            return (
              <div
                key={p.id}
                className={`sidebar-item ${activePlatform === p.id ? 'active' : ''}`}
                onClick={() => onSelectPlatform(p.id)}
              >
                {p.emoji
                  ? <span className='sidebar-item-icon'>{p.emoji}</span>
                  : <PlatformIcon platform={p.id} size={18} className='sidebar-item-icon' />}
                <span>{p.name}</span>
                {count !== null && (
                  <span className='sidebar-item-badge'>({count})</span>
                )}
              </div>
            )
          })}
        </nav>

        <div className='sidebar-footer'>
          {showRequestLog && (
            <div
              className='sidebar-item settings-item'
              onClick={() => onOpenRequestLog?.()}
            >
              <span className='sidebar-item-icon' style={{ width: '18px', height: '18px', display: 'flex' }}>
                <LogIcon size={18} />
              </span>
              <span>日志</span>
            </div>
          )}
          <div
            className='sidebar-item settings-item'
            onClick={() => onSelectPlatform('settings')}
          >
            <span className='sidebar-item-icon' style={{ width: '18px', height: '18px', display: 'flex' }}>
              <SettingsIcon size={18} />
            </span>
            <span>设置</span>
          </div>
        </div>
      </aside>

      <button
        type='button'
        className={`sidebar-collapse-handle ${collapsed ? 'is-collapsed' : ''}`}
        onClick={() => setCollapsed(prev => !prev)}
        aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
      >
        <SidebarCollapseIcon size={16} className='sidebar-collapse-handle-icon' />
      </button>
    </div>
  )
}
