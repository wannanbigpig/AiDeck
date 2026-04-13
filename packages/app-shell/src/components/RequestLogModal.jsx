import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import {
  clearRequestLogs,
  getRequestLogDirPath,
  openRequestLogDir,
  readRequestLogs,
  subscribeRequestLogEvents
} from '../utils/requestLogClient'
import {
  INITIAL_LOG_LIMIT,
  MAX_VISIBLE_LOGS,
  capVisibleLogs,
  getRequestLogLine,
  isNearLogBottom
} from '../utils/requestLogView'
import { copyText } from '../utils/hostBridge.js'

export default function RequestLogModal ({ open, onClose, toast }) {
  const [logs, setLogs] = useState([])
  const consoleRef = useRef(null)
  const stickToBottomRef = useRef(true)
  const pendingScrollRef = useRef(false)
  const logDirPath = getRequestLogDirPath()

  const scrollToBottom = useCallback(() => {
    const element = consoleRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    stickToBottomRef.current = true
    pendingScrollRef.current = false
  }, [])

  const loadLatestLogs = useCallback(() => {
    pendingScrollRef.current = true
    stickToBottomRef.current = true
    setLogs(capVisibleLogs(readRequestLogs(INITIAL_LOG_LIMIT)))
  }, [])

  const appendLogEntry = useCallback((entry) => {
    if (!entry) return
    setLogs((currentLogs) => {
      const shouldStick = pendingScrollRef.current || isNearLogBottom(consoleRef.current)
      const nextLogs = capVisibleLogs([...(Array.isArray(currentLogs) ? currentLogs : []), entry])
      pendingScrollRef.current = shouldStick
      stickToBottomRef.current = shouldStick
      return nextLogs
    })
  }, [])

  useEffect(() => {
    if (!open) return
    loadLatestLogs()
    const unsubscribe = subscribeRequestLogEvents((event) => {
      if (!event || typeof event !== 'object') {
        loadLatestLogs()
        return
      }
      if (event.type === 'clear') {
        pendingScrollRef.current = true
        stickToBottomRef.current = true
        setLogs([])
        return
      }
      if (event.type === 'append') {
        appendLogEntry(event.entry)
        return
      }
      if (event.type === 'enabled') {
        return
      }
      loadLatestLogs()
    })
    return () => {
      unsubscribe()
    }
  }, [appendLogEntry, loadLatestLogs, open])

  useEffect(() => {
    if (!open || logs.length === 0) return
    if (!pendingScrollRef.current && !stickToBottomRef.current) return
    const frameId = window.requestAnimationFrame(scrollToBottom)
    return () => window.cancelAnimationFrame(frameId)
  }, [logs, open, scrollToBottom])

  const logText = useMemo(() => {
    return logs.map(getRequestLogLine).join('\n')
  }, [logs])

  async function handleCopyLogs () {
    const ok = await copyText(logText)
    if (ok) {
      toast?.success?.('日志已复制')
    } else {
      toast?.warning?.('复制失败')
    }
  }

  function handleClearLogs () {
    clearRequestLogs()
    pendingScrollRef.current = true
    stickToBottomRef.current = true
    setLogs([])
    toast?.success?.('日志已清空')
  }

  async function handleOpenLogDir () {
    const result = await openRequestLogDir()
    if (result && result.success) {
      toast?.success?.('已打开日志目录')
    } else {
      toast?.warning?.((result && result.error) || '打开日志目录失败')
    }
  }

  return (
    <Modal
      title='操作日志'
      open={open}
      onClose={onClose}
      contentClassName='request-log-modal'
      footer={
        <div className='request-log-footer'>
          <div className='request-log-footer-meta'>
            <div className='request-log-meta-row'>
              <span className='request-log-meta-item'>当前显示 {logs.length} 条</span>
              <span className='request-log-meta-item'>默认加载最新 {INITIAL_LOG_LIMIT} 条</span>
              <span className='request-log-meta-item'>最多显示最近 {MAX_VISIBLE_LOGS} 条</span>
              <span className='request-log-meta-item'>实时订阅更新</span>
            </div>
            {logDirPath ? (
              <div className='request-log-path' title={logDirPath}>
                {logDirPath}
              </div>
            ) : null}
          </div>
          <div className='request-log-footer-actions'>
            <button className='btn' onClick={onClose}>关闭</button>
            <button className='btn' style={{ background: 'var(--bg-surface)' }} onClick={loadLatestLogs}>刷新</button>
            <button className='btn' style={{ background: 'var(--bg-surface)' }} onClick={handleClearLogs}>清空</button>
            <button className='btn' style={{ background: 'var(--bg-surface)' }} onClick={handleOpenLogDir}>打开日志目录</button>
            <button className='btn btn-primary' onClick={handleCopyLogs}>复制日志</button>
          </div>
        </div>
      }
    >
      {logs.length > 0
        ? (
          <pre
            ref={consoleRef}
            className='request-log-console'
            onScroll={() => {
              stickToBottomRef.current = isNearLogBottom(consoleRef.current)
            }}
          >
            {logText}
          </pre>
          )
        : (
          <div className='request-log-empty'>
            暂无日志。开启“查看操作日志”后，再执行刷新配额、刷新 Token、切号等操作即可看到记录。
          </div>
          )}
    </Modal>
  )
}
