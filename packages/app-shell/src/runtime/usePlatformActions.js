import { useCallback, useRef, useState } from 'react'

function sleep (ms) {
  const waitMs = Number(ms || 0)
  if (!(waitMs > 0)) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, waitMs))
}

/**
 * @typedef {Object} PlatformActionRunner
 * @property {Set<string>} runningIds
 * @property {boolean} batchRunning
 * @property {(id: string) => boolean} isRunningId
 * @property {(id: string, task: (id: string) => Promise<any>) => Promise<any>} runSingle
 * @property {(ids: string[], task: (id: string) => Promise<any>, options?: Object) => Promise<{skipped:boolean,results:Array}>} runBatch
 */

export function usePlatformActions () {
  const inFlightRef = useRef(new Map())
  const batchRunningRef = useRef(false)
  const [runningIds, setRunningIds] = useState(() => new Set())
  const [batchRunning, setBatchRunning] = useState(false)

  const markRunning = useCallback((id) => {
    setRunningIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const clearRunning = useCallback((id) => {
    setRunningIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const runSingle = useCallback((accountId, task) => {
    const id = String(accountId || '').trim()
    if (!id || typeof task !== 'function') return Promise.resolve(null)
    const existing = inFlightRef.current.get(id)
    if (existing) return existing

    markRunning(id)
    const promise = Promise.resolve()
      .then(() => task(id))
      .finally(() => {
        inFlightRef.current.delete(id)
        clearRunning(id)
      })

    inFlightRef.current.set(id, promise)
    return promise
  }, [markRunning, clearRunning])

  const runBatch = useCallback(async (accountIds, task, options = {}) => {
    if (batchRunningRef.current) {
      return { skipped: true, results: [] }
    }
    const ids = Array.from(new Set((Array.isArray(accountIds) ? accountIds : []).map((item) => String(item || '').trim()).filter(Boolean)))
    if (ids.length === 0) {
      return { skipped: false, results: [] }
    }

    const concurrency = Math.max(1, Number(options.concurrency || 2))
    const delayMs = Math.max(0, Number(options.delayMs || 0))
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
    const results = new Array(ids.length)
    let cursor = 0
    let completed = 0

    batchRunningRef.current = true
    setBatchRunning(true)

    async function worker () {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= ids.length) return
        const id = ids[index]

        if (delayMs > 0) {
          await sleep(delayMs)
        }

        try {
          const value = await runSingle(id, task)
          results[index] = { id, ok: true, value }
        } catch (error) {
          results[index] = { id, ok: false, error }
        } finally {
          completed += 1
          if (onProgress) {
            onProgress({
              id,
              index,
              completed,
              total: ids.length
            })
          }
        }
      }
    }

    try {
      const workers = Array.from({ length: Math.min(concurrency, ids.length) }, () => worker())
      await Promise.all(workers)
      return {
        skipped: false,
        results
      }
    } finally {
      batchRunningRef.current = false
      setBatchRunning(false)
    }
  }, [runSingle])

  const isRunningId = useCallback((accountId) => {
    const id = String(accountId || '').trim()
    return runningIds.has(id)
  }, [runningIds])

  return {
    runningIds,
    batchRunning,
    isRunningId,
    runSingle,
    runBatch
  }
}
