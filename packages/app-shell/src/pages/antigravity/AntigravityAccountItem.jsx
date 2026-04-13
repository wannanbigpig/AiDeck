import { useState } from 'react'
import QuotaBar from '../../components/QuotaBar'
import { formatDate, formatResetTime, maskText, truncateEmail } from '../../utils/format'
import { copyText } from '../../utils/hostBridge.js'
import { usePrivacy } from '../../components/PrivacyMode'
import AutoTip from '../../components/AutoTip'
import SpinnerBtnIcon from '../../components/SpinnerIcon'
import {
  DeviceIdentityIcon,
  TagIcon,
  PlayIcon,
  RefreshIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon
} from '../../components/Icons/ActionIcons'
import {
  getAntigravityQuotaDisplayItems,
  getAntigravityTierBadge,
  getAvailableAICreditsDisplay
} from '../../utils/antigravity'
import { resolveQuotaErrorMeta } from '../../utils/codex'
import { getStableCapsuleStyle } from '../../utils/capsuleColor'
import { getAntigravityDeviceIdentityDisplay } from './antigravityPageUtils.js'
import { buildSharedAccountBackFields } from '../../runtime/buildSharedAccountBackFields.js'
import { useFlippableAccountCard } from '../../runtime/useFlippableAccountCard.js'

export default function AntigravityAccountItem ({
  account,
  quotaAggregatedDisplay,
  isCurrent,
  isSelected,
  refreshingIds,
  globalLoading,
  onToggleSelect,
  onActivate,
  onRefresh,
  onDelete,
  onShowDetails,
  onEditTags
}) {
  const { isPrivacyMode } = usePrivacy()
  const [switching, setSwitching] = useState(false)
  const { flipped, openCard, closeCard, stopFlip } = useFlippableAccountCard()
  const [idCopied, setIdCopied] = useState(false)

  const tierBadge = getAntigravityTierBadge(account.quota)
  const quotaItems = (() => {
    const grouped = getAntigravityQuotaDisplayItems(account.quota, { aggregated: quotaAggregatedDisplay })
    if (grouped.length > 0) return grouped

    const q = account.quota || {}
    const legacy = []
    if (typeof q.hourly_percentage === 'number') {
      legacy.push({
        key: 'hourly',
        label: '5小时',
        percentage: q.hourly_percentage,
        resetTime: q.hourly_reset_time,
        requestsLeft: q.hourly_requests_left,
        requestsLimit: q.hourly_requests_limit
      })
    }
    if (typeof q.weekly_percentage === 'number') {
      legacy.push({
        key: 'weekly',
        label: '每周',
        percentage: q.weekly_percentage,
        resetTime: q.weekly_reset_time,
        requestsLeft: q.weekly_requests_left,
        requestsLimit: q.weekly_requests_limit
      })
    }
    if (typeof q.code_review_percentage === 'number') {
      legacy.push({
        key: 'cr',
        label: '代码审查',
        percentage: q.code_review_percentage,
        resetTime: q.code_review_reset_time,
        requestsLeft: q.code_review_requests_left,
        requestsLimit: q.code_review_requests_limit
      })
    }
    return legacy
  })()
  const creditsDisplay = getAvailableAICreditsDisplay(account.quota)
  const quotaErrorMeta = resolveQuotaErrorMeta(account.quota_error, account.quota?.error || '')
  const hasQuotaError = Boolean(quotaErrorMeta.rawMessage)
  const isDeactivated = quotaErrorMeta.disabled
  const showQuotaErrorOnFront = hasQuotaError && !isDeactivated
  const isInvalid = Boolean(isDeactivated || account.invalid || account.quota?.invalid)
  const statusLabels = isDeactivated ? '已停用' : '已失效'
  const statusText = isInvalid ? '无效' : (hasQuotaError ? '配额异常' : (isCurrent ? '当前激活' : '有效'))
  const statusColor = (isInvalid || hasQuotaError) ? '#ef4444' : (isCurrent ? 'var(--accent-green)' : 'var(--text-secondary)')
  const tagList = Array.isArray(account.tags) ? account.tags.map(item => String(item || '').trim()).filter(Boolean) : []
  const tagTip = tagList.length > 0 ? tagList.join(', ') : '暂无标签'
  const tagPills = tagList.slice(0, 3)
  const hasMoreTags = tagList.length > tagPills.length
  const isRefreshBusy = globalLoading || refreshingIds.has(account.id)
  const deviceIdentityDisplay = getAntigravityDeviceIdentityDisplay(account, isPrivacyMode)
  const sharedBackFields = buildSharedAccountBackFields({
    addedAt: account.created_at ? formatDate(account.created_at) : '-',
    statusText,
    statusColor
  })

  const handleRefreshWrapWithEvent = async (e) => {
    stopFlip(e)
    await Promise.resolve(onRefresh())
  }

  const handleSwitchWrapWithEvent = async (e) => {
    stopFlip(e)
    if (switching || isCurrent) return
    setSwitching(true)
    try {
      await Promise.resolve(onActivate())
    } finally {
      setSwitching(false)
    }
  }

  const handleDeleteWrap = (e) => {
    stopFlip(e)
    onDelete()
  }

  const handleCopyId = async (e) => {
    stopFlip(e)
    const text = account.user_id || account.id
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
              <input type='checkbox' checked={isSelected} onChange={onToggleSelect} />
              <span className='ag-checkbox-ui' />
            </label>

            <span className='account-email'>{isPrivacyMode ? maskText(account.email, 'email') : truncateEmail(account.email, 28)}</span>

            {isCurrent && <span className='badge badge-active'>当前</span>}
            {showQuotaErrorOnFront && <span className='codex-status-pill quota-error'>配额异常</span>}
            {isInvalid && <span className='badge badge-danger'>{statusLabels}</span>}
            {tierBadge.label && <span className={`badge ag-tier-badge ${tierBadge.className}`}>{tierBadge.label}</span>}
          </div>

          <div className='account-card-quota'>
            {quotaItems.length > 0
              ? quotaItems.map((item) => (
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

            {creditsDisplay && (
              <div className='ag-credits-line' style={{ fontSize: 12, color: 'var(--text-secondary)' }}>可用 AI 积分: {creditsDisplay}</div>
            )}
          </div>

          <div className='account-card-divider' />
          <div className='account-actions' style={{ justifyContent: 'flex-end', gap: 2, color: 'var(--text-secondary)' }}>
            <button className='action-icon-btn' onClick={(e) => { stopFlip(e); onShowDetails?.() }}>
              <span className='action-icon-tip'>查看绑定设备身份</span>
              <DeviceIdentityIcon size={16} />
            </button>

            <button className={`action-icon-btn ${isRefreshBusy ? 'is-loading' : ''}`} disabled={isRefreshBusy} onClick={handleRefreshWrapWithEvent}>
              <span className='action-icon-tip'>刷新配额</span>
              {isRefreshBusy ? <SpinnerBtnIcon /> : <RefreshIcon size={16} />}
            </button>

            {!isCurrent && (
              <button className={`action-icon-btn primary ${switching ? 'is-loading' : ''}`} onClick={handleSwitchWrapWithEvent}>
                <span className='action-icon-tip'>设为当前</span>
                {switching ? <SpinnerBtnIcon /> : <PlayIcon size={16} />}
              </button>
            )}

            <button className='action-icon-btn' onClick={(e) => { stopFlip(e); onEditTags?.() }}>
              <span className='action-icon-tip'>编辑标签</span>
              <TagIcon size={16} />
            </button>

            <button className='action-icon-btn danger' onClick={handleDeleteWrap}>
              <span className='action-icon-tip'>删除此账号</span>
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
                    {field.text}
                  </AutoTip>
                </div>
              ))}
              <div className='account-detail-row'>
                <span className='account-detail-label'>用户 ID:</span>
                <div className='account-detail-value-with-copy'>
                  <AutoTip text={account.user_id || account.id || '-'}>
                    {isPrivacyMode ? maskText(account.user_id || account.id || '-', 'id') : (account.user_id || account.id || '-')}
                  </AutoTip>
                  <button className='btn-icon-sm' title='复制 ID' onClick={handleCopyId}>
                    {idCopied ? <CheckIcon size={12} stroke='#10b981' /> : <CopyIcon size={12} />}
                  </button>
                </div>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>设备身份:</span>
                <AutoTip text={deviceIdentityDisplay.text}>
                  {deviceIdentityDisplay.displayText}
                </AutoTip>
              </div>
            </div>

            <div className='account-back-tags'>
              <div className='account-tags-line' data-tip={tagTip}>
                {tagPills.length > 0
                  ? tagPills.map((tag, idx) => (
                    <span
                      className='account-tag-pill'
                      key={`ag-tag-${account.id}-${idx}`}
                      style={getStableCapsuleStyle(`antigravity:${account.id}:${tag}:${idx}`)}
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
