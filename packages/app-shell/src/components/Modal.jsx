import { useEffect, useRef } from 'react'

const modalStack = []
let modalSeq = 0
let tooltipSuspendTimer = null
let tooltipResumeListenersBound = false

function clearTooltipSuspendState () {
  if (tooltipSuspendTimer) {
    clearTimeout(tooltipSuspendTimer)
    tooltipSuspendTimer = null
  }
  if (typeof document !== 'undefined' && document && document.documentElement) {
    document.documentElement.removeAttribute('data-suspend-tooltips')
  }
  if (tooltipResumeListenersBound && typeof window !== 'undefined' && window) {
    window.removeEventListener('mousemove', clearTooltipSuspendState, true)
    window.removeEventListener('mousedown', clearTooltipSuspendState, true)
    window.removeEventListener('keydown', clearTooltipSuspendState, true)
    tooltipResumeListenersBound = false
  }
}

function suspendTooltipsTemporarily () {
  if (typeof document === 'undefined' || !document || !document.documentElement) return
  document.documentElement.setAttribute('data-suspend-tooltips', 'true')
  if (!tooltipResumeListenersBound && typeof window !== 'undefined' && window) {
    window.addEventListener('mousemove', clearTooltipSuspendState, true)
    window.addEventListener('mousedown', clearTooltipSuspendState, true)
    window.addEventListener('keydown', clearTooltipSuspendState, true)
    tooltipResumeListenersBound = true
  }
  if (tooltipSuspendTimer) {
    clearTimeout(tooltipSuspendTimer)
  }
  tooltipSuspendTimer = setTimeout(clearTooltipSuspendState, 240)
}

/**
 * 通用模态框组件
 */
export default function Modal ({ title, open, onClose, children, footer, contentClassName = '' }) {
  const modalIdRef = useRef(0)
  const contentRef = useRef(null)
  const previousActiveRef = useRef(null)
  if (!modalIdRef.current) {
    modalSeq += 1
    modalIdRef.current = modalSeq
  }

  useEffect(() => {
    if (!open) return

    previousActiveRef.current = (typeof document !== 'undefined' && document && document.activeElement instanceof HTMLElement)
      ? document.activeElement
      : null
    if (previousActiveRef.current && typeof previousActiveRef.current.blur === 'function') {
      previousActiveRef.current.blur()
    }
    if (typeof window !== 'undefined' && window && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        if (contentRef.current && typeof contentRef.current.focus === 'function') {
          contentRef.current.focus({ preventScroll: true })
        }
      })
    }

    const modalId = modalIdRef.current
    if (!modalStack.includes(modalId)) {
      modalStack.push(modalId)
    }

    const requestClose = () => {
      if (typeof document !== 'undefined' && document && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      suspendTooltipsTemporarily()
      onClose?.()
    }

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      const topmostId = modalStack[modalStack.length - 1]
      if (topmostId !== modalId) return
      event.preventDefault()
      requestClose()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      const idx = modalStack.lastIndexOf(modalId)
      if (idx >= 0) {
        modalStack.splice(idx, 1)
      }
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className='modal-overlay'
      onClick={() => {
        if (typeof document !== 'undefined' && document && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        suspendTooltipsTemporarily()
        onClose?.()
      }}
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className={`modal-content ${contentClassName || ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='modal-header'>
          <h3 className='modal-title'>{title}</h3>
          <button
            className='modal-close'
            onClick={() => {
              if (typeof document !== 'undefined' && document && document.activeElement instanceof HTMLElement) {
                document.activeElement.blur()
              }
              suspendTooltipsTemporarily()
              onClose?.()
            }}
          >
            ✕
          </button>
        </div>
        <div className='modal-body'>
          {children}
        </div>
        {footer
          ? <div className='modal-footer'>{footer}</div>
          : null}
      </div>
    </div>
  )
}

/**
 * 确认对话框
 */
export function ConfirmModal ({ title, message, open, onConfirm, onCancel, danger }) {
  if (!open) return null

  return (
    <Modal
      title={title || '确认'}
      open={open}
      onClose={onCancel}
      footer={
        <>
          <button className='btn' onClick={onCancel}>取消</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            确定
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{message}</p>
    </Modal>
  )
}
