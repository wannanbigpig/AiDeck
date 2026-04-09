import { useEffect, useState, useCallback, createContext, useContext } from 'react'

const ToastContext = createContext(null)

/**
 * Toast 通知 Hook
 */
export function useToast () {
  return useContext(ToastContext)
}

/**
 * Toast 容器 + Provider
 */
export function ToastProvider ({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration)
    }
  }, [])

  const toast = {
    info: (msg, dur) => addToast(msg, 'info', dur),
    success: (msg, dur) => addToast(msg, 'success', dur),
    error: (msg, dur) => addToast(msg, 'error', dur),
    warning: (msg, dur) => addToast(msg, 'warning', dur)
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className='toast-container'>
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{getIcon(t.type)}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function getIcon (type) {
  switch (type) {
    case 'success': return '✓'
    case 'error': return '✕'
    case 'warning': return '⚠'
    default: return 'ℹ'
  }
}
