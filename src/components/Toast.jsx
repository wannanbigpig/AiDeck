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
    return id
  }, [])

  const upsertToast = useCallback((id, message, type = 'info', progress = -1) => {
    setToasts(prev => {
      const existing = prev.find(t => t.id === id)
      if (existing) {
        return prev.map(t => t.id === id ? { ...t, message, type, progress } : t)
      } else {
        return [...prev, { id, message, type, progress }]
      }
    })
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = {
    info: (msg, dur) => addToast(msg, 'info', dur),
    success: (msg, dur) => addToast(msg, 'success', dur),
    error: (msg, dur) => addToast(msg, 'error', dur),
    warning: (msg, dur) => addToast(msg, 'warning', dur),
    upsert: (id, msg, type, progress) => upsertToast(id, msg, type, progress),
    remove: (id) => removeToast(id)
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className='toast-container'>
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type} ${t.progress >= 0 ? 'progress-toast' : ''}`}>
            <div className='toast-content'>
              <span className='toast-icon'>{getIcon(t.type)}</span>
              <span className='toast-message'>{t.message}</span>
            </div>
            {t.progress >= 0 && (
              <div className='toast-progress-wrapper'>
                <div 
                  className='toast-progress-inner' 
                  style={{ width: `${Math.min(100, Math.max(0, t.progress))}%` }} 
                />
              </div>
            )}
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
