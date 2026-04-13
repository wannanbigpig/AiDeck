function createSettingsApi (sharedSettingsStore, hostSettingsStore, hostId) {
  return {
    getShared (key, fallback = null) {
      return sharedSettingsStore.readValue(key, fallback)
    },
    setShared (key, value) {
      return sharedSettingsStore.writeValue(key, value)
    },
    mergeShared (patch) {
      return sharedSettingsStore.merge(patch)
    },
    getHost (key, fallback = null) {
      return hostSettingsStore.readValue(hostId, key, fallback)
    },
    setHost (key, value) {
      return hostSettingsStore.writeValue(hostId, key, value)
    }
  }
}

function normalizeWarnings (result) {
  const warnings = []
  if (result && result.warning) warnings.push(String(result.warning))
  if (result && Array.isArray(result.warnings)) {
    for (let i = 0; i < result.warnings.length; i++) {
      const text = String(result.warnings[i] || '').trim()
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

function normalizePlatformService (platform, service) {
  if (!service || typeof service !== 'object') return service
  const normalized = Object.assign({}, service)

  if (typeof normalized.refreshQuotaOrUsage !== 'function') {
    if (typeof service.refreshQuota === 'function') {
      normalized.refreshQuotaOrUsage = function refreshQuotaOrUsage (accountId) {
        return service.refreshQuota(accountId)
      }
    } else if (String(platform || '').trim() === 'gemini' && typeof service.refreshToken === 'function') {
      normalized.refreshQuotaOrUsage = function refreshQuotaOrUsage (accountId) {
        return service.refreshToken(accountId)
      }
    }
  }

  if (typeof normalized.activateAccount !== 'function') {
    if (typeof service.switchAccount === 'function') {
      normalized.activateAccount = async function activateAccount (accountId, options) {
        const result = await Promise.resolve(service.switchAccount(accountId, options))
        return normalizeActivateResult(result, result && result.stage ? result.stage : 'switch')
      }
    } else if (String(platform || '').trim() === 'gemini' && typeof service.inject === 'function') {
      normalized.activateAccount = async function activateAccount (accountId, options) {
        const result = await Promise.resolve(service.inject(accountId, options))
        return normalizeActivateResult(result, 'inject')
      }
    }
  }

  return normalized
}

function createPlatformApi (services) {
  const normalizedServices = {}
  const platformIds = Object.keys(services)
  for (let i = 0; i < platformIds.length; i++) {
    const platformId = platformIds[i]
    normalizedServices[platformId] = normalizePlatformService(platformId, services[platformId])
  }

  const api = {
    listAccounts (platform) {
      return normalizedServices[platform] && typeof normalizedServices[platform].list === 'function'
        ? normalizedServices[platform].list()
        : []
    },
    getCurrentAccount (platform) {
      return normalizedServices[platform] && typeof normalizedServices[platform].getCurrent === 'function'
        ? normalizedServices[platform].getCurrent()
        : null
    },
    syncCurrentFromLocal (platform, options) {
      return normalizedServices[platform] && typeof normalizedServices[platform].syncCurrentFromLocal === 'function'
        ? normalizedServices[platform].syncCurrentFromLocal(options)
        : { success: false, error: 'unsupported' }
    },
    importFromLocal (platform) {
      return normalizedServices[platform] && typeof normalizedServices[platform].importFromLocal === 'function'
        ? normalizedServices[platform].importFromLocal()
        : { success: false, error: 'unsupported' }
    },
    importFromJson (platform, payload) {
      return normalizedServices[platform] && typeof normalizedServices[platform].importFromJson === 'function'
        ? normalizedServices[platform].importFromJson(payload)
        : { success: false, error: 'unsupported' }
    },
    prepareOAuthSession (platform, options) {
      return normalizedServices[platform] && typeof normalizedServices[platform].prepareOAuthSession === 'function'
        ? normalizedServices[platform].prepareOAuthSession(options && options.port)
        : { success: false, error: 'unsupported' }
    },
    completeOAuthSession (platform, sessionId, callbackUrl) {
      return normalizedServices[platform] && typeof normalizedServices[platform].completeOAuthSession === 'function'
        ? normalizedServices[platform].completeOAuthSession(sessionId, callbackUrl)
        : { success: false, error: 'unsupported' }
    },
    refreshQuota (platform, accountId) {
      return normalizedServices[platform] && typeof normalizedServices[platform].refreshQuota === 'function'
        ? normalizedServices[platform].refreshQuota(accountId)
        : { success: false, error: 'unsupported' }
    },
    switchAccount (platform, accountId, options) {
      return normalizedServices[platform] && typeof normalizedServices[platform].switchAccount === 'function'
        ? normalizedServices[platform].switchAccount(accountId, options)
        : { success: false, error: 'unsupported' }
    },
    exportAccounts (platform, ids) {
      return normalizedServices[platform] && typeof normalizedServices[platform].exportAccounts === 'function'
        ? normalizedServices[platform].exportAccounts(ids)
        : ''
    },
    updateTags (platform, accountId, tags) {
      return normalizedServices[platform] && typeof normalizedServices[platform].updateTags === 'function'
        ? normalizedServices[platform].updateTags(accountId, tags)
        : null
    }
  }

  for (let i = 0; i < platformIds.length; i++) {
    const platformId = platformIds[i]
    api[platformId] = normalizedServices[platformId]
  }

  return api
}

function createHostBridge (options) {
  const hostId = String(options && options.hostId ? options.hostId : 'default')
  const services = options && options.services && typeof options.services === 'object'
    ? options.services
    : {}
  const settings = createSettingsApi(options.sharedSettingsStore, options.hostSettingsStore, hostId)
  const platformApi = createPlatformApi(services)

  return {
    hostId,
    settings,
    platform: options.platform || {},
    host: options.host || {},
    plugin: options.plugin || {},
    storage: options.storage || {},
    logs: options.logs || {},
    platforms: platformApi,
    events: {
      subscribeLocalState: typeof options.subscribeLocalState === 'function'
        ? options.subscribeLocalState
        : function subscribeLocalState () { return function unsubscribe () {} },
      subscribeStorageRevision: typeof options.subscribeStorageRevision === 'function'
        ? options.subscribeStorageRevision
        : function subscribeStorageRevision () { return function unsubscribe () {} },
      subscribeLogs: options.logs && typeof options.logs.subscribe === 'function'
        ? options.logs.subscribe
        : function subscribeLogs () { return function unsubscribe () {} }
    }
  }
}

module.exports = {
  createHostBridge
}
