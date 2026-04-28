import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  forceRefreshAnnouncements,
  getAnnouncementState,
  markAllAnnouncementsAsRead,
  markAnnouncementAsRead
} from '../utils/hostBridge.js'

export const APP_VERSION = '1.0.3'

const EMPTY_STATE = {
  announcements: [],
  unreadIds: [],
  popupAnnouncement: null
}

function resolveAnnouncementOptions () {
  const locale = typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : 'zh-CN'
  return {
    version: APP_VERSION,
    locale
  }
}

export function useAnnouncements () {
  const [state, setState] = useState(EMPTY_STATE)
  const [loading, setLoading] = useState(false)
  const options = useMemo(() => resolveAnnouncementOptions(), [])

  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const next = force
        ? await forceRefreshAnnouncements(options)
        : await getAnnouncementState(options)
      setState(next || EMPTY_STATE)
      return next || EMPTY_STATE
    } catch (err) {
      setState(EMPTY_STATE)
      return EMPTY_STATE
    } finally {
      setLoading(false)
    }
  }, [options])

  const markAsRead = useCallback(async (id) => {
    await markAnnouncementAsRead(id)
    return await refresh(false)
  }, [refresh])

  const markAllAsRead = useCallback(async () => {
    await markAllAnnouncementsAsRead(options)
    return await refresh(false)
  }, [options, refresh])

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  return {
    state,
    loading,
    refresh,
    markAsRead,
    markAllAsRead
  }
}
