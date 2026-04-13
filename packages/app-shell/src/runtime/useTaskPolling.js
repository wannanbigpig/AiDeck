import { useCallback, useEffect, useRef, useState } from 'react'

export function useTaskPolling (task, intervalMs = 1200) {
  const taskRef = useRef(task)
  const timerRef = useRef(null)
  const runningRef = useRef(false)
  const activeRef = useRef(false)
  const [isPolling, setIsPolling] = useState(false)

  useEffect(() => {
    taskRef.current = task
  }, [task])

  const stop = useCallback(() => {
    activeRef.current = false
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setIsPolling(false)
  }, [])

  const scheduleNext = useCallback(() => {
    if (!activeRef.current) return
    timerRef.current = setTimeout(async () => {
      if (!activeRef.current) return
      if (runningRef.current) {
        scheduleNext()
        return
      }
      runningRef.current = true
      try {
        await Promise.resolve(taskRef.current?.())
      } finally {
        runningRef.current = false
        scheduleNext()
      }
    }, Math.max(0, Number(intervalMs || 0)))
  }, [intervalMs])

  const start = useCallback(() => {
    stop()
    activeRef.current = true
    setIsPolling(true)
    scheduleNext()
  }, [scheduleNext, stop])

  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return {
    isPolling,
    start,
    stop
  }
}
