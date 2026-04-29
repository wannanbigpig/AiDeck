import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'markdown-to-jsx'
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CommandLineIcon,
  CopyIcon,
  FolderIcon,
  RefreshIcon,
  RestoreTrashIcon,
  TrashIcon,
  UnarchiveIcon,
  WrenchIcon
} from '../../components/Icons/ActionIcons'
import { usePrivacy } from '../../components/PrivacyMode'
import { getHostBridge, launchCliCommand, showItemInFolder } from '../../utils/hostBridge.js'
import { readGlobalSettings } from '../../utils/globalSettings.js'
import { readCodexAdvancedSettings } from '../../utils/codex.js'
import { maskText } from '../../utils/format.js'

function formatRelativeTime (value) {
  const time = Number(value || 0)
  if (!(time > 0)) return '-'
  const diff = Date.now() - time
  if (diff < 60 * 1000) return '刚刚'
  const minute = Math.floor(diff / (60 * 1000))
  if (minute < 60) return `${minute} 分钟前`
  const hour = Math.floor(minute / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(time).toLocaleDateString()
}

function formatSize (value) {
  const size = Number(value || 0)
  if (!(size > 0)) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function normalizeSearchText (value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeSessionResult (result) {
  if (!result || typeof result !== 'object') {
    return { success: false, error: '会话数据为空', groups: [], accounts: [], totals: {} }
  }
  return {
    success: result.success !== false,
    error: result.error || '',
    groups: Array.isArray(result.groups) ? result.groups : [],
    accounts: Array.isArray(result.accounts) ? result.accounts : [],
    totals: result.totals && typeof result.totals === 'object' ? result.totals : {}
  }
}

function getMessageKind (message) {
  const role = String(message?.role || '').toLowerCase()
  const content = String(message?.content || '').trim()
  if (role === 'developer' || role === 'system') return 'internal'
  if (role === 'user') return 'user'
  if (role === 'assistant' && !content.startsWith('[Tool:')) return 'assistant'
  if (role === 'tool' || content.startsWith('[Tool:')) return 'tool'
  return 'other'
}

function getMessageRoleLabel (kind, role) {
  if (kind === 'user') return '用户'
  if (kind === 'assistant') return 'AI'
  if (kind === 'tool') return '工具'
  if (kind === 'internal') return '内部指令'
  return role || '消息'
}

function compactMessageContent (content, limit = 8000) {
  const text = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n\n... 内容较长，已截断预览`
}

function MarkdownLink (props) {
  return <a {...props} target='_blank' rel='noreferrer' />
}

function isSafeMarkdownImageSrc (src) {
  const value = String(src || '').trim()
  return /^https?:\/\//i.test(value) || /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value)
}

function MarkdownImage (props) {
  const src = String(props.src || '').trim()
  if (!isSafeMarkdownImageSrc(src)) {
    return <span className='codex-session-md-image-alt'>{props.alt || src || '图片'}</span>
  }
  return (
    <button className='codex-session-md-image-link' type='button' onClick={() => props.onPreview?.(src)}>
      <img className='codex-session-md-image' src={src} alt={props.alt || '图片'} loading='lazy' />
    </button>
  )
}

function MessageImageAttachment ({ src, onPreview }) {
  const safeSrc = String(src || '').trim()
  if (!isSafeMarkdownImageSrc(safeSrc)) return null
  return (
    <button className='codex-session-md-image-link' type='button' onClick={() => onPreview?.(safeSrc)}>
      <img className='codex-session-md-image' src={safeSrc} alt='图片' loading='lazy' />
    </button>
  )
}

const MarkdownContent = memo(function MarkdownContent ({ content, onImagePreview }) {
  const options = useMemo(() => ({
    disableParsingRawHTML: true,
    overrides: {
      a: { component: MarkdownLink },
      img: { component: (props) => <MarkdownImage {...props} onPreview={onImagePreview} /> }
    }
  }), [onImagePreview])
  return (
    <div className='codex-session-message-body'>
      <Markdown options={options}>{content}</Markdown>
    </div>
  )
})

const MANUAL_REFRESH_MIN_MS = 1000

function waitAtLeast (startedAt, minMs) {
  const waitMs = Number(minMs || 0) - (Date.now() - Number(startedAt || 0))
  return waitMs > 0 ? new Promise(resolve => setTimeout(resolve, waitMs)) : Promise.resolve()
}

function summarizeToolMessage (content) {
  const text = String(content || '').trim()
  const toolMatch = text.match(/^\[Tool:\s*([^\]]+)\]/)
  if (toolMatch) return toolMatch[1]
  const firstLine = text.split(/\r?\n/).find(line => line.trim())
  if (!firstLine) return '工具输出'
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine
}

function getSessionStatusMeta (session) {
  const status = String(session?.status || '').trim()
  if (status === 'broken') {
    return {
      key: 'broken',
      label: session?.statusLabel || '异常',
      tip: session?.statusReason || '索引异常',
      className: 'is-broken'
    }
  }
  if (status === 'archived') {
    return {
      key: 'archived',
      label: session?.statusLabel || '已归档',
      tip: session?.statusReason || 'SQLite 标记 archived',
      className: 'is-archived'
    }
  }
  if (status === 'unindexed') {
    return {
      key: 'unindexed',
      label: session?.statusLabel || '未索引',
      tip: session?.statusReason || 'Codex App 可能不可见',
      className: 'is-unindexed'
    }
  }
  return {
    key: 'available',
    label: session?.statusLabel || '可用',
    tip: session?.statusReason || '可恢复会话',
    className: 'is-available'
  }
}

const MessageContent = memo(function MessageContent ({ content, images, onImagePreview }) {
  const text = compactMessageContent(content)
  const imageList = Array.isArray(images) ? images.filter(isSafeMarkdownImageSrc) : []
  if (!text && imageList.length === 0) return null
  return (
    <div className='codex-session-message-content'>
      {imageList.length > 0 && (
        <div className='codex-session-image-attachments'>
          {imageList.map((src, index) => (
            <MessageImageAttachment src={src} onPreview={onImagePreview} key={`${index}-${src.slice(0, 32)}`} />
          ))}
        </div>
      )}
      {text && <MarkdownContent content={text} onImagePreview={onImagePreview} />}
    </div>
  )
})

function getGroupSearchText (group) {
  return [
    group?.workspaceName,
    group?.workspacePath,
    group?.id
  ].join(' ')
}

function getSessionSearchText (session) {
  return [
    session?.title,
    session?.summary,
    session?.sessionId,
    session?.id,
    session?.sourceName,
    session?.accountEmail,
    session?.accountId,
    session?.originalWorkspaceName,
    session?.originalWorkspacePath,
    session?.workspaceName,
    session?.workspacePath,
    session?.path,
    session?.statusLabel,
    session?.statusReason
  ].join(' ')
}

function getSessionWorkspaceSourceText (session) {
  const name = String(session?.originalWorkspaceName || '').trim()
  const workspacePath = String(session?.originalWorkspacePath || '').trim()
  if (!name && !workspacePath) return ''
  if (name && workspacePath) return `${name} · ${workspacePath}`
  return name || workspacePath
}

function escapeRegExp (value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightText ({ text, query }) {
  const value = String(text || '')
  const normalizedQuery = normalizeSearchText(query)
  if (!value || !normalizedQuery) return value
  const pattern = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'ig')
  return value.split(pattern).map((part, index) => (
    normalizeSearchText(part) === normalizedQuery
      ? <mark className='codex-session-search-hit' key={`${index}-${part}`}>{part}</mark>
      : part
  ))
}

export default function CodexSessionManager ({ svc, accounts, searchQuery = '', toast, onBack }) {
  const { isPrivacyMode } = usePrivacy()
  const [loading, setLoading] = useState(false)
  const [messageLoading, setMessageLoading] = useState(false)
  const [trashLoading, setTrashLoading] = useState(false)
  const [cleaningIndexes, setCleaningIndexes] = useState(false)
  const [snapshot, setSnapshot] = useState(() => normalizeSessionResult(null))
  const [trashItems, setTrashItems] = useState([])
  const [expanded, setExpanded] = useState(() => new Set())
  const [accountFilter, setAccountFilter] = useState('')
  const [viewMode, setViewMode] = useState('sessions')
  const [selectedSession, setSelectedSession] = useState(null)
  const [checkedSessionIds, setCheckedSessionIds] = useState(() => new Set())
  const [checkedTrashIds, setCheckedTrashIds] = useState(() => new Set())
  const [showDebugMessages, setShowDebugMessages] = useState(false)
  const [showDetailTopButton, setShowDetailTopButton] = useState(false)
  const [messages, setMessages] = useState([])
  const [previewImage, setPreviewImage] = useState(null)
  const [copyTargetSession, setCopyTargetSession] = useState(null)
  const [copyTargetAccountId, setCopyTargetAccountId] = useState('')
  const [transferMode, setTransferMode] = useState('copy')
  const [copyingSession, setCopyingSession] = useState(false)
  const detailRef = useRef(null)
  const selectedSessionRowRef = useRef(null)
  const detailTopButtonVisibleRef = useRef(false)
  const detailTopRafRef = useRef(0)

  const setDetailTopButtonVisible = useCallback((value) => {
    const next = Boolean(value)
    detailTopButtonVisibleRef.current = next
    setShowDetailTopButton(prev => (prev === next ? prev : next))
  }, [])

  const accountOptions = useMemo(() => {
    const list = Array.isArray(accounts) ? accounts : []
    return list.map(account => ({
      id: String(account?.id || ''),
      label: account?.email || account?.account_name || account?.workspace || account?.id || '未命名账号'
    })).filter(item => item.id)
  }, [accounts])

  function displayText (value, fallback = '-', type = 'text') {
    const text = String(value || '').trim()
    if (!text) return fallback
    return text
  }

  function displayTitle (value) {
    return displayText(value, '未命名会话')
  }

  function displayWorkspaceName (value) {
    const text = String(value || '').trim()
    if (!text) return '未知工作区'
    return isPrivacyMode ? maskText(text, 'text') : text
  }

  function displayWorkspacePath (value, fallback = '-') {
    const text = String(value || '').trim()
    if (!text) return fallback
    return isPrivacyMode ? maskText(text, 'text') : text
  }

  function displaySource (source) {
    return source?.sourceName || source?.accountEmail || source?.accountId || '未知来源'
  }

  function displaySessionInstance (session) {
    if (session?.sourceType === 'wakeup') return '唤醒会话'
    const name = displaySource(session)
    if (name === '默认' && session?.sourceType === 'default') return '默认实例'
    return name
  }

  const sessionSearchQuery = normalizeSearchText(searchQuery)

  const visibleGroups = useMemo(() => {
    const groups = Array.isArray(snapshot.groups) ? snapshot.groups : []
    const filteredByAccount = accountFilter
      ? groups
        .map(group => {
          const sessions = Array.isArray(group.sessions)
            ? group.sessions.filter(session => session.accountId === accountFilter)
            : []
          return Object.assign({}, group, { sessions, count: sessions.length })
        })
        .filter(group => group.sessions.length > 0)
      : groups
    if (!sessionSearchQuery) return filteredByAccount
    return filteredByAccount
      .map(group => {
        const sessions = Array.isArray(group.sessions) ? group.sessions : []
        const groupMatches = normalizeSearchText(getGroupSearchText(group)).includes(sessionSearchQuery)
        const nextSessions = groupMatches
          ? sessions
          : sessions.filter(session => normalizeSearchText(getSessionSearchText(session)).includes(sessionSearchQuery))
        return Object.assign({}, group, { sessions: nextSessions, count: nextSessions.length, searchMatchedWorkspace: groupMatches })
      })
      .filter(group => group.searchMatchedWorkspace || group.sessions.length > 0)
  }, [snapshot.groups, accountFilter, sessionSearchQuery])

  const visibleSessions = useMemo(() => (
    visibleGroups.flatMap(group => Array.isArray(group.sessions) ? group.sessions : [])
  ), [visibleGroups])

  const checkedSessions = useMemo(() => (
    visibleSessions.filter(session => checkedSessionIds.has(session.id))
  ), [visibleSessions, checkedSessionIds])

  const checkedTrashItems = useMemo(() => (
    trashItems.filter(item => checkedTrashIds.has(item.trashId))
  ), [trashItems, checkedTrashIds])

  const copyTargetOptions = useMemo(() => {
    const sourceAccountId = String(copyTargetSession?.accountId || '').trim()
    return accountOptions.filter(option => option.id && option.id !== sourceAccountId)
  }, [accountOptions, copyTargetSession?.accountId])

  const brokenSessionCount = useMemo(() => (
    visibleSessions.filter(session => session.status === 'broken').length
  ), [visibleSessions])

  const archivedSessionCount = useMemo(() => (
    visibleSessions.filter(session => session.status === 'archived').length
  ), [visibleSessions])

  const unindexedSessionCount = useMemo(() => (
    visibleSessions.filter(session => session.status === 'unindexed').length
  ), [visibleSessions])

  const readableMessages = useMemo(() => {
    const list = Array.isArray(messages) ? messages : []
    return list.map((message, index) => ({
      id: `${message?.ts || 0}-${index}`,
      kind: getMessageKind(message),
      role: String(message?.role || ''),
      content: String(message?.content || ''),
      images: Array.isArray(message?.images) ? message.images : [],
      ts: message?.ts || 0
    }))
  }, [messages])

  const visibleMessages = useMemo(() => (
    showDebugMessages ? readableMessages : readableMessages.filter(message => message.kind !== 'tool' && message.kind !== 'internal')
  ), [readableMessages, showDebugMessages])

  const debugMessageCount = useMemo(() => (
    readableMessages.filter(message => message.kind === 'tool' || message.kind === 'internal').length
  ), [readableMessages])

  function getCodexAction (name) {
    const bridge = getHostBridge()
    const platformApi = bridge && bridge.platforms ? bridge.platforms : null
    const serviceReader = svc && typeof svc[name] === 'function'
      ? (payload) => svc[name](payload)
      : null
    const bridgeReader = platformApi && typeof platformApi[name] === 'function'
      ? (payload) => platformApi[name]('codex', payload)
      : null
    return serviceReader || bridgeReader
  }

  async function loadSessions (options = {}) {
    const reader = getCodexAction('listCliSessions')
    if (!reader) {
      const bridge = getHostBridge()
      const platformApi = bridge && bridge.platforms ? bridge.platforms : null
      const capabilities = platformApi && typeof platformApi.getCapabilities === 'function'
        ? platformApi.getCapabilities('codex')
        : null
      setSnapshot({
        success: false,
        error: `当前运行时未暴露 Codex 会话读取能力${capabilities ? `（capabilities: ${JSON.stringify(capabilities)}）` : ''}`,
        groups: [],
        accounts: [],
        totals: {}
      })
      return
    }
    const startedAt = Date.now()
    setLoading(true)
    try {
      const result = await Promise.resolve(reader({ accountId: accountFilter }))
      const normalized = normalizeSessionResult(result)
      setSnapshot(normalized)
      setCheckedSessionIds(prev => {
        const validIds = new Set(normalized.groups.flatMap(group => Array.isArray(group.sessions) ? group.sessions.map(session => session.id) : []))
        return new Set(Array.from(prev).filter(id => validIds.has(id)))
      })
      setSelectedSession(prev => {
        if (!prev) return null
        const next = normalized.groups
          .flatMap(group => Array.isArray(group.sessions) ? group.sessions : [])
          .find(session => session.id === prev.id)
        return next || null
      })
      setExpanded(prev => {
        if (prev.size === 0) return prev
        const validGroupIds = new Set(normalized.groups.map(group => group.id))
        return new Set(Array.from(prev).filter(id => validGroupIds.has(id)))
      })
      if (!normalized.success) toast?.error?.(normalized.error || '读取会话失败')
    } catch (err) {
      const message = err?.message || String(err)
      setSnapshot({ success: false, error: message, groups: [], accounts: [], totals: {} })
      toast?.error?.(`读取会话失败: ${message}`)
    } finally {
      await waitAtLeast(startedAt, options && options.minLoadingMs)
      setLoading(false)
    }
  }

  async function loadTrash (options = {}) {
    const reader = getCodexAction('listCliSessionTrash')
    if (!reader) {
      setTrashItems([])
      return
    }
    const startedAt = Date.now()
    setTrashLoading(true)
    try {
      const result = await Promise.resolve(reader({}))
      if (result && result.success !== false && Array.isArray(result.items)) {
        setTrashItems(result.items)
        setCheckedTrashIds(prev => {
          const validIds = new Set(result.items.map(item => item.trashId))
          return new Set(Array.from(prev).filter(id => validIds.has(id)))
        })
      } else {
        setTrashItems([])
        setCheckedTrashIds(new Set())
        if (result && result.error) toast?.error?.(result.error)
      }
    } catch (err) {
      setTrashItems([])
      setCheckedTrashIds(new Set())
      toast?.error?.(`读取回收站失败: ${err?.message || String(err)}`)
    } finally {
      await waitAtLeast(startedAt, options && options.minLoadingMs)
      setTrashLoading(false)
    }
  }

  function handleManualRefresh () {
    const options = { minLoadingMs: MANUAL_REFRESH_MIN_MS }
    return viewMode === 'trash' ? loadTrash(options) : loadSessions(options)
  }

  useEffect(() => {
    void loadSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, accountFilter])

  useEffect(() => {
    if (viewMode === 'trash') void loadTrash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, svc])

  useEffect(() => {
    if (!sessionSearchQuery) return
    const matchedGroupIds = visibleGroups.map(group => group.id).filter(Boolean)
    if (matchedGroupIds.length === 0) return
    setExpanded(prev => {
      const next = new Set(prev)
      matchedGroupIds.forEach(id => next.add(id))
      if (next.size === prev.size && matchedGroupIds.every(id => prev.has(id))) return prev
      return next
    })
  }, [sessionSearchQuery, visibleGroups])

  useEffect(() => {
    if (!copyTargetSession) return
    if (copyTargetOptions.some(option => option.id === copyTargetAccountId)) return
    setCopyTargetAccountId(copyTargetOptions[0]?.id || '')
  }, [copyTargetAccountId, copyTargetOptions, copyTargetSession])

  useEffect(() => {
    if (!selectedSession?.path) {
      setMessages([])
      setDetailTopButtonVisible(false)
      return
    }
    let disposed = false
    async function loadMessages () {
      const reader = getCodexAction('loadCliSessionMessages')
      if (!reader) {
        setMessages([])
        return
      }
      setMessageLoading(true)
      try {
        const result = await Promise.resolve(reader({ sourcePath: selectedSession.path }))
        if (!disposed) setMessages(result && Array.isArray(result.messages) ? result.messages : [])
      } catch {
        if (!disposed) setMessages([])
      } finally {
        if (!disposed) setMessageLoading(false)
      }
    }
    void loadMessages()
    return () => {
      disposed = true
    }
  }, [selectedSession?.path, svc])

  const updateDetailTopButton = useCallback(() => {
    const element = detailRef.current
    if (!element || !selectedSession || viewMode !== 'sessions') {
      setDetailTopButtonVisible(false)
      return
    }
    const rect = element.getBoundingClientRect()
    setDetailTopButtonVisible(rect.top < -80)
  }, [selectedSession, setDetailTopButtonVisible, viewMode])

  const scheduleDetailTopButtonUpdate = useCallback(() => {
    if (detailTopRafRef.current) return
    detailTopRafRef.current = window.requestAnimationFrame(() => {
      detailTopRafRef.current = 0
      updateDetailTopButton()
    })
  }, [updateDetailTopButton])

  useEffect(() => {
    updateDetailTopButton()
    if (!selectedSession || viewMode !== 'sessions') return undefined

    const element = detailRef.current
    const scrollRoot = element?.closest?.('.main-content') || window
    scheduleDetailTopButtonUpdate()
    scrollRoot.addEventListener('scroll', scheduleDetailTopButtonUpdate, { passive: true })
    window.addEventListener('resize', scheduleDetailTopButtonUpdate)
    return () => {
      if (detailTopRafRef.current) {
        window.cancelAnimationFrame(detailTopRafRef.current)
        detailTopRafRef.current = 0
      }
      scrollRoot.removeEventListener('scroll', scheduleDetailTopButtonUpdate)
      window.removeEventListener('resize', scheduleDetailTopButtonUpdate)
    }
  }, [selectedSession, viewMode, scheduleDetailTopButtonUpdate, updateDetailTopButton])

  function scrollToSelectedSessionRow () {
    const target = selectedSessionRowRef.current || detailRef.current
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setDetailTopButtonVisible(false)
  }

  function toggleGroup (id) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleShowInFolder (filePath) {
    const ok = await showItemInFolder(filePath)
    if (!ok) toast?.warning?.('当前环境无法定位该会话文件')
  }

  async function handleContinueCliSession (session) {
    if (!session?.sessionId) return
    if (session.status !== 'available' && session.status !== 'archived') return

    let nextSession = session
    if (session.status === 'archived') {
      const action = getCodexAction('unarchiveCliSession')
      if (!action) {
        toast?.warning?.('当前环境不支持恢复归档会话')
        return
      }
      const result = await Promise.resolve(action({ sessionId: session.sessionId, sourcePath: session.path }))
      if (!result || result.success === false) {
        toast?.error?.((result && result.error) || '恢复会话失败')
        return
      }
      nextSession = Object.assign({}, session, {
        status: 'available',
        archived: false,
        path: result.path || session.path
      })
      await loadSessions()
    }

    const prepareAction = getCodexAction('prepareCliSessionResume')
    if (!prepareAction) {
      toast?.warning?.('当前环境不支持按会话实例继续会话')
      return
    }
    const prepared = await Promise.resolve(prepareAction({
      sessionId: nextSession.sessionId,
      sourcePath: nextSession.path
    }))
    if (!prepared || prepared.success === false) {
      toast?.error?.((prepared && prepared.error) || '准备继续会话失败')
      return
    }

    const settings = readGlobalSettings()
    const codexSettings = readCodexAdvancedSettings()
    const result = await launchCliCommand({
      command: codexSettings.codexCliPath || prepared.command || 'codex',
      cwd: prepared.cwd || prepared.workspacePath,
      terminal: settings.defaultTerminal || 'system',
      env: prepared.env || (prepared.instanceDir ? { CODEX_HOME: prepared.instanceDir } : undefined),
      args: Array.isArray(prepared.args) ? prepared.args : ['resume', nextSession.sessionId]
    })
    if (!result || result.success === false) {
      toast?.error?.((result && result.error) || '打开 Codex CLI 失败')
      return
    }
    const sourceName = prepared.sourceName ? `（${prepared.sourceName}）` : ''
    toast?.success?.(session.status === 'archived' ? `会话已恢复，正在用对应实例继续会话${sourceName}` : `正在用对应实例继续会话${sourceName}`)
  }

  async function handleMoveToTrash (session) {
    if (!session?.sessionId || !session?.path) return
    const ok = window.confirm(`确认将「${displayTitle(session.title || session.sessionId)}」移动到回收站？`)
    if (!ok) return
    const action = getCodexAction('moveCliSessionsToTrash')
    if (!action) {
      toast?.warning?.('当前环境不支持会话回收站')
      return
    }
    const result = await Promise.resolve(action({ sessionId: session.sessionId, sourcePath: session.path }))
    if (result && result.success !== false) {
      toast?.success?.('已移动到回收站')
      setSelectedSession(null)
      setMessages([])
      await loadSessions()
      if (viewMode === 'trash') await loadTrash()
    } else {
      toast?.error?.((result && result.error) || '移动到回收站失败')
    }
  }

  async function handleUnarchiveSession (session) {
    if (!session?.sessionId) return
    const action = getCodexAction('unarchiveCliSession')
    if (!action) {
      toast?.warning?.('当前环境不支持取消归档')
      return
    }
    const result = await Promise.resolve(action({ sessionId: session.sessionId, sourcePath: session.path }))
    if (result && result.success !== false) {
      toast?.success?.('已取消归档')
      await loadSessions()
    } else {
      toast?.error?.((result && result.error) || '取消归档失败')
    }
  }

  async function handleArchiveSession (session) {
    if (!session?.sessionId) return
    const action = getCodexAction('archiveCliSession')
    if (!action) {
      toast?.warning?.('当前环境不支持归档')
      return
    }
    const result = await Promise.resolve(action({ sessionId: session.sessionId, sourcePath: session.path }))
    if (result && result.success !== false) {
      toast?.success?.('已归档')
      setSelectedSession(null)
      setMessages([])
      await loadSessions()
    } else {
      toast?.error?.((result && result.error) || '归档失败')
    }
  }

  function openCopySessionDialog (session) {
    if (!session?.sessionId || !session?.path) return
    setCopyTargetSession(session)
    setTransferMode('copy')
    const nextOptions = accountOptions.filter(option => option.id && option.id !== String(session.accountId || '').trim())
    setCopyTargetAccountId(nextOptions[0]?.id || '')
  }

  function closeCopySessionDialog () {
    if (copyingSession) return
    setCopyTargetSession(null)
    setCopyTargetAccountId('')
    setTransferMode('copy')
  }

  async function handleConfirmCopySession () {
    if (!copyTargetSession?.sessionId || !copyTargetSession?.path || !copyTargetAccountId || copyingSession) return
    const isMove = transferMode === 'move'
    const action = getCodexAction(isMove ? 'moveCliSessionToInstance' : 'copyCliSessionToInstance')
    if (!action) {
      toast?.warning?.(isMove ? '当前环境不支持移动会话到实例' : '当前环境不支持复制会话到实例')
      return
    }
    if (isMove) {
      const ok = window.confirm(`确认将「${copyTargetSession.title || copyTargetSession.sessionId}」移动到目标实例？源实例中的原会话会被移除。`)
      if (!ok) return
    }
    setCopyingSession(true)
    try {
      const result = await Promise.resolve(action({
        sessionId: copyTargetSession.sessionId,
        sourcePath: copyTargetSession.path,
        targetAccountId: copyTargetAccountId
      }))
      if (result && result.success !== false) {
        toast?.success?.(isMove ? '已移动到目标实例' : '已复制到目标实例，后续会话将作为独立副本继续')
        if (Array.isArray(result.warnings) && result.warnings.length > 0) {
          toast?.warning?.(result.warnings[0])
        }
        setCopyTargetSession(null)
        setCopyTargetAccountId('')
        setTransferMode('copy')
        if (isMove) {
          setSelectedSession(null)
          setMessages([])
        }
        await loadSessions()
      } else {
        toast?.error?.((result && result.error) || (isMove ? '移动会话失败' : '复制会话失败'))
      }
    } catch (err) {
      toast?.error?.(`${isMove ? '移动' : '复制'}会话失败: ${err?.message || String(err)}`)
    } finally {
      setCopyingSession(false)
    }
  }

  async function handleMoveCheckedToTrash () {
    if (checkedSessions.length === 0) return
    const ok = window.confirm(`确认将选中的 ${checkedSessions.length} 个会话移动到回收站？`)
    if (!ok) return
    const action = getCodexAction('moveCliSessionsToTrash')
    if (!action) {
      toast?.warning?.('当前环境不支持会话回收站')
      return
    }
    const result = await Promise.resolve(action({
      items: checkedSessions.map(session => ({ sessionId: session.sessionId, sourcePath: session.path }))
    }))
    if (result && result.success !== false) {
      toast?.success?.(`已移动 ${result.moved || checkedSessions.length} 个会话到回收站`)
      setCheckedSessionIds(new Set())
      setSelectedSession(null)
      setMessages([])
      await loadSessions()
    } else {
      toast?.error?.((result && result.error) || `移动失败，成功 ${result?.moved || 0} 个，失败 ${result?.failed || 0} 个`)
      await loadSessions()
    }
  }

  async function handleRestoreTrashItem (item) {
    const action = getCodexAction('restoreCliSessionFromTrash')
    if (!action) {
      toast?.warning?.('当前环境不支持恢复会话')
      return
    }
    const result = await Promise.resolve(action({ trashId: item.trashId }))
    if (result && result.success !== false) {
      toast?.success?.('会话已恢复')
      await loadTrash()
      await loadSessions()
    } else {
      toast?.error?.((result && result.error) || '恢复失败')
    }
  }

  async function handleRestoreCheckedTrashItems () {
    if (checkedTrashItems.length === 0) return
    const batchAction = getCodexAction('restoreCliSessionsFromTrash')
    const singleAction = getCodexAction('restoreCliSessionFromTrash')
    if (!batchAction && !singleAction) {
      toast?.warning?.('当前环境不支持恢复会话')
      return
    }
    const trashIds = checkedTrashItems.map(item => item.trashId)
    const result = batchAction
      ? await Promise.resolve(batchAction({ trashIds }))
      : {
          results: await Promise.all(trashIds.map(trashId => Promise.resolve(singleAction({ trashId })))),
        }
    if (!batchAction) {
      result.success = result.results.every(item => item && item.success !== false)
      result.restored = result.results.filter(item => item && item.success !== false).length
      result.failed = result.results.length - result.restored
    }
    if (result && result.success !== false) {
      toast?.success?.(`已恢复 ${result.restored || checkedTrashItems.length} 个会话`)
      setCheckedTrashIds(new Set())
      await loadTrash()
      await loadSessions()
    } else {
      toast?.error?.((result && result.error) || `恢复失败，成功 ${result?.restored || 0} 个，失败 ${result?.failed || 0} 个`)
      await loadTrash()
      await loadSessions()
    }
  }

  async function handleDeleteTrashItems (items, label = '选中的回收站记录') {
    if (!items.length) return
    const ok = window.confirm(`确认永久删除${label}？此操作无法恢复。`)
    if (!ok) return
    const action = getCodexAction('deleteCliSessionTrash')
    if (!action) {
      toast?.warning?.('当前环境不支持永久删除')
      return
    }
    const result = await Promise.resolve(action({ trashIds: items.map(item => item.trashId) }))
    if (result && result.success !== false) {
      toast?.success?.(`已永久删除 ${result.deleted || items.length} 条记录`)
      setCheckedTrashIds(new Set())
      await loadTrash()
    } else {
      toast?.error?.((result && result.error) || `永久删除失败，成功 ${result?.deleted || 0} 个，失败 ${result?.failed || 0} 个`)
      await loadTrash()
    }
  }

  async function handleCleanBrokenIndexes () {
    if (brokenSessionCount === 0 || cleaningIndexes) return
    const ok = window.confirm(`确认清理 ${brokenSessionCount} 条异常会话索引？只会删除缺失文件或信息不完整的索引，不会删除真实会话文件。`)
    if (!ok) return
    const action = getCodexAction('cleanCliSessionIndexes')
    if (!action) {
      toast?.warning?.('当前环境不支持清理会话索引')
      return
    }
    setCleaningIndexes(true)
    try {
      const result = await Promise.resolve(action({ accountId: accountFilter }))
      if (result && result.success !== false) {
        toast?.success?.(`已清理 ${result.removed || 0} 条异常索引`)
      } else {
        toast?.error?.((result && result.error) || `清理完成，失败 ${result?.failed || 0} 条`)
      }
      await loadSessions()
    } catch (err) {
      toast?.error?.(`清理异常索引失败: ${err?.message || String(err)}`)
    } finally {
      setCleaningIndexes(false)
    }
  }

  function toggleCheckedSession (sessionId) {
    setCheckedSessionIds(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  function toggleCheckedTrash (trashId) {
    setCheckedTrashIds(prev => {
      const next = new Set(prev)
      if (next.has(trashId)) next.delete(trashId)
      else next.add(trashId)
      return next
    })
  }

  function toggleSelectedSession (session) {
    setSelectedSession(prev => (prev && prev.id === session.id ? null : session))
  }

  const openImagePreview = useCallback((src) => {
    const safeSrc = String(src || '').trim()
    if (isSafeMarkdownImageSrc(safeSrc)) setPreviewImage(safeSrc)
  }, [])

  function renderSelectedSessionDetail () {
    if (!selectedSession) return null
    return (
      <div className='codex-session-inline-detail' ref={detailRef}>
        <div className='codex-session-detail'>
          <div className='codex-session-message-title'>
            <span>对话预览</span>
            <div className='codex-session-message-actions'>
              {debugMessageCount > 0 && (
                <button type='button' onClick={() => setShowDebugMessages(value => !value)}>
                  {showDebugMessages ? '隐藏调试信息' : `显示调试信息 ${debugMessageCount}`}
                </button>
              )}
              <em>{messageLoading ? '读取中' : `${visibleMessages.length} / ${messages.length} 条`}</em>
            </div>
          </div>
          <div className='codex-session-messages'>
            {!messageLoading && visibleMessages.length === 0 && <div className='codex-session-message-empty'>暂无可预览的对话消息</div>}
            {visibleMessages.slice(0, 120).map((message) => (
              <div className={`codex-session-message kind-${message.kind}`} key={message.id}>
                {message.kind === 'tool'
                  ? (
                    <details>
                      <summary>
                        <span>{summarizeToolMessage(message.content)}</span>
                        <time>{message.ts ? new Date(message.ts).toLocaleString() : ''}</time>
                      </summary>
                      <MessageContent content={message.content} images={message.images} onImagePreview={openImagePreview} />
                    </details>
                    )
                  : (
                    <>
                      <div className='codex-session-message-head'>
                        <strong>{getMessageRoleLabel(message.kind, message.role)}</strong>
                        <span>{message.ts ? new Date(message.ts).toLocaleString() : ''}</span>
                      </div>
                      <MessageContent content={message.content} images={message.images} onImagePreview={openImagePreview} />
                    </>
                    )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const totals = snapshot.totals || {}
  const visibleSessionCount = visibleGroups.reduce((sum, group) => sum + (Array.isArray(group.sessions) ? group.sessions.length : 0), 0)
  const refreshing = loading || trashLoading
  const stats = viewMode === 'trash'
    ? [
        { value: trashItems.length, label: '回收站' },
        { value: trashItems.filter(item => item.sourceType === 'default').length, label: '默认' },
        { value: trashItems.filter(item => item.sourceType !== 'default').length, label: '实例' }
      ]
    : [
        { value: visibleGroups.length, label: '工作区' },
        { value: visibleSessionCount, label: '会话' },
        brokenSessionCount > 0
          ? { value: brokenSessionCount, label: '异常' }
          : unindexedSessionCount > 0
            ? { value: unindexedSessionCount, label: '未索引' }
            : archivedSessionCount > 0
              ? { value: archivedSessionCount, label: '归档' }
              : { value: totals.sources || totals.boundAccounts || 0, label: '来源' }
      ]

  return (
    <div className='codex-session-page'>
      <div className='codex-session-controlbar'>
        <div className='codex-session-toolbar'>
          <button className='btn codex-session-back' onClick={onBack}>
            <ArrowLeftIcon size={15} /> 账号总览
          </button>
          <div className='codex-session-mode-tabs'>
            <button className={viewMode === 'sessions' ? 'active' : ''} onClick={() => setViewMode('sessions')}>会话</button>
            <button className={viewMode === 'trash' ? 'active' : ''} onClick={() => setViewMode('trash')}>回收站</button>
          </div>
          <div className='codex-session-filter'>
            <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value=''>全部会话来源</option>
              {accountOptions.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className='codex-session-toolbar-actions'>
            <button className={`action-bar-btn ${refreshing ? 'is-loading' : ''}`} data-tip={refreshing ? '刷新中' : '刷新'} onClick={() => void handleManualRefresh()} disabled={refreshing}>
              <RefreshIcon size={15} spinning={refreshing} />
            </button>
            {viewMode === 'sessions' && brokenSessionCount > 0 && (
              <button
                className='action-bar-btn codex-session-maintenance-btn'
                data-tip={`清理异常索引 ${brokenSessionCount}`}
                onClick={() => void handleCleanBrokenIndexes()}
                disabled={cleaningIndexes}
              >
                <WrenchIcon size={15} />
              </button>
            )}
          </div>
        </div>

        <div className='codex-session-opsbar'>
          {viewMode === 'sessions' && visibleSessions.length > 0 && (
            <div className='codex-session-selection-actions'>
              <label>
                <input
                  type='checkbox'
                  checked={checkedSessions.length > 0 && checkedSessions.length === visibleSessions.length}
                  onChange={(event) => setCheckedSessionIds(event.target.checked ? new Set(visibleSessions.map(session => session.id)) : new Set())}
                />
                <span>已选 {checkedSessions.length} / {visibleSessions.length}</span>
              </label>
              <button className='action-bar-btn action-bar-btn-danger' data-tip='移到回收站' onClick={() => void handleMoveCheckedToTrash()} disabled={checkedSessions.length === 0}>
                <TrashIcon size={15} />
              </button>
            </div>
          )}

          {viewMode === 'trash' && trashItems.length > 0 && (
            <div className='codex-session-selection-actions'>
              <label>
                <input
                  type='checkbox'
                  checked={checkedTrashItems.length > 0 && checkedTrashItems.length === trashItems.length}
                  onChange={(event) => setCheckedTrashIds(event.target.checked ? new Set(trashItems.map(item => item.trashId)) : new Set())}
                />
                <span>已选 {checkedTrashItems.length} / {trashItems.length}</span>
              </label>
              <button className='action-bar-btn' data-tip='恢复选中' onClick={() => void handleRestoreCheckedTrashItems()} disabled={checkedTrashItems.length === 0}>
                <RestoreTrashIcon size={15} />
              </button>
              <button className='action-bar-btn action-bar-btn-danger' data-tip='永久删除选中' onClick={() => void handleDeleteTrashItems(checkedTrashItems, `选中的 ${checkedTrashItems.length} 条回收站记录`)} disabled={checkedTrashItems.length === 0}>
                <TrashIcon size={15} />
              </button>
            </div>
          )}

          <div className='codex-session-mini-stats'>
            {stats.map(item => (
              <span key={item.label}><strong>{item.value}</strong>{item.label}</span>
            ))}
          </div>
        </div>
      </div>

      {!snapshot.success && (
        <div className='codex-session-notice'>{snapshot.error || '读取会话失败'}</div>
      )}

      {viewMode === 'sessions' && snapshot.success && visibleGroups.length === 0 && (
        <div className='empty-state codex-session-empty'>
          <FolderIcon size={42} />
          <div className='empty-state-text'>
            暂无可展示的 Codex 会话<br />
            默认 ~/.codex 或账号实例生成本地会话后，会在这里按工作区归档。
          </div>
        </div>
      )}

      {viewMode === 'trash' && trashItems.length === 0 && (
        <div className='empty-state codex-session-empty'>
          <TrashIcon size={42} />
          <div className='empty-state-text'>
            回收站为空<br />
            移动到回收站的 Codex 会话会显示在这里。
          </div>
        </div>
      )}

      {viewMode === 'trash' && trashItems.length > 0 && (
        <div className='codex-session-trash-list'>
          {trashItems.map(item => (
            <div className='codex-session-trash-row' key={item.trashId}>
              <input
                type='checkbox'
                checked={checkedTrashIds.has(item.trashId)}
                onChange={() => toggleCheckedTrash(item.trashId)}
              />
              <div className='codex-session-row-main'>
                <div className='codex-session-row-title'><HighlightText text={displayTitle(item.title)} query={sessionSearchQuery} /></div>
                <div className='codex-session-row-sub'>
                  <span><HighlightText text={displaySource(item)} query={sessionSearchQuery} /></span>
                  <span><HighlightText text={displayWorkspaceName(item.workspaceName)} query={sessionSearchQuery} /></span>
                  <span>{formatRelativeTime(item.trashedAt)}</span>
                </div>
              </div>
              <button className='action-bar-btn' data-tip='恢复' onClick={() => void handleRestoreTrashItem(item)}>
                <RestoreTrashIcon size={15} />
              </button>
              <button className='action-bar-btn action-bar-btn-danger' data-tip='永久删除' onClick={() => void handleDeleteTrashItems([item], '该回收站记录')}>
                <TrashIcon size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {viewMode === 'sessions' && visibleGroups.length > 0 && (
        <div className='codex-session-content'>
          <div className='codex-session-list'>
            {visibleGroups.map(group => {
              const isOpen = expanded.has(group.id)
              const sessions = Array.isArray(group.sessions) ? group.sessions : []
              return (
                <section className='codex-session-group' key={group.id}>
                  <button className='codex-session-group-header' type='button' onClick={() => toggleGroup(group.id)}>
                    <ChevronDownIcon size={16} className={isOpen ? 'is-open' : ''} />
                    <FolderIcon size={18} />
                    <div className='codex-session-group-title'>
                      <strong><HighlightText text={displayWorkspaceName(group.workspaceName)} query={sessionSearchQuery} /></strong>
                      {group.workspacePath && <span><HighlightText text={displayWorkspacePath(group.workspacePath)} query={sessionSearchQuery} /></span>}
                    </div>
                    <div className='codex-session-group-meta'>
                      <span>{sessions.length} 个会话</span>
                      <span>{formatRelativeTime(group.updatedAt)}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className='codex-session-rows'>
                      {sessions.map(session => (
                        <Fragment key={session.id}>
                          <div
                            className={`codex-session-row ${selectedSession?.id === session.id ? 'is-selected' : ''}`}
                            ref={selectedSession?.id === session.id ? selectedSessionRowRef : null}
                            title={selectedSession?.id === session.id ? '点击收起对话详情' : '点击展开对话详情'}
                            onClick={() => toggleSelectedSession(session)}
                          >
                            <input
                              type='checkbox'
                              checked={checkedSessionIds.has(session.id)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleCheckedSession(session.id)}
                            />
                            <div className='codex-session-row-main'>
                              <div className='codex-session-row-titleline'>
                                <div className='codex-session-row-title'><HighlightText text={displayTitle(session.title)} query={sessionSearchQuery} /></div>
                                {(() => {
                                  const meta = getSessionStatusMeta(session)
                                  return <span className={`codex-session-status ${meta.className}`} title={displayText(meta.tip)}>{meta.label}</span>
                                })()}
                                <span className='codex-session-row-title-meta'>{displaySessionInstance(session)}</span>
                                <span className='codex-session-row-title-meta'>{formatRelativeTime(session.updatedAt)}</span>
                                {formatSize(session.size) && <span className='codex-session-row-title-meta'>{formatSize(session.size)}</span>}
                              </div>
                              {(session.status === 'broken' || session.status === 'unindexed') && session.statusReason && (
                                <div className='codex-session-row-source'>
                                  <span><HighlightText text={displayText(session.statusReason)} query={sessionSearchQuery} /></span>
                                </div>
                              )}
                              {session.detachedWorkspace && (
                                <div className='codex-session-row-source'>
                                  <span>原工作区：<HighlightText text={getSessionWorkspaceSourceText(session)} query={sessionSearchQuery} /></span>
                                </div>
                              )}
                            </div>
                            {session.summary && (
                              <div className='codex-session-row-summary'>
                                <HighlightText text={displayText(session.summary)} query={sessionSearchQuery} />
                              </div>
                            )}
                            <div className='codex-session-row-actions'>
                              {(session.status === 'available' || session.status === 'archived') && (
                                <button
                                  className='action-bar-btn'
                                  type='button'
                                  data-tip={session.status === 'archived' ? '恢复并继续会话' : '继续会话'}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleContinueCliSession(session)
                                  }}
                                >
                                  <CommandLineIcon size={16} />
                                </button>
                              )}
                              <button
                                className='action-bar-btn'
                                type='button'
                                data-tip='定位会话文件'
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleShowInFolder(session.path)
                                }}
                                disabled={!session.path || session.status === 'broken'}
                              >
                                <FolderIcon size={16} />
                              </button>
                              <button
                                className='action-bar-btn action-bar-btn-danger'
                                type='button'
                                data-tip='移到回收站'
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleMoveToTrash(session)
                                }}
                                disabled={!session.path || session.status === 'broken'}
                              >
                                <TrashIcon size={16} />
                              </button>
                              {session.status === 'archived' && (
                                <button
                                  className='action-bar-btn'
                                  type='button'
                                  data-tip='取消归档'
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleUnarchiveSession(session)
                                  }}
                                >
                                  <UnarchiveIcon size={16} />
                                </button>
                              )}
                              {session.status === 'available' && (
                                <button
                                  className='action-bar-btn codex-session-archive-btn'
                                  type='button'
                                  data-tip='归档'
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleArchiveSession(session)
                                  }}
                                >
                                  <ArchiveIcon size={16} />
                                </button>
                              )}
                              {session.status !== 'broken' && (
                                <button
                                  className='action-bar-btn'
                                  type='button'
                                  data-tip='复制 / 移动到实例'
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openCopySessionDialog(session)
                                  }}
                                  disabled={!session.path || !accountOptions.some(option => option.id !== String(session.accountId || '').trim())}
                                >
                                  <CopyIcon size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                          {selectedSession?.id === session.id && renderSelectedSessionDetail()}
                        </Fragment>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      )}

      {showDetailTopButton && (
        <button
          className='codex-session-detail-top-btn'
          type='button'
          aria-label='回到当前会话'
          title='回到当前会话'
          onClick={scrollToSelectedSessionRow}
        >
          <ChevronUpIcon size={18} />
        </button>
      )}

      {previewImage && (
        <div className='codex-session-image-preview-backdrop' onClick={() => setPreviewImage(null)}>
          <div className='codex-session-image-preview' onClick={(event) => event.stopPropagation()}>
            <button type='button' aria-label='关闭图片预览' onClick={() => setPreviewImage(null)}>×</button>
            <img src={previewImage} alt='图片预览' />
          </div>
        </div>
      )}

      {copyTargetSession && (
        <div className='modal-overlay' onClick={closeCopySessionDialog}>
          <div className='modal-content codex-session-copy-modal' onClick={(event) => event.stopPropagation()}>
            <div className='modal-header'>
              <h3 className='modal-title'>复制 / 移动会话到实例</h3>
              <button className='modal-close' type='button' onClick={closeCopySessionDialog}>×</button>
            </div>
            <div className='modal-body'>
              <div className='codex-session-copy-summary'>
                <strong><HighlightText text={displayTitle(copyTargetSession.title)} query={sessionSearchQuery} /></strong>
                <span>源实例：{displaySource(copyTargetSession)}</span>
                <span>工作区：<HighlightText text={displayWorkspacePath(copyTargetSession.workspacePath, '未知工作区')} query={sessionSearchQuery} /></span>
              </div>
              <label className='codex-session-copy-field'>
                <span>目标实例</span>
                <select value={copyTargetAccountId} onChange={(event) => setCopyTargetAccountId(event.target.value)} disabled={copyingSession}>
                  {copyTargetOptions.length === 0 && <option value=''>没有可用的其他实例</option>}
                  {copyTargetOptions.map(option => (
                    <option value={option.id} key={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className='codex-session-transfer-mode'>
                <button type='button' className={transferMode === 'copy' ? 'active' : ''} onClick={() => setTransferMode('copy')} disabled={copyingSession}>复制</button>
                <button type='button' className={transferMode === 'move' ? 'active' : ''} onClick={() => setTransferMode('move')} disabled={copyingSession}>移动</button>
              </div>
              <p className='codex-session-copy-hint'>
                {transferMode === 'move'
                  ? '移动会先创建目标实例副本，成功后移除源实例中的原会话；默认保留原工作区路径。'
                  : '复制会创建一个独立副本，后续对话不会与原会话同步；默认保留原工作区路径。'}
              </p>
            </div>
            <div className='modal-footer'>
              <button className='btn' type='button' onClick={closeCopySessionDialog} disabled={copyingSession}>取消</button>
              <button className='btn btn-primary' type='button' onClick={() => void handleConfirmCopySession()} disabled={!copyTargetAccountId || copyingSession}>
                {copyingSession ? (transferMode === 'move' ? '移动中...' : '复制中...') : (transferMode === 'move' ? '移动' : '复制')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
