const path = require('node:path')

function createSqliteStorageDriver ({ dataRoot } = {}) {
  function getDatabasePath () {
    if (!dataRoot || typeof dataRoot.getMetaDir !== 'function') return ''
    return path.join(dataRoot.getMetaDir(), 'aideck.db')
  }

  function unsupported () {
    throw new Error('SqliteStorageDriver 尚未接入运行时')
  }

  return {
    kind: 'sqlite',
    isSupported: false,
    getDatabasePath,
    ensureDir: unsupported,
    fileExists: unsupported,
    readJson: unsupported,
    writeJson: unsupported,
    readText: unsupported,
    writeText: unsupported,
    deleteFile: unsupported,
    listFiles: unsupported,
    withLock: unsupported,
    batch: unsupported
  }
}

module.exports = {
  createSqliteStorageDriver
}
