import { useMemo, useCallback } from 'react'
import { usePlatformSnapshot } from './usePlatformSnapshot.js'

export function useDashboardPlatformData (activePlatform = 'dashboard') {
  const antigravity = usePlatformSnapshot('antigravity', {
    watchLocalState: activePlatform !== 'antigravity',
    watchStorageRevision: true,
    syncCurrentFromLocal: activePlatform !== 'antigravity',
    autoImport: false
  })
  const codex = usePlatformSnapshot('codex', {
    watchLocalState: activePlatform !== 'codex',
    watchStorageRevision: true,
    syncCurrentFromLocal: activePlatform !== 'codex',
    autoImport: false
  })
  const gemini = usePlatformSnapshot('gemini', {
    watchLocalState: activePlatform !== 'gemini',
    watchStorageRevision: true,
    syncCurrentFromLocal: activePlatform !== 'gemini',
    autoImport: false
  })

  const platformData = useMemo(() => ({
    antigravity: {
      accounts: antigravity.accounts,
      currentId: antigravity.currentId
    },
    codex: {
      accounts: codex.accounts,
      currentId: codex.currentId
    },
    gemini: {
      accounts: gemini.accounts,
      currentId: gemini.currentId
    }
  }), [antigravity.accounts, antigravity.currentId, codex.accounts, codex.currentId, gemini.accounts, gemini.currentId])

  const refreshAll = useCallback(() => {
    antigravity.refreshSnapshot()
    codex.refreshSnapshot()
    gemini.refreshSnapshot()
  }, [antigravity, codex, gemini])

  return {
    platformData,
    refreshAll
  }
}
