import { useEffect, useState } from 'react'

export default function Dashboard ({ onNavigate, onRefresh, searchQuery = '', platformData }) {
  const data = platformData || {
    antigravity: { accounts: [], currentId: null },
    codex: { accounts: [], currentId: null },
    gemini: { accounts: [], currentId: null }
  }

  const platformsCount = Object.keys(data).filter(k => data[k].accounts?.length > 0).length || 3
  const accountsTotal = Object.values(data).reduce((acc, p) => acc + (p.accounts?.length || 0), 0)
  const runningTotal = Object.values(data).filter(p => p.currentId != null).length

  return (
    <div className='dash-glass-container'>
      <div className='dash-glass-header'>
        <div>
          <h1 className='dash-glass-title'>仪表盘</h1>
          <p className='dash-glass-subtitle'>AI IDE 多账号状态总览</p>
        </div>
        <div className='dash-glass-actions'>
        </div>
      </div>

      <div className='dash-glass-card' style={{ marginBottom: 16 }}>
        <div className='dash-overview-stats'>
          <div className='dash-stat-item'>
            <div className='dash-stat-icon'>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            </div>
            <div className='dash-stat-number'>{platformsCount}</div>
            <div className='dash-stat-text'>
              <div>Platforms</div>
              <div>活跃平台</div>
            </div>
          </div>
          <div className='dash-stat-sep' />
          <div className='dash-stat-item'>
            <div className='dash-stat-icon'>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </div>
            <div className='dash-stat-number'>{accountsTotal}</div>
            <div className='dash-stat-text'>
              <div>Accounts</div>
              <div>配置账户</div>
            </div>
          </div>
          <div className='dash-stat-sep' />
          <div className='dash-stat-item'>
            <div className='dash-stat-icon'>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
            </div>
            <div className='dash-stat-number'>{runningTotal}</div>
            <div className='dash-stat-text'>
              <div>Running</div>
              <div>运行实例</div>
            </div>
          </div>
        </div>
      </div>

      <div className='dash-glass-card dash-manage-card'>
        <div className='dash-glass-card-header'>
          <h2 className='dash-glass-card-title'>管理账户中心</h2>
        </div>

        {accountsTotal === 0 ? (
          <div className='dash-empty-state'>
            <h3 className='dash-empty-title'>No accounts configured yet.</h3>
            
            <div className='dash-empty-flow'>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              <span className='dash-flow-arrow'>→</span>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              <span className='dash-flow-arrow'>→</span>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
            </div>

            <button className='dash-glass-primary-btn'>
              + 添加首个账号 ✔
            </button>
          </div>
        ) : (
          <div className='dash-accounts-list' style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {Object.entries(data).map(([platformId, platformData]) => {
              const q = searchQuery.toLowerCase().trim()
              const matchedAccounts = platformData.accounts.filter(acc => {
                if (!q) return true
                const textToSearch = `${acc.email || ''} ${acc.username || ''} ${acc.name || ''} ${acc.id || ''} ${acc.teamName || ''} ${acc.org || ''}`.toLowerCase()
                return textToSearch.includes(q)
              })

              if (matchedAccounts.length === 0) return null;

              return (
                <div key={platformId} className='dash-account-group'>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'capitalize' }}>
                    {platformId} ({matchedAccounts.length})
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                    {matchedAccounts.map(acc => (
                      <div key={acc.id} style={{ padding: '12px 14px', background: 'var(--bg-base)', border: '1px solid var(--border-default)', borderRadius: '10px', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {acc.email || acc.username || acc.name || acc.id}
                        </div>
                        {acc.id === platformData.currentId && (
                          <span style={{ fontSize: '10px', marginLeft: '10px', padding: '3px 6px', background: 'var(--bg-elevated)', border: '1px solid var(--border-muted)', borderRadius: '4px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>当前活跃</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  )
}
