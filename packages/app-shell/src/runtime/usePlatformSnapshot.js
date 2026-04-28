import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getPlatformService } from '../utils/hostBridge.js'
import { usePlatformEvents } from './usePlatformEvents.js'
import { normalizePlatformService } from './normalizePlatformService.js'

/**
 * @typedef {Object} PlatformSnapshot
 * @property {Array} accounts
 * @property {string|null} currentId
 * @property {boolean} ready
 */

function buildEmptySnapshot () {
  return {
    accounts: [],
    currentId: null,
    ready: false
  }
}

function buildAccountsFingerprint (accounts) {
  const list = Array.isArray(accounts) ? accounts : []
  return list
    .map((account) => {
      const item = account && typeof account === 'object' ? account : {}
      const quota = item.quota && typeof item.quota === 'object' ? item.quota : {}
      const additional = Array.isArray(quota.additional_rate_limits)
        ? quota.additional_rate_limits.map(limit => [
            String(limit?.limit_name || ''),
            Number(limit?.hourly_percentage ?? -1),
            Number(limit?.hourly_reset_time || 0),
            Number(limit?.weekly_percentage ?? -1),
            Number(limit?.weekly_reset_time || 0)
          ].join('/')).join(',')
        : ''
      return [
        String(item.id || ''),
        Number(item.updated_at || 0),
        Number(item.last_used || 0),
        String(item.invalid ? '1' : '0'),
        String(item.quota_error?.message || item.quota?.error || ''),
        Number(quota.schema_version || 0),
        Number(quota.updated_at || 0),
        Number(quota.hourly_percentage ?? -1),
        Number(quota.hourly_reset_time || 0),
        Number(quota.weekly_percentage ?? -1),
        Number(quota.weekly_reset_time || 0),
        additional,
        String(quota.credits?.balance ?? ''),
        String(quota.credits?.unlimited ? '1' : '0')
      ].join(':')
    })
    .join('|')
}

export function usePlatformSnapshot (platform, options = {}) {
  const {
    watchLocalState = false,
    watchStorageRevision = true,
    syncCurrentFromLocal = false,
    autoImport = false,
    onAfterSync = null
  } = options
  const rawSvc = getPlatformService(platform)
  const svc = useMemo(() => normalizePlatformService(platform, rawSvc), [platform, rawSvc])
  const [snapshot, setSnapshot] = useState(buildEmptySnapshot)

  // 使用 ref 保存 onAfterSync 回调，避免将其加入 useCallback 依赖导致无限循环。
  // 原因：调用方通常传入未经 useCallback 包裹的函数（如 refreshLocalImportHint），
  // 每次渲染都是新引用，如果放入依赖会导致 syncSnapshotFromLocal 不断重建，
  // 进而触发 bootstrap useEffect 无限执行 → Maximum update depth exceeded。
  const onAfterSyncRef = useRef(onAfterSync)
  useEffect(() => {
    onAfterSyncRef.current = onAfterSync
  }, [onAfterSync])

  const refreshSnapshot = useCallback(() => {
    if (!svc) {
      const next = buildEmptySnapshot()
      setSnapshot(next)
      return next
    }

    const listedAccounts = typeof svc.list === 'function' ? svc.list() : []
    const accounts = Array.isArray(listedAccounts) ? listedAccounts : []
    const current = svc.getCurrent?.()
    const currentId = current?.id || null

    // 增加冲突检测：如果账号 ID 列表和当前激活 ID 都没有变化，则不更新 State，
    // 避免因为 svc.list() 返回新数组引用而导致的下游渲染死循环。
    setSnapshot((prev) => {
      const prevFingerprint = buildAccountsFingerprint(prev.accounts)
      const nextFingerprint = buildAccountsFingerprint(accounts)

      // 除账号 ID 外，还纳入 updated_at / last_used / invalid / quota error，
      // 这样配额刷新成功、状态恢复等内容变化时也能正确刷新 UI。
      if (
        prev.ready &&
        prev.currentId === currentId &&
        prev.accounts.length === accounts.length &&
        prevFingerprint === nextFingerprint
      ) {
        return prev
      }

      return {
        accounts,
        currentId,
        ready: true
      }
    })
  }, [svc])

  const syncSnapshotFromLocal = useCallback(async (detail = null) => {
    if (!svc || typeof svc.syncCurrentFromLocal !== 'function') {
      return null
    }
    const result = await Promise.resolve(svc.syncCurrentFromLocal({ autoImport }))
    if (result?.success && (result.changed || typeof result.currentId !== 'undefined')) {
      refreshSnapshot()
    }
    const afterSync = onAfterSyncRef.current
    if (typeof afterSync === 'function') {
      await Promise.resolve(afterSync(result, detail))
    }
    return result
  }, [svc, autoImport, refreshSnapshot])

  useEffect(() => {
    refreshSnapshot()
  }, [refreshSnapshot])

  useEffect(() => {
    if (!syncCurrentFromLocal) return
    void syncSnapshotFromLocal({
      platform,
      scope: 'bootstrap',
      kind: 'bootstrap',
      ts: Date.now()
    })
  }, [platform, syncCurrentFromLocal, syncSnapshotFromLocal])

  usePlatformEvents(platform, {
    onLocalState: syncCurrentFromLocal
      ? (detail) => { void syncSnapshotFromLocal(detail) }
      : () => { void refreshSnapshot() },
    onStorageRevision: () => { void refreshSnapshot() }
  }, {
    watchLocalState,
    watchStorageRevision
  })

  const api = useMemo(() => ({
    svc,
    snapshot,
    accounts: snapshot.accounts,
    currentId: snapshot.currentId,
    ready: snapshot.ready,
    setSnapshot,
    setAccounts (updater) {
      setSnapshot((prev) => {
        const nextAccounts = typeof updater === 'function' ? updater(prev.accounts) : updater
        return Object.assign({}, prev, {
          accounts: Array.isArray(nextAccounts) ? nextAccounts : []
        })
      })
    },
    setCurrentId (nextId) {
      setSnapshot((prev) => Object.assign({}, prev, {
        currentId: nextId ? String(nextId) : null
      }))
    },
    refreshSnapshot,
    syncSnapshotFromLocal
  }), [svc, snapshot, refreshSnapshot, syncSnapshotFromLocal])

  return api
}
