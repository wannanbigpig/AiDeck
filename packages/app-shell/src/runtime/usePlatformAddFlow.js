import { useCallback } from 'react'

export function usePlatformAddFlow (options = {}) {
  const {
    setOpen,
    setTab,
    resetForm,
    ensureOAuthReady,
    resetOAuth,
    defaultTab = 'oauth'
  } = options

  const handleSwitchAddTab = useCallback((nextTab) => {
    setTab(nextTab)
    if (nextTab === 'oauth') {
      void ensureOAuthReady?.()
    }
  }, [ensureOAuthReady, setTab])

  const openAddModal = useCallback((initialTab = defaultTab) => {
    setOpen(true)
    setTab(initialTab)
    resetForm?.()
    if (initialTab === 'oauth') {
      void ensureOAuthReady?.()
      return
    }
    resetOAuth?.()
  }, [defaultTab, ensureOAuthReady, resetForm, resetOAuth, setOpen, setTab])

  const closeAddModal = useCallback(() => {
    resetOAuth?.()
    setOpen(false)
    setTab(defaultTab)
    resetForm?.()
  }, [defaultTab, resetForm, resetOAuth, setOpen, setTab])

  return {
    handleSwitchAddTab,
    openAddModal,
    closeAddModal
  }
}
