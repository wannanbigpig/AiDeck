import { useEffect } from 'react'
import { subscribeLocalState, subscribeStorageRevision } from '../utils/hostBridge.js'

function matchPlatform (expectedPlatform, actualPlatform) {
  const expected = String(expectedPlatform || '').trim().toLowerCase()
  const actual = String(actualPlatform || '').trim().toLowerCase()
  if (!expected) return true
  if (!actual) return true
  return actual === expected || actual === 'all'
}

export function usePlatformEvents (platform, handlers = {}, options = {}) {
  const {
    watchLocalState = true,
    watchStorageRevision = true
  } = options
  const {
    onLocalState,
    onStorageRevision
  } = handlers || {}

  useEffect(() => {
    if (!watchLocalState || typeof onLocalState !== 'function') return
    return subscribeLocalState({ platform }, (detail) => {
      if (!matchPlatform(platform, detail?.platform)) return
      onLocalState(detail || {})
    })
  }, [platform, watchLocalState, onLocalState])

  useEffect(() => {
    if (!watchStorageRevision || typeof onStorageRevision !== 'function') return
    return subscribeStorageRevision({ platform }, (detail) => {
      const detailPlatform = detail?.detail?.platform
      if (detailPlatform && !matchPlatform(platform, detailPlatform)) return
      onStorageRevision(detail || {})
    })
  }, [platform, watchStorageRevision, onStorageRevision])
}
