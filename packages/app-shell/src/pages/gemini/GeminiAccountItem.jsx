import { useState } from 'react'
import QuotaBar from '../../components/QuotaBar'
import { formatDate, formatResetTime, getQuotaLevel, maskText, truncateEmail } from '../../utils/format'
import { copyText } from '../../utils/hostBridge.js'
import { getGeminiQuotaDisplayGroups, getGeminiQuotaDisplayItems } from '../../utils/gemini'
import { getStableCapsuleStyle } from '../../utils/capsuleColor'
import { usePrivacy } from '../../components/PrivacyMode'
import AutoTip from '../../components/AutoTip'
import SpinnerBtnIcon from '../../components/SpinnerIcon'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  SwitchIcon,
  RefreshIcon,
  TagIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon
} from '../../components/Icons/ActionIcons'
import { resolveQuotaErrorMeta } from '../../utils/codex'
import { buildSharedAccountBackFields } from '../../runtime/buildSharedAccountBackFields.js'
import { useFlippableAccountCard } from '../../runtime/useFlippableAccountCard.js'

function formatGeminiAddedVia (value) {
  const normalized = String(value || '').trim().toLowerCase()
  switch (normalized) {
    case 'local': return '本地导入'
    case 'json': return 'JSON 导入'
    case 'token': return 'Token 导入'
    case 'oauth': return 'OAuth 授权'
    default: return ''
  }
}

function formatGeminiLoginType (value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'oauth-personal') return 'Signed in with Google'
  if (normalized === 'oauth-workspace') return 'Signed in with Google'
  if (normalized === 'oauth') return 'Signed in with Google'
  if (normalized === 'google') return 'Signed in with Google'

  const formatted = normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => {
      if (part === 'oauth') return 'OAuth'
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')

  return formatted === normalized ? '' : formatted
}

function buildGeminiLoginMethodDisplay (account) {
  const rawAuthMethod = String(account?.auth_method || '').trim()
    .replace(/\s*[\(（][^()（）]+[@][^()（）]+[\)）]\s*$/, '')
  if (rawAuthMethod) return rawAuthMethod

  const loginType = formatGeminiLoginType(account?.selected_auth_type || '')
  if (loginType) return loginType
  return ''
}

function buildGeminiTierDisplay (account) {
  return String(account?.plan_name || account?.tier_id || '').trim()
}

export default function GeminiAccountItem ({
  account,
  isCurrent,
  isSelected,
  refreshingIds,
  globalLoading,
  onToggleSelect,
  onActivate,
  onRefresh,
  onDelete,
  onEditTags,
  svc
}) {
  const { isPrivacyMode } = usePrivacy()
  const planBadge = svc?.getPlanBadge(account) || ''
  const { flipped, openCard, closeCard, stopFlip } = useFlippableAccountCard()
  const [injecting, setInjecting] = useState(false)
  const [expandedGroupKey, setExpandedGroupKey] = useState('')
  const [idCopied, setIdCopied] = useState(false)

  const planBadgeClass = (() => {
    switch (planBadge) {
      case 'PRO': return 'badge-pro'
      case 'ULTRA': return 'badge-ultra'
      case 'FREE': return 'badge-free'
      default: return 'badge-free'
    }
  })()

  const quota = account.quota
  const quotaErrorMeta = resolveQuotaErrorMeta(account.quota_error, quota?.error || '')
  const hasQuotaError = Boolean(quotaErrorMeta.rawMessage)
  const isDeactivated = quotaErrorMeta.disabled
  const showQuotaErrorOnFront = hasQuotaError && !isDeactivated
  const isInvalid = Boolean(isDeactivated || account.invalid || quota?.invalid)
  const statusLabels = isDeactivated ? '已停用' : '已失效'
  const statusText = isInvalid ? '无效' : (hasQuotaError ? '配额异常' : (isCurrent ? '当前激活' : '有效'))
  const statusColor = (isInvalid || hasQuotaError) ? '#ef4444' : (isCurrent ? 'var(--accent-green)' : 'var(--text-secondary)')
  const tagList = Array.isArray(account.tags)
    ? account.tags.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const tagTip = tagList.length > 0 ? tagList.join(', ') : '暂无标签'
  const tagPills = tagList.slice(0, 3)
  const hasMoreTags = tagList.length > tagPills.length
  const isRefreshBusy = globalLoading || refreshingIds.has(account.id)
  const quotaItems = getGeminiQuotaDisplayItems(quota)
  const quotaGroups = getGeminiQuotaDisplayGroups(quota)
  const showGroupedQuota = quotaGroups.length > 0
  const addedViaDisplay = formatGeminiAddedVia(account.added_via) || '-'
  const loginMethodDisplay = buildGeminiLoginMethodDisplay(account)
  const tierDisplay = buildGeminiTierDisplay(account)
  const addedAtDisplay = account.added_at ? formatDate(account.added_at) : (account.created_at ? formatDate(account.created_at) : '-')
  const sharedBackFields = buildSharedAccountBackFields({
    addMethod: addedViaDisplay,
    loginMethod: loginMethodDisplay,
    tier: tierDisplay,
    addedAt: addedAtDisplay,
    statusText,
    statusColor
  })

  const handleRefreshWrap = async (e) => {
    stopFlip(e)
    try { await onRefresh() } catch {}
  }

  const handleInjectWrap = async (e) => {
    stopFlip(e)
    if (injecting) return
    setInjecting(true)
    try { await onActivate() } catch {}
    setInjecting(false)
  }

  const handleDeleteWrap = (e) => {
    stopFlip(e)
    onDelete()
  }

  const handleToggleQuotaGroup = (groupKey, event) => {
    stopFlip(event)
    setExpandedGroupKey((prev) => (prev === groupKey ? '' : groupKey))
  }

  const handleCopyId = async (e) => {
    stopFlip(e)
    const text = account.id
    if (!text) return
    const ok = await copyText(text)
    if (ok) {
      setIdCopied(true)
      setTimeout(() => setIdCopied(false), 2000)
    }
  }

  return (
    <div className={`account-card-container ${isCurrent ? 'current' : ''} ${isInvalid ? 'status-invalid' : ''} ${hasQuotaError ? 'status-quota-error' : ''} ${isSelected ? 'ag-selected' : ''}`}>
      <div className={`account-card-inner ${flipped ? 'flipped' : ''}`}>
        <div className='account-card-front account-card' onClick={openCard} style={{ cursor: 'pointer' }}>
          <div className='account-card-row'>
            <label className='ag-checkbox-wrap' onClick={stopFlip}>
              <input type='checkbox' checked={!!isSelected} onChange={onToggleSelect} />
              <span className='ag-checkbox-ui' />
            </label>
            <span className='account-email'>{isPrivacyMode ? maskText(account.email, 'email') : truncateEmail(account.email, 28)}</span>
            {planBadge && <span className={`badge ${planBadgeClass}`}>{planBadge}</span>}
            {showQuotaErrorOnFront && <span className='codex-status-pill quota-error'>配额异常</span>}
            {isInvalid && <span className='badge badge-danger'>{statusLabels}</span>}
            {isCurrent && <span className='badge badge-active'>当前</span>}
          </div>

          <div className='account-card-quota' onClick={stopFlip}>
            {showGroupedQuota
              ? (
                <div className='gemini-quota-groups'>
                  {quotaGroups.map((group) => {
                    const expanded = expandedGroupKey === group.key
                    return (
                      <div className='gemini-quota-group' key={group.key}>
                        <button className='gemini-quota-group-trigger' type='button' onClick={(event) => handleToggleQuotaGroup(group.key, event)}>
                          <QuotaBar
                            percentage={group.percentage}
                            label={`${group.label} · ${group.items.length}`}
                            resetTime={group.resetTime ? formatResetTime(group.resetTime) : ''}
                          />
                          <span className='gemini-quota-group-chevron' aria-hidden='true'>
                            {expanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                          </span>
                        </button>
                        {expanded && (
                          <div className='gemini-quota-group-body'>
                            {group.items.map((item) => (
                              <div className='gemini-quota-group-item' key={item.key}>
                                <div className='gemini-quota-subitem'>
                                  <span className='gemini-quota-subitem-name'>{item.label}</span>
                                  <span className={`quota-percentage ${getQuotaLevel(item.percentage)}`}>{Math.round(item.percentage)}%</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                )
              : quotaItems.length > 0
                ? quotaItems.map(item => (
                  <QuotaBar
                    key={item.key}
                    percentage={item.percentage}
                    label={item.label}
                    resetTime={item.resetTime ? formatResetTime(item.resetTime) : ''}
                    requestsLeft={item.requestsLeft}
                    requestsLimit={item.requestsLimit}
                  />
                ))
              : <div className='quota-empty-placeholder'>暂无配额数据</div>}
          </div>

          <div className='account-card-divider' />
          <div className='account-actions' style={{ justifyContent: 'flex-end', gap: 2, color: 'var(--text-secondary)' }}>
            <button className={`action-icon-btn primary ${injecting ? 'is-loading' : ''}`} onClick={handleInjectWrap}>
              <span className='action-icon-tip'>{isCurrent ? '重新切换账号' : '切换账号'}</span>
              {injecting ? <SpinnerBtnIcon /> : <SwitchIcon size={16} />}
            </button>

            <button className={`action-icon-btn ${isRefreshBusy ? 'is-loading' : ''}`} disabled={isRefreshBusy} onClick={handleRefreshWrap}>
              <span className='action-icon-tip'>刷新配额</span>
              {isRefreshBusy ? <SpinnerBtnIcon /> : <RefreshIcon size={16} />}
            </button>

            <button className='action-icon-btn' onClick={(e) => { stopFlip(e); onEditTags?.() }}>
              <span className='action-icon-tip'>编辑标签</span>
              <TagIcon size={16} />
            </button>

            <button className='action-icon-btn danger' onClick={handleDeleteWrap}>
              <span className='action-icon-tip'>删除账号</span>
              <TrashIcon size={16} />
            </button>
          </div>
        </div>

        <div className='account-card-back account-card' onClick={closeCard}>
          <div className='account-back-body'>
            <div className='account-back-header'>
              <div className='account-back-header-icon' />
              <span className='account-back-header-email'>{isPrivacyMode ? maskText(account.email, 'email') : account.email}</span>
            </div>

            <div className='account-card-details'>
              {sharedBackFields.map((field) => (
                <div className='account-detail-row' key={field.key}>
                  <span className='account-detail-label'>{field.label}:</span>
                  <AutoTip text={field.text} style={field.color ? { color: field.color } : undefined}>
                    {isPrivacyMode && field.key === 'login-method' ? maskText(field.text, 'text') : field.text}
                  </AutoTip>
                </div>
              ))}
              <div className='account-detail-row'>
                <span className='account-detail-label'>用户 ID:</span>
                <div className='account-detail-value-with-copy'>
                  <AutoTip text={account.id || '-'}>
                    {isPrivacyMode ? maskText(account.id || '-', 'id') : (account.id || '-')}
                  </AutoTip>
                  <button className='btn-icon-sm' title='复制 ID' onClick={handleCopyId}>
                    {idCopied ? <CheckIcon size={12} stroke='#10b981' /> : <CopyIcon size={12} />}
                  </button>
                </div>
              </div>
            </div>

            <div className='account-back-tags'>
              <div className='account-tags-line' data-tip={tagTip}>
                {tagPills.length > 0
                  ? tagPills.map((tag, idx) => (
                    <span
                      className='account-tag-pill'
                      key={`gemini-tag-${account.id}-${idx}`}
                      style={getStableCapsuleStyle(`gemini:${account.id}:${tag}:${idx}`)}
                    >
                      {tag}
                    </span>
                  ))
                  : <span className='account-tag-pill account-tag-pill-empty'>暂无标签</span>}
                {hasMoreTags && <span className='account-tag-pill account-tag-pill-ellipsis'>...</span>}
              </div>
            </div>
            <div className='account-back-hint'>点击卡片任意区域返回配额监控</div>
          </div>
        </div>
      </div>
    </div>
  )
}
