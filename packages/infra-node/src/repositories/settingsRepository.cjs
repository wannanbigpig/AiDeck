function normalizeKey (key) {
  return String(key || '').trim()
}

function createSharedSettingsRepository ({
  storageDriver,
  dataRoot
}) {
  function filePath () {
    dataRoot.ensureDataRootLayout()
    return require('path').join(dataRoot.getSettingsDir(), 'shared.json')
  }

  function readAll () {
    return storageDriver.readJson(filePath()) || {}
  }

  function readValue (key, fallback = null) {
    const all = readAll()
    const normalizedKey = normalizeKey(key)
    if (!normalizedKey) return all
    return Object.prototype.hasOwnProperty.call(all, normalizedKey) ? all[normalizedKey] : fallback
  }

  function writeValue (key, value) {
    const normalizedKey = normalizeKey(key)
    let next = {}
    storageDriver.batch({
      reason: 'shared-settings',
      detail: { key: normalizedKey }
    }, (tx) => {
      next = tx.readJson(filePath()) || {}
      next[normalizedKey] = value
      tx.writeJson(filePath(), next)
    })
    return next
  }

  function merge (patch) {
    let next = {}
    storageDriver.batch({
      reason: 'shared-settings-merge'
    }, (tx) => {
      next = Object.assign({}, tx.readJson(filePath()) || {}, patch && typeof patch === 'object' ? patch : {})
      tx.writeJson(filePath(), next)
    })
    return next
  }

  return {
    readAll,
    readValue,
    writeValue,
    merge
  }
}

function createHostSettingsRepository ({
  storageDriver,
  dataRoot
}) {
  function normalizeHostId (hostId) {
    const text = String(hostId || 'default').trim().toLowerCase()
    return text || 'default'
  }

  function filePath (hostId) {
    dataRoot.ensureDataRootLayout()
    return require('path').join(dataRoot.getHostSettingsDir(), normalizeHostId(hostId) + '.json')
  }

  function readAll (hostId) {
    return storageDriver.readJson(filePath(hostId)) || {}
  }

  function readValue (hostId, key, fallback = null) {
    const all = readAll(hostId)
    const normalizedKey = normalizeKey(key)
    if (!normalizedKey) return all
    return Object.prototype.hasOwnProperty.call(all, normalizedKey) ? all[normalizedKey] : fallback
  }

  function writeValue (hostId, key, value) {
    const normalizedKey = normalizeKey(key)
    let next = {}
    storageDriver.batch({
      skipCommit: true
    }, (tx) => {
      next = tx.readJson(filePath(hostId)) || {}
      next[normalizedKey] = value
      tx.writeJson(filePath(hostId), next)
    })
    return next
  }

  return {
    readAll,
    readValue,
    writeValue
  }
}

module.exports = {
  createSharedSettingsRepository,
  createHostSettingsRepository
}
