import { useEffect, useRef } from 'react'
import { useTaskPolling } from './useTaskPolling.js'

const DEFAULT_TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000
const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000
const RETRY_COOLDOWN_MS = 5 * 60 * 1000

function normalizeTimestampMs (value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num) || num <= 0) return null
  return num > 1e12 ? num : num * 1000
}

function decodeJwtExpMs (token) {
  if (!token) return null
  try {
    const parts = String(token).split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = typeof atob === 'function' ? atob(base64) : ''
    if (!decoded) return null
    const data = JSON.parse(decoded)
    if (!data.exp || typeof data.exp !== 'number') return null
    return data.exp * 1000
  } catch {
    return null
  }
}

function getPlatformTokenExpiryMs (platform, account) {
  if (!account || typeof account !== 'object') return null
  switch (platform) {
    case 'gemini':
      return normalizeTimestampMs(account.expiry_date || account.tokens?.expiry_date)
    case 'antigravity':
      return normalizeTimestampMs(account.token?.expiry_timestamp || account.expiry_timestamp)
    case 'codex':
      return decodeJwtExpMs(account.tokens?.access_token)
    default:
      return null
  }
}

function hasPlatformRefreshToken (platform, account) {
  if (!account || typeof account !== 'object') return false
  switch (platform) {
    case 'gemini':
      return !!String(account.refresh_token || account.tokens?.refresh_token || '').trim()
    case 'antigravity':
      return !!String(account.token?.refresh_token || account.refresh_token || '').trim()
    case 'codex':
      return !!String(account.tokens?.refresh_token || account.refresh_token || '').trim()
    default:
      return false
  }
}

export function usePlatformTokenAutoRefresh (options = {}) {
  const {
    enabled = true,
    platform,
    svc,
    accounts,
    refreshSnapshot,
    leadTimeMs = DEFAULT_TOKEN_REFRESH_LEAD_MS,
    intervalMs = DEFAULT_CHECK_INTERVAL_MS
  } = options
  const inflightRef = useRef(new Set())
  const lastAttemptRef = useRef(new Map())

  async function checkAndRefreshExpiringTokens () {
    if (!svc || typeof svc.refreshToken !== 'function') return
    const list = Array.isArray(accounts) ? accounts : []
    if (list.length === 0) return

    const now = Date.now()
    let changed = false

    for (const account of list) {
      const accountId = String(account && account.id ? account.id : '').trim()
      if (!accountId) continue

      const expiryMs = getPlatformTokenExpiryMs(platform, account)
      if (!expiryMs) continue
      if (!hasPlatformRefreshToken(platform, account)) continue
      if (expiryMs > now + leadTimeMs) continue
      if (inflightRef.current.has(accountId)) continue

      const lastAttemptAt = Number(lastAttemptRef.current.get(accountId) || 0)
      if (lastAttemptAt > 0 && (now - lastAttemptAt) < RETRY_COOLDOWN_MS) {
        continue
      }

      inflightRef.current.add(accountId)
      lastAttemptRef.current.set(accountId, now)
      try {
        const result = await Promise.resolve(svc.refreshToken(accountId))
        if (result && result.success) {
          changed = true
        }
      } catch (e) {
      } finally {
        inflightRef.current.delete(accountId)
      }
    }

    if (changed) {
      refreshSnapshot?.()
    }
  }

  const { start, stop } = useTaskPolling(checkAndRefreshExpiringTokens, intervalMs)

  useEffect(() => {
    if (!enabled || !svc || typeof svc.refreshToken !== 'function') {
      stop()
      return
    }
    void checkAndRefreshExpiringTokens()
    start()
    return () => stop()
  }, [enabled, svc, start, stop, platform, leadTimeMs, refreshSnapshot, accounts.length])
}

export function shouldEnableStandaloneTokenAutoRefresh (autoRefreshMinutes, leadTimeMs = DEFAULT_TOKEN_REFRESH_LEAD_MS) {
  const minutes = Number(autoRefreshMinutes || 0)
  if (!Number.isFinite(minutes) || minutes <= 0) return true
  return minutes * 60 * 1000 > leadTimeMs
}

export {
  decodeJwtExpMs,
  getPlatformTokenExpiryMs
}
