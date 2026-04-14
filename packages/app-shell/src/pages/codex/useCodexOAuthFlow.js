import { useEffect, useState } from 'react'
import { readPendingOAuthSession, writePendingOAuthSession, clearPendingOAuthSession } from '../../utils/oauth'
import { copyText } from '../../utils/hostBridge.js'
import { useTaskPolling } from '../../runtime/useTaskPolling.js'

export function useCodexOAuthFlow ({
  svc,
  toast,
  onRecovered,
  onCompleted
}) {
  const [oauthSessionId, setOauthSessionId] = useState('')
  const [oauthAuthUrl, setOauthAuthUrl] = useState('')
  const [oauthRedirectUri, setOauthRedirectUri] = useState('')
  const [oauthCallbackInput, setOauthCallbackInput] = useState('')
  const [oauthPreparing, setOauthPreparing] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthPrepareError, setOauthPrepareError] = useState('')
  const [oauthUrlCopied, setOauthUrlCopied] = useState(false)
  const [oauthRecovered, setOauthRecovered] = useState(false)
  const [pollingSessionId, setPollingSessionId] = useState('')

  const {
    isPolling: oauthPolling,
    start: startOAuthPollingTask,
    stop: stopOAuthPollingTask
  } = useTaskPolling(async () => {
    const sid = String(pollingSessionId || '').trim()
    if (!sid || !svc || typeof svc.getOAuthSessionStatus !== 'function') return
    const status = await Promise.resolve(svc.getOAuthSessionStatus(sid))
    
    // 避免幽灵轮询覆盖新会话状态
    const pending = readPendingOAuthSession('codex')
    if (pending && pending.sessionId && pending.sessionId !== sid) {
      return
    }

    if (!status || !status.success) {
      if (status && status.status === 'missing') {
        stopOAuthPolling()
      }
      return
    }
    if (status.status === 'processing') {
      setOauthBusy(true)
      setOauthPrepareError('')
      return
    }
    if (status.status === 'failed') {
      stopOAuthPolling()
      setOauthBusy(false)
      setOauthPrepareError(status.error || '自动处理 OAuth 回调失败，请手动提交回调地址重试')
      return
    }
    setOauthBusy(false)
    if (status.status === 'completed') {
      stopOAuthPolling()
      await completeOAuthBySession(sid, '', 'auto')
    }
  }, 1200)

  function stopOAuthPolling () {
    stopOAuthPollingTask()
    setPollingSessionId('')
  }

  function startOAuthPolling (sessionId) {
    const sid = String(sessionId || '').trim()
    if (!sid || !svc || typeof svc.getOAuthSessionStatus !== 'function') return
    setPollingSessionId(sid)
    startOAuthPollingTask()
  }

  async function restorePendingOAuthSession () {
    const pending = readPendingOAuthSession('codex')
    if (!pending || typeof pending !== 'object') return false
    if (!pending.sessionId || !pending.authUrl) {
      clearPendingOAuthSession('codex')
      return false
    }

    const createdAt = typeof pending.createdAt === 'number' ? pending.createdAt : 0
    if (createdAt && Date.now() - createdAt > 10 * 60 * 1000) {
      clearPendingOAuthSession('codex')
      return false
    }

    const sid = String(pending.sessionId || '').trim()
    if (!sid) {
      clearPendingOAuthSession('codex')
      return false
    }

    if (svc && typeof svc.getOAuthSessionStatus === 'function') {
      try {
        const status = await Promise.resolve(svc.getOAuthSessionStatus(sid))
        if (!status || !status.success) {
          clearPendingOAuthSession('codex')
          return false
        }
      } catch {
        clearPendingOAuthSession('codex')
        return false
      }
    }

    setOauthSessionId(sid)
    setOauthAuthUrl(pending.authUrl || '')
    setOauthRedirectUri(pending.redirectUri || '')
    setOauthPrepareError('')
    setOauthRecovered(true)
    // 恢复会话时不自动开始轮询，等待用户点击"开始授权"
    onRecovered?.()
    return true
  }

  async function prepareOAuthSession () {
    stopOAuthPolling()
    if (!svc || typeof svc.prepareOAuthSession !== 'function') {
      setOauthPrepareError('当前版本不支持 OAuth 授权')
      return null
    }

    const startTime = Date.now()
    setOauthPreparing(true)
    setOauthPrepareError('')
    try {
      const result = await Promise.resolve(svc.prepareOAuthSession())
      if (!result || !result.success || !result.session) {
        const errMsg = (result && result.error) || '生成授权链接失败'
        setOauthPrepareError(errMsg)
        return null
      }

      const session = result.session
      setOauthSessionId(session.sessionId || '')
      setOauthAuthUrl(session.authUrl || '')
      setOauthRedirectUri(session.redirectUri || '')
      setOauthCallbackInput('')
      setOauthUrlCopied(false)
      setOauthRecovered(false)
      // 准备阶段不启动轮询，等待用户点击"开始授权"
      writePendingOAuthSession('codex', {
        sessionId: session.sessionId || '',
        authUrl: session.authUrl || '',
        redirectUri: session.redirectUri || '',
        createdAt: Date.now()
      })
      if (result.warning) {
        setOauthPrepareError(result.warning)
      }
      return session
    } catch (e) {
      const msg = e?.message || String(e)
      setOauthPrepareError(msg)
      return null
    } finally {
      // 样式优化：确保加载状态至少持续 2 秒，避免处理太快导致的视觉闪烁
      const elapsed = Date.now() - startTime
      if (elapsed < 2000) {
        await new Promise(resolve => setTimeout(resolve, 2000 - elapsed))
      }
      setOauthPreparing(false)
    }
  }

  async function handleCopyOAuthUrl () {
    if (!oauthAuthUrl) return false
    const ok = await copyText(oauthAuthUrl)
    if (!ok) {
      toast?.warning?.('复制失败，请手动复制')
      return false
    }
    setOauthUrlCopied(true)
    toast?.success?.('授权链接已复制')
    setTimeout(() => {
      setOauthUrlCopied(false)
    }, 2000)
    return true
  }

  async function handleOpenOAuthInBrowser () {
    let authUrl = oauthAuthUrl
    let sid = oauthSessionId

    if (sid && svc && typeof svc.getOAuthSessionStatus === 'function') {
      try {
        const status = await Promise.resolve(svc.getOAuthSessionStatus(sid))
        if (!status || !status.success || status.status === 'missing') {
          clearPendingOAuthSession('codex')
          stopOAuthPolling()
          setOauthSessionId('')
          setOauthAuthUrl('')
          setOauthRedirectUri('')
          setOauthBusy(false)
          setOauthRecovered(false)
          const prepared = await prepareOAuthSession()
          authUrl = prepared?.authUrl || ''
          sid = prepared?.sessionId || ''
        } else if (status.status === 'completed') {
          await completeOAuthBySession(sid, '', 'auto')
          return
        } else if (status.status === 'processing') {
          setOauthBusy(true)
          startOAuthPolling(sid)
          return
        } else if (status.status === 'failed') {
          setOauthBusy(false)
          setOauthPrepareError(status.error || '自动处理 OAuth 回调失败，请手动提交回调地址重试')
          startOAuthPolling(sid)
          return
        }
        // 其他状态（ready）不自动开始轮询，等待用户操作
      } catch {
        clearPendingOAuthSession('codex')
        stopOAuthPolling()
        setOauthSessionId('')
        setOauthAuthUrl('')
        setOauthRedirectUri('')
        setOauthBusy(false)
        setOauthRecovered(false)
        const prepared = await prepareOAuthSession()
        authUrl = prepared?.authUrl || ''
        sid = prepared?.sessionId || ''
      }
    }

    if (!authUrl) {
      const prepared = await prepareOAuthSession()
      authUrl = prepared?.authUrl || ''
      sid = prepared?.sessionId || sid
    }

    if (!authUrl) {
      toast?.error?.(oauthPrepareError || '授权链接未就绪')
      return
    }

    if (!svc || typeof svc.openExternalUrl !== 'function') {
      const copied = await copyText(authUrl)
      if (copied) {
        toast?.info?.('当前环境不支持自动打开，已复制链接')
      } else {
        toast?.warning?.('当前环境不支持自动打开，请手动复制')
      }
      return
    }

    const opened = await Promise.resolve(svc.openExternalUrl(authUrl))
    if (!opened || !opened.success) {
      const copied = await copyText(authUrl)
      if (copied) {
        toast?.warning?.((opened && opened.error) ? opened.error + '，已复制授权链接' : '打开浏览器失败，已复制授权链接')
      } else {
        toast?.error?.((opened && opened.error) || '打开浏览器失败')
      }
      return
    }

    // 用户点击"开始授权"后才启动轮询
    if (sid) startOAuthPolling(sid)
    toast?.success?.('已在浏览器打开 Codex OAuth 页面')
  }

  async function handleCancelOAuthInBrowser () {
    const sid = String(oauthSessionId || '').trim()
    if (!sid || !svc || typeof svc.cancelOAuthSession !== 'function') {
      toast?.warning?.('OAuth 会话不存在')
      return false
    }

    try {
      const result = await svc.cancelOAuthSession(sid)
      if (!result || !result.success) {
        toast?.error?.((result && result.error) || '取消授权失败')
        return false
      }

      stopOAuthPolling()
      clearPendingOAuthSession('codex')
      setOauthSessionId('')
      setOauthAuthUrl('')
      setOauthRedirectUri('')
      setOauthBusy(false)
      setOauthRecovered(false)
      setOauthPrepareError('')
      
      toast?.success?.('已取消授权会话')
      return true
    } catch (e) {
      toast?.error?.('取消授权失败：' + (e?.message || String(e)))
      return false
    }
  }

  async function completeOAuthBySession (sessionId, callbackUrl, source = 'manual') {
    const sid = String(sessionId || '').trim()
    const callback = String(callbackUrl || '').trim()

    if (!sid) {
      if (source === 'manual') toast?.warning?.('授权会话不存在，请先生成授权链接')
      return false
    }
    if (!callback && source === 'manual') {
      toast?.warning?.('请粘贴完整回调地址')
      return false
    }
    if (!svc || typeof svc.completeOAuthSession !== 'function') {
      toast?.error?.('当前版本不支持 OAuth 回调提交')
      return false
    }

    const startTime = Date.now()
    setOauthBusy(true)
    try {
      const result = await svc.completeOAuthSession(sid, callback)
      if (!result || !result.success || !result.account) {
        const err = (result && result.error) || 'OAuth 授权失败'
        if (err.includes('会话不存在') || err.includes('已过期')) {
          const pending = readPendingOAuthSession('codex')
          if (!pending || pending.sessionId === sid) {
            stopOAuthPolling()
            clearPendingOAuthSession('codex')
            setOauthSessionId('')
            setOauthRecovered(false)
          }
          if (source === 'auto') return false
        }
        if (source === 'auto') {
          setOauthPrepareError(err)
        } else {
          toast?.error?.(err)
        }
        return false
      }

      const elapsed = Date.now() - startTime
      if (source === 'auto' && elapsed < 1500) {
        await new Promise(resolve => setTimeout(resolve, 1500 - elapsed))
      }

      const account = result.account
      stopOAuthPolling()
      clearPendingOAuthSession('codex')
      setOauthRecovered(false)
      onCompleted?.(account, result)
      return true
    } catch (e) {
      const message = 'OAuth 授权失败: ' + (e?.message || String(e))
      if (source === 'auto') {
        setOauthPrepareError(message)
      } else {
        toast?.error?.(message)
      }
      return false
    } finally {
      setOauthBusy(false)
    }
  }

  async function handleSubmitOAuthCallback () {
    await completeOAuthBySession(oauthSessionId, oauthCallbackInput.trim(), 'manual')
  }

  async function ensureOAuthReady () {
    await restorePendingOAuthSession()
  }

  async function reconcileOAuthSession () {
    const sid = String(oauthSessionId || '').trim()
    if (!sid || !svc || typeof svc.getOAuthSessionStatus !== 'function') return false

    try {
      const status = await Promise.resolve(svc.getOAuthSessionStatus(sid))
      if (!status || !status.success) {
        if (status && status.status === 'missing') {
          stopOAuthPolling()
          clearPendingOAuthSession('codex')
          setOauthSessionId('')
          setOauthAuthUrl('')
          setOauthRedirectUri('')
          setOauthBusy(false)
          setOauthRecovered(false)
          setOauthPrepareError((status && status.error) || 'OAuth 会话不存在或已过期，请重新生成授权链接')
        }
        return false
      }

      if (status.status === 'processing') {
        setOauthBusy(true)
        setOauthPrepareError('')
        // 不自动启动轮询，等待用户点击"开始授权"
        return true
      }

      if (status.status === 'failed') {
        stopOAuthPolling()
        setOauthBusy(false)
        setOauthPrepareError(status.error || '自动处理 OAuth 回调失败，请手动提交回调地址重试')
        return false
      }

      setOauthBusy(false)

      if (status.status === 'completed') {
        await completeOAuthBySession(sid, '', 'auto')
        return true
      }

      // 其他状态（ready）不自动开始轮询，等待用户操作
      return true
    } catch (e) {
      setOauthPrepareError(e?.message || String(e))
      return false
    }
  }

  function resetOAuthFlow () {
    if (oauthSessionId && svc && typeof svc.cancelOAuthSession === 'function') {
      try {
        svc.cancelOAuthSession(oauthSessionId)
      } catch {}
    }
    stopOAuthPolling()
    clearPendingOAuthSession('codex')
    setOauthSessionId('')
    setOauthAuthUrl('')
    setOauthRedirectUri('')
    setOauthCallbackInput('')
    setOauthPrepareError('')
    setOauthUrlCopied(false)
    setOauthPreparing(false)
    setOauthBusy(false)
    setOauthRecovered(false)
  }

  useEffect(() => {
    return () => {
      // 组件卸载时清理 OAuth 会话
      resetOAuthFlow()
      stopOAuthPolling()
    }
  }, [])

  return {
    oauthSessionId,
    oauthAuthUrl,
    oauthRedirectUri,
    oauthCallbackInput,
    oauthPreparing,
    oauthBusy,
    oauthPrepareError,
    oauthUrlCopied,
    oauthRecovered,
    oauthPolling,
    setOauthCallbackInput,
    prepareOAuthSession,
    handleCopyOAuthUrl,
    handleOpenOAuthInBrowser,
    handleCancelOAuthInBrowser,
    handleSubmitOAuthCallback,
    ensureOAuthReady,
    reconcileOAuthSession,
    resetOAuthFlow
  }
}
