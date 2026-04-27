import { useEffect, useMemo, useState } from 'react'
import { APP_VERSION } from '../runtime/useAnnouncements.js'
import { getPlatformService } from '../utils/hostBridge.js'

function parseTime (value) {
  const time = new Date(String(value || '')).getTime()
  return Number.isFinite(time) ? time : 0
}

function formatTimeAgo (value) {
  const time = parseTime(value)
  if (!time) return ''
  const diff = Math.max(0, Date.now() - time)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

function typeLabel (type) {
  const value = String(type || '').toLowerCase()
  if (value === 'feature') return '新功能'
  if (value === 'warning') return '警告'
  if (value === 'urgent') return '紧急'
  return '信息'
}

function typeClass (type) {
  const value = String(type || '').toLowerCase()
  return ['feature', 'warning', 'urgent', 'info'].includes(value) ? value : 'info'
}

function isSafeUrl (url) {
  const value = String(url || '').trim()
  return /^https?:\/\//i.test(value)
}

function normalizeVersion (value) {
  return String(value || '').trim().replace(/^v/i, '')
}

function formatVersion (value) {
  const normalized = normalizeVersion(value)
  return normalized ? `v${normalized}` : ''
}

function isVersionMismatch (announcement) {
  const announcementVersion = normalizeVersion(announcement?.version)
  const currentVersion = normalizeVersion(APP_VERSION)
  return Boolean(announcementVersion && currentVersion && announcementVersion !== currentVersion)
}

function getReleaseHint (announcement) {
  if (!isVersionMismatch(announcement)) return null
  const status = String(announcement?.releaseStatus || '').trim().toLowerCase()
  const version = formatVersion(announcement?.version)
  const currentVersion = formatVersion(APP_VERSION)
  if (status === 'reviewing' || status === 'review' || status === 'pending') {
    return {
      tone: 'pending',
      text: `${version} 已提交 uTools 应用市场审核，审核通过后请更新并重启插件。当前版本 ${currentVersion}`
    }
  }
  if (status === 'available' || status === 'released' || status === 'published') {
    return {
      tone: 'available',
      text: `发现新版本 ${version}，请在 uTools 应用市场更新后重启插件。当前版本 ${currentVersion}`
    }
  }
  return {
    tone: 'pending',
    text: `${version} 更新公告已发布，请等待 uTools 应用市场审核通过后再更新并重启插件。当前版本 ${currentVersion}`
  }
}

function renderAnnouncementContent (content) {
  const blocks = []
  let listItems = []

  function flushList () {
    if (listItems.length === 0) return
    const items = listItems
    listItems = []
    blocks.push(
      <ol className='announcement-detail-list' key={`list-${blocks.length}`}>
        {items.map(item => (
          <li key={`${item.number}-${item.text}`}>{item.text}</li>
        ))}
      </ol>
    )
  }

  String(content || '').split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) {
      flushList()
      return
    }

    const numbered = line.match(/^(\d+)[.、]\s+(.+)$/)
    if (numbered) {
      listItems.push({ number: numbered[1], text: numbered[2] })
      return
    }

    flushList()
    blocks.push(<p key={`p-${index}`}>{line}</p>)
  })

  flushList()
  return blocks
}

async function openExternalLink (url) {
  if (!isSafeUrl(url)) return
  try {
    const svc = getPlatformService('antigravity') || getPlatformService('codex') || getPlatformService('gemini')
    if (svc && typeof svc.openExternalUrl === 'function') {
      const opened = await Promise.resolve(svc.openExternalUrl(url))
      if (opened !== false) return
    }
  } catch (err) {}
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export default function AnnouncementCenter ({
  open,
  onClose,
  announcementState,
  loading,
  onRefresh,
  onMarkAsRead,
  onMarkAllAsRead,
  onNavigate
}) {
  const state = announcementState || { announcements: [], unreadIds: [], popupAnnouncement: null }
  const unreadIds = Array.isArray(state.unreadIds) ? state.unreadIds : []
  const [detail, setDetail] = useState(null)
  const [handledPopupId, setHandledPopupId] = useState('')

  const sortedAnnouncements = useMemo(() => {
    const items = Array.isArray(state.announcements) ? state.announcements : []
    return [...items].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return parseTime(b.createdAt) - parseTime(a.createdAt)
    })
  }, [state.announcements])

  useEffect(() => {
    const popup = state.popupAnnouncement
    if (!popup || handledPopupId === popup.id) return
    setHandledPopupId(popup.id)
    setDetail(popup)
  }, [handledPopupId, state.popupAnnouncement])

  async function closeDetail (reopenList = false) {
    const current = detail
    setDetail(null)
    if (current && unreadIds.includes(current.id)) {
      await onMarkAsRead?.(current.id)
    }
    if (reopenList) {
      return
    }
    if (!reopenList && !open) {
      onClose?.()
    }
  }

  async function handleItemClick (item) {
    setDetail(item)
  }

  async function runAction (action) {
    if (!action) return
    if (action.type === 'url') {
      await openExternalLink(action.target)
      await closeDetail(false)
      return
    }
    if (action.type === 'tab') {
      const target = String(action.target || '').trim()
      if (target) onNavigate?.(target)
      await closeDetail(false)
      return
    }
    if (action.type === 'command' && action.target === 'announcement.forceRefresh') {
      await onRefresh?.(true)
    }
  }

  const shouldRenderList = open
  const shouldRenderDetail = !!detail
  const releaseHint = getReleaseHint(detail)

  return (
    <>
      {shouldRenderList && (
        <div className='modal-overlay announcement-modal-overlay' onClick={onClose}>
          <div className='modal announcement-list-modal' onClick={(event) => event.stopPropagation()}>
            <div className='modal-header'>
              <h2>消息通知</h2>
              <button className='modal-close' onClick={onClose} aria-label='关闭'>×</button>
            </div>
            <div className='modal-body announcement-list-body'>
              <div className='announcement-toolbar'>
                <div className='announcement-toolbar-actions'>
                  <button className='announcement-toolbar-text-btn' disabled={unreadIds.length === 0} onClick={() => { void onMarkAllAsRead?.() }}>
                    全部已读
                  </button>
                  <button className='announcement-toolbar-text-btn' disabled={loading} onClick={() => { void onRefresh?.(true) }}>
                    {loading ? '刷新中' : '刷新'}
                  </button>
                </div>
              </div>

              {sortedAnnouncements.length === 0 && (
                <div className='announcement-empty'>暂无消息</div>
              )}

              {sortedAnnouncements.map(item => {
                const unread = unreadIds.includes(item.id)
                return (
                  <button
                    key={item.id}
                    className={`announcement-list-item ${unread ? 'is-unread' : ''}`}
                    onClick={() => { void handleItemClick(item) }}
                  >
                    <div className='announcement-list-item-top'>
                      <div className='announcement-title-meta'>
                        {item.pinned && <span className='announcement-pinned-chip'>置顶</span>}
                        <span className={`announcement-type-chip ${typeClass(item.type)}`}>{typeLabel(item.type)}</span>
                        <strong className='announcement-item-title'>{item.title}</strong>
                        {unread && <span className='announcement-unread-dot' />}
                      </div>
                      <span className='announcement-time'>{formatTimeAgo(item.createdAt)}</span>
                    </div>
                    <p className='announcement-summary'>{item.summary}</p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {shouldRenderDetail && (
        <div className='modal-overlay announcement-modal-overlay' onClick={() => { void closeDetail(false) }}>
          <div className='modal announcement-detail-modal' onClick={(event) => event.stopPropagation()}>
            <div className='modal-header announcement-detail-header'>
              <div className='announcement-detail-header-left'>
                <div className='announcement-detail-title-group'>
                  <div className='announcement-detail-meta-row'>
                    {detail.pinned && <span className='announcement-pinned-chip'>置顶</span>}
                    <span className={`announcement-type-chip ${typeClass(detail.type)}`}>{typeLabel(detail.type)}</span>
                    <span className='announcement-detail-time'>{formatTimeAgo(detail.createdAt)}</span>
                  </div>
                  <h2 className='announcement-detail-title'>{detail.title}</h2>
                  {releaseHint && (
                    <div className={`announcement-update-hint ${releaseHint.tone}`}>
                      {releaseHint.text}
                    </div>
                  )}
                </div>
              </div>
              <button className='modal-close' onClick={() => { void closeDetail(false) }} aria-label='关闭'>×</button>
            </div>
            <div className='modal-body announcement-detail-body'>
              <div className='announcement-detail-content'>
                {renderAnnouncementContent(detail.content)}
              </div>
              {Array.isArray(detail.images) && detail.images.length > 0 && (
                <div className='announcement-images-grid'>
                  {detail.images.map(image => (
                    <div key={image.url} className='announcement-image-card'>
                      <img src={image.url} alt={image.alt || image.label || ''} className='announcement-image' />
                      {image.label && <span>{image.label}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className='modal-footer'>
              {detail.action && (
                <button className='btn btn-primary' onClick={() => { void runAction(detail.action) }}>
                  {detail.action.label || '打开'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
