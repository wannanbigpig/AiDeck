import { useEffect, useState } from 'react'
import { usePrivacy } from '../components/PrivacyMode'
import { 
  GroupCollapseIcon,
  Squares2x2Icon,
  UserGroupIcon,
  ServerIcon,
  ArrowRightIcon,
  DatabaseIcon,
  PlusIcon,
  CheckIcon
} from '../components/Icons/ActionIcons'
import { maskText } from '../utils/format'
import PrivacyToggleButton from '../components/PrivacyToggleButton'
import { getAntigravityTierBadge } from '../utils/antigravity'
import { resolveQuotaErrorMeta } from '../utils/codex'

function isCodexTeamLikePlan(planType) {
  if (!planType || typeof planType !== 'string') return false
  const upper = planType.toUpperCase()
  return upper.includes('TEAM') || upper.includes('BUSINESS') || upper.includes('ENTERPRISE') || upper.includes('EDU')
}

function getCodexPlanDisplayName(account) {
  const plan = String(account?.plan_type || '').trim()
  if (!plan) return 'FREE'
  const upper = plan.toUpperCase()
  if (upper.includes('TEAM')) return 'TEAM'
  if (upper.includes('PLUS')) return 'PLUS'
  if (upper.includes('PRO')) return 'PRO'
  return 'FREE'
}

function getCodexPlanBadgeClass(planName) {
  const upper = String(planName || '').toUpperCase()
  if (upper === 'PLUS') return 'badge-plus'
  if (upper === 'PRO') return 'badge-pro'
  if (upper === 'TEAM') return 'badge-team'
  return 'badge-free'
}

function getGeminiPlanDisplayName(account) {
  const raw = String(account?.plan_name || account?.tier_id || '').trim().toLowerCase()
  if (!raw) return ''
  if (raw.includes('ultra')) return 'ULTRA'
  if (raw.includes('pro') || raw.includes('premium') || raw.includes('business') || raw.includes('enterprise')) return 'PRO'
  if (raw.includes('free') || raw === 'standard-tier') return 'FREE'
  return 'UNKNOWN'
}

function getBadgeMetaByPlatform(platformId, account) {
  if (platformId === 'codex') {
    const label = getCodexPlanDisplayName(account)
    return { label, className: getCodexPlanBadgeClass(label) }
  }
  if (platformId === 'gemini') {
    const label = getGeminiPlanDisplayName(account)
    if (!label) return { label: '', className: '' }
    if (label === 'ULTRA') return { label, className: 'badge-ultra' }
    if (label === 'PRO') return { label, className: 'badge-pro' }
    return { label, className: 'badge-free' }
  }
  if (platformId === 'antigravity') {
    const tierBadge = getAntigravityTierBadge(account?.quota)
    const label = String(tierBadge?.label || '').trim()
    const tierClass = String(tierBadge?.className || '').trim().toLowerCase()
    if (!label) return { label: '', className: '' }
    if (tierClass === 'ultra') return { label, className: 'badge-ultra' }
    if (tierClass === 'pro') return { label, className: 'badge-pro' }
    return { label, className: 'badge-free' }
  }
  return { label: '', className: '' }
}

function _hashString(text) {
  const str = String(text || '')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function getRandomCapsuleStyle(seed) {
  const hash = _hashString(seed)
  const hue = hash % 360
  return {
    color: `hsl(${hue}, 62%, 34%)`,
    background: `hsla(${hue}, 72%, 52%, 0.18)`,
    border: `1px solid hsla(${hue}, 72%, 40%, 0.34)`
  }
}

function resolveCodexWorkspaceText(account) {
  const structure = String(account?.account_structure || '').trim().toLowerCase()
  const rawWorkspace = String(account?.workspace || '').trim()
  const accountName = String(account?.account_name || '').trim()
  const isTeam = !structure.includes('personal') && (structure ? !structure.includes('personal') : isCodexTeamLikePlan(account?.plan_type))
  if (!isTeam) return 'Personal'

  const teamName = accountName || (rawWorkspace && rawWorkspace !== '个人' ? rawWorkspace : '')
  return teamName ? `Team | ${teamName}` : 'Team'
}

function isDashboardAccountInvalid(platformId, account) {
  if (!account || typeof account !== 'object') return false
  const quota = (account.quota && typeof account.quota === 'object') ? account.quota : {}

  if (platformId === 'codex') {
    return !!(account.invalid || quota.invalid || quota.error || (account.quota_error && account.quota_error.message))
  }

  const quotaErrorMeta = resolveQuotaErrorMeta(account.quota_error, quota.error || '')
  return !!(account.invalid || quota.invalid || quotaErrorMeta.disabled)
}

export default function Dashboard({ onNavigate, onRefresh, searchQuery = '', platformData }) {
  const { isPrivacyMode } = usePrivacy()
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const data = platformData || {
    antigravity: { accounts: [], currentId: null },
    codex: { accounts: [], currentId: null },
    gemini: { accounts: [], currentId: null }
  }

  const rawPlatformsCount = Object.keys(data).filter(k => data[k].accounts?.length > 0).length || 3
  const rawAccountsTotal = Object.values(data).reduce((acc, p) => acc + (p.accounts?.length || 0), 0)

  const q = String(searchQuery || '').trim().toLowerCase()
  const groupedResults = Object.entries(data).map(([platformId, platform]) => {
    const accounts = Array.isArray(platform?.accounts) ? platform.accounts : []
    const matchedAccounts = accounts.filter(acc => {
      if (!q) return true
      const textToSearch = `${acc.email || ''} ${acc.username || ''} ${acc.name || ''} ${acc.id || ''} ${acc.teamName || ''} ${acc.org || ''} ${acc.workspace || ''} ${acc.account_name || ''} ${acc.plan_type || ''}`.toLowerCase()
      return textToSearch.includes(q)
    }).sort((a, b) => {
      const aCurrent = a.id === platform.currentId ? 1 : 0
      const bCurrent = b.id === platform.currentId ? 1 : 0
      if (bCurrent !== aCurrent) return bCurrent - aCurrent
      return 0
    })

    return {
      platformId,
      currentId: platform?.currentId || null,
      matchedAccounts
    }
  })

  const matchedGroups = groupedResults.filter(group => group.matchedAccounts.length > 0)
  const platformsCount = matchedGroups.length
  const accountsTotal = matchedGroups.reduce((sum, group) => sum + group.matchedAccounts.length, 0)
  const runningTotal = matchedGroups.filter(group => group.currentId && group.matchedAccounts.some(acc => acc.id === group.currentId)).length

  return (
    <div className='dash-glass-container'>
      <div className='dash-glass-header'>
        <div>
          <h1 className='dash-glass-title'>仪表盘</h1>
          <p className='dash-glass-subtitle'>AI IDE 多账号状态总览</p>
        </div>
        <div className='page-actions'>
          <PrivacyToggleButton />
        </div>
      </div>

      <div className='dash-glass-card' style={{ marginBottom: 16 }}>
        <div className='dash-overview-stats'>
          <div className='dash-stat-item'>
            <div className='dash-stat-icon'>
              <Squares2x2Icon size={24} />
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
              <UserGroupIcon size={24} />
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
              <ServerIcon size={24} />
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

        {rawAccountsTotal === 0 ? (
          <div className='dash-empty-state'>
            <h3 className='dash-empty-title'>No accounts configured yet.</h3>

            <div className='dash-empty-flow'>
              <ArrowRightIcon size={24} />
              <span className='dash-flow-arrow'>→</span>
              <UserGroupIcon size={24} />
              <span className='dash-flow-arrow'>→</span>
              <DatabaseIcon size={24} />
            </div>

            <button className='dash-glass-primary-btn'>
              <PlusIcon size={16} /> 添加首个账号 <CheckIcon size={16} />
            </button>
          </div>
        ) : (
          <div className='dash-accounts-list' style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {matchedGroups.length === 0 && q
              ? (
                <div className='dash-empty-state' style={{ marginTop: 4 }}>
                  <h3 className='dash-empty-title'>未匹配到账号</h3>
                </div>
              )
              : null}
            {groupedResults.map(({ platformId, currentId, matchedAccounts }) => {

              if (matchedAccounts.length === 0) return null;

              return (
                <div key={platformId} className='dash-account-group'>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 0, textTransform: 'capitalize' }}>
                      {platformId} ({matchedAccounts.length})
                    </h3>
                    <button
                      type='button'
                      className='action-icon-btn'
                      onClick={() => {
                        setCollapsedGroups(prev => ({
                          ...prev,
                          [platformId]: !prev[platformId]
                        }))
                      }}
                      data-tip={collapsedGroups[platformId] ? '展开' : '折叠'}
                      aria-label={collapsedGroups[platformId] ? `展开 ${platformId}` : `折叠 ${platformId}`}
                    >
                      <GroupCollapseIcon
                        size={14}
                        style={{ transform: collapsedGroups[platformId] ? 'rotate(-180deg)' : 'rotate(0deg)', transition: 'transform .18s ease' }}
                      />
                    </button>
                  </div>
                  {!collapsedGroups[platformId] && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                      {matchedAccounts.map(acc => {
                        const displayName = acc.email || acc.username || acc.name || acc.id
                        const isEmail = !!acc.email
                        const isCodex = platformId === 'codex'
                        const badgeMeta = getBadgeMetaByPlatform(platformId, acc)
                        const codexWorkspaceText = isCodex ? resolveCodexWorkspaceText(acc) : ''
                        const isCurrent = acc.id === currentId
                        const isInvalid = isDashboardAccountInvalid(platformId, acc)
                        const cardBorder = isInvalid
                          ? '1px solid var(--accent-red)'
                          : (isCurrent ? '1px solid var(--accent-green)' : '1px solid var(--border-default)')
                        const cardBackground = isInvalid
                          ? 'rgba(193, 44, 31, 0.06)'
                          : (isCurrent ? 'rgba(34, 197, 94, 0.08)' : 'var(--bg-base)')
                        const shownDisplayName = isPrivacyMode ? maskText(displayName, isEmail ? 'email' : 'text') : displayName
                        const shownWorkspace = isPrivacyMode ? maskText(codexWorkspaceText, 'text') : codexWorkspaceText

                        return (
                          <div
                            key={acc.id}
                            style={{
                              padding: '12px 14px',
                              background: cardBackground,
                              border: cardBorder,
                              borderRadius: '10px',
                              fontSize: '13px',
                              color: 'var(--text-secondary)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <div
                                className='account-detail-value'
                                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                                data-tip={shownDisplayName}
                              >
                                {shownDisplayName}
                              </div>
                              {badgeMeta.label && (
                                <span
                                  className='badge'
                                  style={getRandomCapsuleStyle(`${platformId}:${acc.id}:${badgeMeta.label}`)}
                                >
                                  {badgeMeta.label}
                                </span>
                              )}
                              {isCurrent && (
                                <span
                                  style={{
                                    fontSize: '10px',
                                    marginLeft: '4px',
                                    padding: '3px 6px',
                                    background: 'rgba(34, 197, 94, 0.12)',
                                    border: '1px solid var(--accent-green)',
                                    borderRadius: '4px',
                                    color: 'var(--accent-green)',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  当前活跃
                                </span>
                              )}
                            </div>
                            {isCodex && (
                              <div
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--text-muted)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                                data-tip={shownWorkspace}
                              >
                                {shownWorkspace}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  )
}
