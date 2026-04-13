import { useEffect } from 'react'
import { useTaskPolling } from './useTaskPolling.js'
import {
  usePlatformTokenAutoRefresh,
  shouldEnableStandaloneTokenAutoRefresh
} from './usePlatformTokenAutoRefresh.js'

export function usePlatformAutoRefresh (options = {}) {
  const {
    platform,
    svc,
    accounts,
    refreshSnapshot,
    autoRefreshMinutes,
    onRefreshAll
  } = options

  const standaloneTokenAutoRefreshEnabled = shouldEnableStandaloneTokenAutoRefresh(autoRefreshMinutes)

  usePlatformTokenAutoRefresh({
    enabled: standaloneTokenAutoRefreshEnabled,
    platform,
    svc,
    accounts,
    refreshSnapshot
  })

  const {
    start: startAutoRefreshTask,
    stop: stopAutoRefreshTask
  } = useTaskPolling(async () => {
    await onRefreshAll?.({ silent: true, source: 'auto-refresh' })
  }, Math.max(1, Number(autoRefreshMinutes || 0)) * 60 * 1000)

  useEffect(() => {
    const minutes = Number(autoRefreshMinutes)
    if (!minutes || minutes <= 0) {
      stopAutoRefreshTask()
      return
    }
    startAutoRefreshTask()
    return () => stopAutoRefreshTask()
  }, [autoRefreshMinutes, startAutoRefreshTask, stopAutoRefreshTask])

  return {
    standaloneTokenAutoRefreshEnabled
  }
}
