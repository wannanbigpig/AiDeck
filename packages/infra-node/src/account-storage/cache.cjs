function createAccountCache () {
  const listCache = new Map()

  function cloneValue (value) {
    return JSON.parse(JSON.stringify(value))
  }

  function invalidatePlatformCache (platform) {
    if (platform) listCache.delete(platform)
  }

  function getCachedList (platform, revision) {
    const cached = listCache.get(platform)
    if (!cached || cached.revision !== revision) return null
    return cloneValue(cached.accounts)
  }

  function setCachedList (platform, revision, accounts) {
    listCache.set(platform, {
      revision,
      accounts: cloneValue(accounts)
    })
  }

  return {
    cloneValue,
    invalidatePlatformCache,
    getCachedList,
    setCachedList
  }
}

module.exports = {
  createAccountCache
}
