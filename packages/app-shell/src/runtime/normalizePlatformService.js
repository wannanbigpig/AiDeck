function normalizeWarnings (result) {
  const warnings = []
  if (result?.warning) warnings.push(String(result.warning))
  if (Array.isArray(result?.warnings)) {
    for (const item of result.warnings) {
      const text = String(item || '').trim()
      if (text) warnings.push(text)
    }
  }
  return warnings
}

function normalizeActivateResult (result, stage) {
  if (result && typeof result === 'object' && typeof result.success === 'boolean') {
    return {
      success: !!result.success,
      error: result.error || null,
      warnings: normalizeWarnings(result),
      stage: result.stage || stage || '',
      changed: typeof result.changed === 'boolean' ? result.changed : !!result.success
    }
  }

  return {
    success: !!result,
    error: result ? null : '激活失败',
    warnings: [],
    stage: stage || '',
    changed: !!result
  }
}

export function normalizePlatformService (platform, svc) {
  if (!svc || typeof svc !== 'object') return svc

  const normalized = Object.assign({}, svc)

  if (typeof normalized.refreshQuotaOrUsage !== 'function') {
    if (typeof svc.refreshQuota === 'function') {
      normalized.refreshQuotaOrUsage = function refreshQuotaOrUsage (accountId) {
        return svc.refreshQuota(accountId)
      }
    } else if (String(platform || '').trim() === 'gemini' && typeof svc.refreshToken === 'function') {
      normalized.refreshQuotaOrUsage = function refreshQuotaOrUsage (accountId) {
        return svc.refreshToken(accountId)
      }
    }
  }

  if (typeof normalized.activateAccount !== 'function') {
    if (typeof svc.switchAccount === 'function') {
      normalized.activateAccount = async function activateAccount (accountId, options) {
        const result = await Promise.resolve(svc.switchAccount(accountId, options))
        return normalizeActivateResult(result, result?.stage || 'switch')
      }
    } else if (String(platform || '').trim() === 'gemini' && typeof svc.inject === 'function') {
      normalized.activateAccount = async function activateAccount (accountId, options) {
        const result = await Promise.resolve(svc.inject(accountId, options))
        return normalizeActivateResult(result, 'inject')
      }
    }
  }

  return normalized
}
