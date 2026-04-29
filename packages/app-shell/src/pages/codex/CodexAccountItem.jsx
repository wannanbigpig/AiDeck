import { useState } from 'react'
import QuotaBar from '../../components/QuotaBar'
import { formatDate, formatResetTime, maskText, truncateEmail } from '../../utils/format'
import { copyText } from '../../utils/hostBridge.js'
import { getStableCapsuleStyle } from '../../utils/capsuleColor'
import { usePrivacy } from '../../components/PrivacyMode'
import AutoTip from '../../components/AutoTip'
import SpinnerBtnIcon from '../../components/SpinnerIcon'
import {
  ShieldIcon,
  SyncIcon,
  RefreshIcon,
  TagIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
  CommandLineIcon,
  BellIcon
} from '../../components/Icons/ActionIcons'
import {
  resolveQuotaErrorMeta,
  resolveCodexIdentityDisplay,
  resolveCodexAddMethodDisplay,
  resolveCodexProviderLoginDisplay,
  resolveCodexSubscriptionDisplay,
  resolveWorkspaceDisplay,
  shouldOfferReauthorizeAction
} from '../../utils/codex'
import { buildSharedAccountBackFields } from '../../runtime/buildSharedAccountBackFields.js'
import { useFlippableAccountCard } from '../../runtime/useFlippableAccountCard.js'

function buildCodexQuotaItems (quota, planName) {
  const items = []
  const isFree = String(planName || '').trim().toUpperCase() === 'FREE'
  if (!isFree && typeof quota?.hourly_percentage === 'number') {
    items.push({
      key: 'primary-hourly',
      label: '5小时',
      percentage: quota.hourly_percentage,
      resetTime: quota.hourly_reset_time,
      requestsLeft: quota.hourly_requests_left,
      requestsLimit: quota.hourly_requests_limit
    })
  }
  if (typeof quota?.weekly_percentage === 'number') {
    items.push({
      key: 'primary-weekly',
      label: '每周',
      percentage: quota.weekly_percentage,
      resetTime: quota.weekly_reset_time,
      requestsLeft: quota.weekly_requests_left,
      requestsLimit: quota.weekly_requests_limit
    })
  }

  const additional = Array.isArray(quota?.additional_rate_limits) ? quota.additional_rate_limits : []
  additional.forEach((limit, index) => {
    const name = String(limit?.limit_name || limit?.name || '额外模型').trim() || '额外模型'
    if (typeof limit?.hourly_percentage === 'number') {
      items.push({
        key: `additional-${index}-hourly`,
        label: `${name} 5小时`,
        percentage: limit.hourly_percentage,
        resetTime: limit.hourly_reset_time,
        requestsLeft: limit.hourly_requests_left,
        requestsLimit: limit.hourly_requests_limit
      })
    }
    if (typeof limit?.weekly_percentage === 'number') {
      items.push({
        key: `additional-${index}-weekly`,
        label: `${name} 每周`,
        percentage: limit.weekly_percentage,
        resetTime: limit.weekly_reset_time,
        requestsLeft: limit.weekly_requests_left,
        requestsLimit: limit.weekly_requests_limit
      })
    }
  })

  return items
}

function formatCodexCredits (quota) {
  const credits = quota?.credits && typeof quota.credits === 'object' ? quota.credits : null
  if (!credits) return ''
  if (credits.unlimited === true) return '无限'
  const balance = String(credits.balance ?? '').trim()
  if (balance) return balance
  return credits.has_credits === true ? '可用' : '0'
}

export default function CodexAccountItem ({
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
  onReauthorize,
  onLaunchCli,
  launchCliTip,
  onWakeup,
  svc
}) {
  const { isPrivacyMode } = usePrivacy()
  const quota = account.quota
  const planName = svc?.getPlanDisplayName(account.plan_type) || ''
  const { flipped, openCard, closeCard, stopFlip } = useFlippableAccountCard()
  const [syncing, setSyncing] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [launchingCli, setLaunchingCli] = useState(false)
  const [openingWakeup, setOpeningWakeup] = useState(false)
  const [idCopied, setIdCopied] = useState(false)

  const handleRefreshWrap = async (e) => {
    stopFlip(e)
    await onRefresh()
  }

  const handleSyncWrap = async (e) => {
    stopFlip(e)
    if (syncing) return
    setSyncing(true)
    try { await new Promise(resolve => setTimeout(resolve, 600)) } catch {}
    setSyncing(false)
  }

  const handleSwitchWrap = async (e) => {
    stopFlip(e)
    if (switching) return
    setSwitching(true)
    try { await onActivate() } catch {}
    setSwitching(false)
  }

  const handleLaunchCliWrap = async (e) => {
    stopFlip(e)
    if (launchingCli) return
    setLaunchingCli(true)
    try { await onLaunchCli?.() } catch {}
    setLaunchingCli(false)
  }

  const handleWakeupWrap = async (e) => {
    stopFlip(e)
    if (openingWakeup) return
    setOpeningWakeup(true)
    try { await onWakeup?.() } catch {}
    setOpeningWakeup(false)
  }

  const handleReauthorizeWrap = (e) => {
    stopFlip(e)
    onReauthorize?.()
  }

  const handleEditTagsWrap = (e) => {
    stopFlip(e)
    onEditTags?.()
  }

  const handleDeleteWrap = (e) => {
    stopFlip(e)
    onDelete?.()
  }

  const handleCopyId = async (e) => {
    stopFlip(e)
    const text = resolveCodexIdentityDisplay(account).userId
    if (!text) return
    const ok = await copyText(text)
    if (ok) {
      setIdCopied(true)
      setTimeout(() => setIdCopied(false), 2000)
    }
  }

  const planBadgeClass = (() => {
    const upper = (planName || '').toUpperCase()
    if (upper === 'PLUS') return 'badge-plus'
    if (upper === 'PRO') return 'badge-pro'
    if (upper === 'TEAM') return 'badge-team'
    return 'badge-free'
  })()

  const quotaErrorMeta = resolveQuotaErrorMeta(account.quota_error, quota?.error || '')
  const hasQuotaError = Boolean(quotaErrorMeta.rawMessage)
  const showReauthorizeAction = hasQuotaError && shouldOfferReauthorizeAction(quotaErrorMeta)
  const isDeactivated = quotaErrorMeta.errorCode.toLowerCase() === 'deactivated_workspace' ||
    quotaErrorMeta.statusCode === '402' ||
    quotaErrorMeta.rawMessage.toLowerCase().includes('deactivated_workspace')
  const showQuotaErrorOnFront = hasQuotaError && !isDeactivated
  const isInvalid = isDeactivated || account.invalid || account.quota?.invalid || false
  const statusLabels = isDeactivated ? '已停用' : '已失效'
  const statusText = isCurrent
    ? '当前激活'
    : ((isInvalid || showReauthorizeAction) ? '无效' : (hasQuotaError ? '配额异常' : '有效'))
  const statusColor = isCurrent ? 'var(--accent-green)' : ((isInvalid || hasQuotaError) ? '#ef4444' : 'var(--text-secondary)')
  const quotaItems = buildCodexQuotaItems(quota, planName)
  const creditsText = formatCodexCredits(quota)
  const workspaceDisplay = resolveWorkspaceDisplay(account)
  const addMethodDisplay = resolveCodexAddMethodDisplay(account)
  const providerLoginDisplay = resolveCodexProviderLoginDisplay(account)
  const loginMethodDisplay = `${addMethodDisplay} | ${providerLoginDisplay}`
  const identityDisplay = resolveCodexIdentityDisplay(account)
  const subscriptionDisplay = resolveCodexSubscriptionDisplay(account)
  const sharedBackFields = buildSharedAccountBackFields({
    addMethod: loginMethodDisplay,
    addedAt: account.added_at ? formatDate(account.added_at) : (account.created_at ? formatDate(account.created_at) : '-'),
    statusText,
    statusColor
  })
  const tagList = Array.isArray(account.tags)
    ? account.tags.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const tagTip = tagList.length > 0 ? tagList.join(', ') : '暂无标签'
  const tagPills = tagList.slice(0, 3)
  const hasMoreTags = tagList.length > tagPills.length
  const isRefreshBusy = globalLoading || refreshingIds.has(account.id)

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
            {planName && <span className={`badge ${planBadgeClass}`}>{planName}</span>}
            {showQuotaErrorOnFront && (
              <span className='codex-status-pill quota-error' title={quotaErrorMeta.rawMessage}>
                {showReauthorizeAction ? '需重新授权' : (quotaErrorMeta.statusCode || '配额异常')}
              </span>
            )}
            {isInvalid && <span className='badge badge-danger'>{statusLabels}</span>}
            {isCurrent && <span className='badge badge-active'>当前</span>}
          </div>

          <div className='account-card-quota'>
            {(() => {
              if (quotaItems.length === 0) {
                return <div className='quota-empty-placeholder'>暂无配额数据</div>
              }

              return (
                <>
                  {quotaItems.map(item => (
                    <QuotaBar
                      key={item.key}
                      percentage={item.percentage}
                      label={item.label}
                      resetTime={item.resetTime ? formatResetTime(item.resetTime) : ''}
                      requestsLeft={item.requestsLeft}
                      requestsLimit={item.requestsLimit}
                    />
                  ))}
                </>
              )
            })()}
          </div>

          <div className='codex-card-bottom'>
            {creditsText && (
              <div className='codex-credits-line'>剩余额度: {creditsText}</div>
            )}
            <div className='account-card-divider' />
            <div className='account-actions' style={{ justifyContent: 'flex-end', gap: 2, color: 'var(--text-secondary)' }}>
            <button className={`action-icon-btn ${launchingCli ? 'is-loading' : ''}`} onClick={handleLaunchCliWrap}>
              <span className='action-icon-tip'>{launchCliTip || '以账号绑定实例启动 Codex CLI'}</span>
              {launchingCli ? <SpinnerBtnIcon /> : <CommandLineIcon size={16} />}
            </button>

            <button className={`action-icon-btn ${openingWakeup ? 'is-loading' : ''}`} onClick={handleWakeupWrap}>
              <span className='action-icon-tip'>配置或立即唤醒此账号</span>
              {openingWakeup ? <SpinnerBtnIcon /> : <BellIcon size={16} />}
            </button>

            {showReauthorizeAction && (
              <button className='action-icon-btn' onClick={handleReauthorizeWrap}>
                <span className='action-icon-tip'>重新授权</span>
                <ShieldIcon size={16} />
              </button>
            )}
            <button className={`action-icon-btn ${syncing ? 'is-loading' : ''}`} onClick={handleSyncWrap}>
              <span className='action-icon-tip'>同步账号信息</span>
              {syncing ? <SpinnerBtnIcon /> : <SyncIcon size={16} />}
            </button>

            {!isCurrent && (
              <button className={`action-icon-btn primary ${switching ? 'is-loading' : ''}`} onClick={handleSwitchWrap}>
                <span className='action-icon-tip'>设为当前</span>
                {switching
                  ? <SpinnerBtnIcon />
                  : (
                    <svg viewBox='0 0 1024 1024' width='16' height='16' aria-hidden='true' fill='currentColor'>
                      <path d='M918.072889 966.769778c-26.908444 0-48.753778-30.378667-48.753778-67.697778V96.426667c0-37.319111 21.845333-67.697778 48.753778-67.697778s48.810667 30.378667 48.810667 67.697778v802.645333c0 37.319111-21.902222 67.697778-48.810667 67.697778z m-195.697778-411.477334l-563.768889 400.327112a63.886222 63.886222 0 0 1-34.702222 9.898666c-11.605333 0-22.755556-2.958222-32.426667-8.533333-22.129778-13.539556-35.100444-35.896889-34.531555-59.790222V97.28c0-24.917333 13.198222-47.900444 34.474666-60.074667 9.671111-5.518222 20.935111-8.476444 32.426667-8.476444 12.8 0 24.974222 3.527111 35.271111 10.24l562.915556 399.644444c19.626667 12.686222 31.744 35.100444 31.744 58.595556 0 23.495111-12.060444 45.738667-31.402667 58.083555zM549.944889 448.682667L241.834667 215.836444a55.978667 55.978667 0 0 0-58.766223-1.991111 58.311111 58.311111 0 0 0-29.240888 50.574223v466.602666c-0.398222 20.252444 10.410667 39.139556 28.956444 50.517334a56.718222 56.718222 0 0 0 58.311111-1.308445l309.418667-233.927111c15.872-10.069333 25.884444-28.728889 25.884444-48.526222 0-19.740444-10.126222-38.570667-26.453333-49.095111z' />
                    </svg>
                    )}
              </button>
            )}

            <button className={`action-icon-btn ${isRefreshBusy ? 'is-loading' : ''}`} disabled={isRefreshBusy} onClick={handleRefreshWrap}>
              <span className='action-icon-tip'>提取最新配额详情</span>
              {isRefreshBusy ? <SpinnerBtnIcon /> : <RefreshIcon size={16} />}
            </button>

            <button className='action-icon-btn' onClick={handleEditTagsWrap}>
              <span className='action-icon-tip'>编辑标签</span>
              <TagIcon size={16} />
            </button>

            <button className='action-icon-btn danger' onClick={handleDeleteWrap}>
              <span className='action-icon-tip'>删除弃用此账号</span>
              <TrashIcon size={16} />
            </button>
            </div>
          </div>
        </div>

        <div className='account-card-back account-card' onClick={closeCard}>
          <div className='account-back-body'>
            <div className='account-back-header'>
              <div className='account-back-header-icon' />
              <span className='account-back-header-email'>{isPrivacyMode ? maskText(account.email, 'email') : account.email}</span>
            </div>

            <div className='account-card-details'>
              <div className='account-detail-row'>
                <span className='account-detail-label'>工作空间:</span>
                <AutoTip text={workspaceDisplay.text}>
                  {isPrivacyMode ? maskText(workspaceDisplay.text, 'text') : workspaceDisplay.text}
                </AutoTip>
              </div>
              <div className='account-detail-row'>
                <span className='account-detail-label'>订阅到期:</span>
                <AutoTip text={subscriptionDisplay.title} style={subscriptionDisplay.color ? { color: subscriptionDisplay.color } : undefined}>
                  {subscriptionDisplay.text}
                </AutoTip>
              </div>
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
                  <AutoTip text={identityDisplay.userId}>
                    {isPrivacyMode ? maskText(identityDisplay.userId, 'id') : identityDisplay.userId}
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
                      key={`codex-tag-${account.id}-${idx}`}
                      style={getStableCapsuleStyle(`codex:${account.id}:${tag}:${idx}`)}
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
