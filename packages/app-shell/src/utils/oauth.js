import { getPlatformService } from './hostBridge.js'

/**
 * 统一处理 OAuth 会话的读取、写入和清除
 * @param {string} platform - 平台名称 (codex, antigravity, gemini)
 */

export function readPendingOAuthSession(platform) {
  try {
    const svc = getPlatformService(platform)
    if (svc && typeof svc.getPendingOAuthSession === 'function') {
      const pending = svc.getPendingOAuthSession()
      if (pending && typeof pending === 'object') return pending
    }
  } catch (e) {
    console.error(`[OAuth] readPendingOAuthSession failed for ${platform}:`, e)
  }
  return null
}

export function writePendingOAuthSession(platform, payload) {
  try {
    const svc = getPlatformService(platform)
    if (svc && typeof svc.savePendingOAuthSession === 'function') {
      svc.savePendingOAuthSession(payload)
    }
  } catch (e) {
    console.error(`[OAuth] writePendingOAuthSession failed for ${platform}:`, e)
  }
}

export function clearPendingOAuthSession(platform) {
  try {
    const svc = getPlatformService(platform)
    if (svc && typeof svc.clearPendingOAuthSession === 'function') {
      svc.clearPendingOAuthSession()
    }
  } catch (e) {
    console.error(`[OAuth] clearPendingOAuthSession failed for ${platform}:`, e)
  }
}
