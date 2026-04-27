import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { copyText } from '../utils/hostBridge.js'

const GlobalNoticeContext = createContext(null)

export function useGlobalNotice () {
  return useContext(GlobalNoticeContext)
}

export function GlobalNoticeProvider ({ children }) {
  const [notice, setNotice] = useState(null)
  const [copyState, setCopyState] = useState('')

  const showNotice = useCallback((options) => {
    setCopyState('')
    setNotice(options || null)
  }, [])

  const closeNotice = useCallback(() => {
    setCopyState('')
    setNotice(null)
  }, [])

  const value = useMemo(() => ({
    show: showNotice,
    close: closeNotice
  }), [showNotice, closeNotice])

  async function handleCopyCommand () {
    if (!notice?.command) return
    const ok = await copyText(notice.command)
    setCopyState(ok ? '已复制' : '复制失败，请手动复制')
  }

  const tone = notice?.tone || 'info'
  const actions = Array.isArray(notice?.actions) ? notice.actions : []

  return (
    <GlobalNoticeContext.Provider value={value}>
      {children}
      {notice && (
        <div className='global-notice-overlay' onClick={notice.closeOnOverlay === false ? undefined : closeNotice}>
          <div className={`global-notice global-notice-${tone}`} onClick={(event) => event.stopPropagation()}>
            <div className='global-notice-header'>
              <div>
                <div className='global-notice-title'>{notice.title || '提示'}</div>
                {notice.message && <div className='global-notice-message'>{notice.message}</div>}
              </div>
              <button className='global-notice-close' onClick={closeNotice} aria-label='关闭'>×</button>
            </div>
            {notice.detail && <div className='global-notice-detail'>{notice.detail}</div>}
            {notice.command && (
              <div className='global-notice-command-row'>
                <code className='global-notice-command'>{notice.command}</code>
                <button className='btn btn-secondary global-notice-copy' onClick={handleCopyCommand}>
                  复制
                </button>
              </div>
            )}
            {copyState && <div className='global-notice-copy-state'>{copyState}</div>}
            <div className='global-notice-actions'>
              {actions.map((action, index) => (
                <button
                  key={action.id || index}
                  className={`btn ${action.variant === 'secondary' ? 'btn-secondary' : 'btn-primary'}`}
                  disabled={action.disabled}
                  onClick={async () => {
                    await Promise.resolve(action.onClick?.())
                    if (action.autoClose !== false) closeNotice()
                  }}
                >
                  {action.label}
                </button>
              ))}
              <button className='btn btn-primary' onClick={closeNotice}>知道了</button>
            </div>
          </div>
        </div>
      )}
    </GlobalNoticeContext.Provider>
  )
}
