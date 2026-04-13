import { useEffect, useRef } from 'react'

export function useOAuthAutoPrepareOnOpen (options = {}) {
  const {
    open,
    addTab,
    oauthPreparing,
    oauthAuthUrl,
    oauthSessionId,
    onPrepareOAuthSession
  } = options
  const hasAutoPreparedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      hasAutoPreparedRef.current = false
      return
    }
    if (addTab !== 'oauth') return
    if (oauthPreparing || oauthAuthUrl || oauthSessionId) return
    if (hasAutoPreparedRef.current) return

    hasAutoPreparedRef.current = true
    void onPrepareOAuthSession?.()
  }, [open, addTab, oauthPreparing, oauthAuthUrl, oauthSessionId, onPrepareOAuthSession])
}
