import { useState } from 'react'
import { useTheme } from './ThemeToggle'
import { PlatformIcon } from './PlatformIcons'

/**
 * 侧边栏 — 简洁平台列表 + 主题切换
 */
export default function Sidebar ({ activePlatform, onSelectPlatform, platformData }) {
  const [collapsed, setCollapsed] = useState(false)

  const platforms = [
    { id: 'dashboard', name: '仪表盘' },
    { id: 'antigravity', name: 'Antigravity' },
    { id: 'codex', name: 'Codex' },
    { id: 'gemini', name: 'Gemini CLI' }
  ]

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className='sidebar-header' onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }} title={collapsed ? "展开" : "收起"}>
        <div className='sidebar-brand'>
          <img src='./logo.png' alt='AiDeck' style={{ width: '28px', height: '28px', flexShrink: 0, borderRadius: '6px' }} />
          <span className='sidebar-brand-text'>AiDeck</span>
        </div>
      </div>
      <nav className='sidebar-nav'>
        {platforms.map(p => {
          const data = platformData[p.id]
          const count = data ? data.accounts.length : null

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
        <div 
          className='sidebar-item settings-item' 
          onClick={() => onSelectPlatform('settings')}
        >
          <span className='sidebar-item-icon' style={{ width: '14px', height: '14px', display: 'flex' }}>
            <svg viewBox="0 0 1031 1024" width="14" height="14" fill="currentColor">
              <path d="M512 723.2c-115.2 0-211.2-96-211.2-211.2S396.8 300.8 512 300.8s211.2 96 211.2 211.2S627.2 723.2 512 723.2zM512 364.8c-83.2 0-147.2 64-147.2 147.2s64 147.2 147.2 147.2 147.2-64 147.2-147.2S595.2 364.8 512 364.8z"></path>
              <path d="M569.6 1024 454.4 1024c-25.6 0-51.2-19.2-51.2-51.2l-6.4-89.6c-25.6-6.4-51.2-19.2-70.4-32l-64 57.6c-19.2 19.2-51.2 19.2-70.4 0L108.8 832c-19.2-19.2-19.2-51.2 0-70.4l57.6-64c-12.8-25.6-19.2-44.8-32-70.4L51.2 620.8c0 0 0 0 0 0C19.2 620.8 0 601.6 0 569.6L0 454.4c0-25.6 19.2-51.2 51.2-51.2l89.6-6.4c6.4-25.6 19.2-51.2 32-70.4l-57.6-64C96 256 96 243.2 96 230.4c0-12.8 6.4-25.6 12.8-38.4L192 108.8c19.2-19.2 51.2-19.2 70.4 0l64 57.6c25.6-12.8 44.8-19.2 70.4-32l6.4-89.6C403.2 19.2 422.4 0 454.4 0l121.6 0c25.6 0 51.2 19.2 51.2 51.2l6.4 89.6c25.6 6.4 51.2 19.2 70.4 32l64-57.6c19.2-19.2 51.2-19.2 70.4 0L915.2 192c19.2 19.2 19.2 51.2 0 70.4l-57.6 64c12.8 25.6 19.2 44.8 32 70.4l89.6 6.4c25.6 0 51.2 25.6 51.2 51.2l0 121.6c0 25.6-19.2 51.2-51.2 51.2l-89.6 6.4c-6.4 25.6-19.2 51.2-32 70.4l57.6 64c6.4 6.4 12.8 19.2 12.8 32s-6.4 25.6-12.8 38.4L832 915.2c-19.2 19.2-51.2 19.2-70.4 0l-64-57.6c-25.6 12.8-44.8 19.2-70.4 32l-6.4 89.6C620.8 1004.8 601.6 1024 569.6 1024zM467.2 960l96 0 6.4-121.6L588.8 832c32-6.4 64-19.2 96-38.4l19.2-12.8 89.6 83.2 64-64L780.8 704l12.8-19.2c19.2-32 32-64 38.4-96l6.4-25.6L960 556.8 960 467.2l-121.6-6.4L832 435.2c-6.4-32-19.2-64-38.4-96L780.8 320l83.2-89.6-64-64L704 243.2l-19.2-12.8c-32-19.2-64-32-96-38.4L563.2 185.6 556.8 64 467.2 64 460.8 185.6 435.2 192c-32 6.4-64 19.2-96 38.4L320 243.2 230.4 160l-64 64L243.2 320 230.4 339.2C217.6 371.2 198.4 403.2 192 435.2L185.6 460.8 64 467.2l0 96 121.6 6.4L192 588.8c6.4 32 19.2 64 38.4 96L243.2 704l-83.2 89.6 64 64L320 780.8l19.2 12.8c32 19.2 64 32 96 38.4l25.6 6.4L467.2 960z"></path>
            </svg>
          </span>
          <span>设置</span>
        </div>
      </div>
    </aside>
  )
}
