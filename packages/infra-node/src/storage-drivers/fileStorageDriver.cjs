const fs = require('node:fs')
const path = require('node:path')

function sleepMs (ms) {
  const timeout = Math.max(1, Number(ms || 0))
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeout)
}

function createFileStorageDriver ({
  fileUtils,
  dataRoot,
  onCommit = null,
  lockFileName = 'storage.lock.json',
  lockRetryDelayMs = 25,
  lockRetryLimit = 40,
  lockTtlMs = 5000
}) {
  function getLockFilePath () {
    dataRoot.ensureDataRootLayout()
    return path.join(dataRoot.getMetaDir(), lockFileName)
  }

  function createOps () {
    return {
      ensureDir (dirPath) {
        return fileUtils.ensureDir(dirPath)
      },
      fileExists (filePath) {
        return fileUtils.fileExists(filePath)
      },
      readJson (filePath) {
        return fileUtils.readJsonFile(filePath)
      },
      writeJson (filePath, value) {
        return fileUtils.writeJsonFile(filePath, value)
      },
      readText (filePath) {
        return fileUtils.readTextFile(filePath)
      },
      writeText (filePath, content) {
        return fileUtils.writeTextFile(filePath, content)
      },
      deleteFile (filePath) {
        return fileUtils.deleteFile(filePath)
      },
      listFiles (dirPath) {
        return fileUtils.listFiles(dirPath)
      }
    }
  }

  function tryAcquireLock () {
    const lockPath = getLockFilePath()
    const payload = {
      pid: process.pid,
      acquired_at: Date.now(),
      expires_at: Date.now() + lockTtlMs
    }
    try {
      const dir = path.dirname(lockPath)
      fileUtils.ensureDir(dir)
      const fd = fs.openSync(lockPath, 'wx')
      try {
        fs.writeFileSync(fd, JSON.stringify(payload, null, 2), 'utf8')
      } finally {
        fs.closeSync(fd)
      }
      return { acquired: true, lockPath }
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err
      const current = fileUtils.readJsonFile(lockPath)
      const expiresAt = Number(current && current.expires_at ? current.expires_at : 0)
      if (expiresAt > 0 && expiresAt < Date.now()) {
        fileUtils.deleteFile(lockPath)
      }
      return { acquired: false, lockPath }
    }
  }

  function withLock (callback) {
    let lockPath = ''
    for (let attempt = 0; attempt <= lockRetryLimit; attempt++) {
      const result = tryAcquireLock()
      lockPath = result.lockPath
      if (result.acquired) {
        try {
          return callback()
        } finally {
          if (lockPath) fileUtils.deleteFile(lockPath)
        }
      }
      if (attempt >= lockRetryLimit) {
        throw new Error('获取存储锁失败，请稍后重试')
      }
      sleepMs(lockRetryDelayMs)
    }
    throw new Error('获取存储锁失败')
  }

  function batch (options, callback) {
    const opts = options && typeof options === 'object' ? options : {}
    const reason = String(opts.reason || '').trim()
    return withLock(() => {
      const result = callback(createOps())
      if (!opts.skipCommit && typeof onCommit === 'function') {
        onCommit(reason || 'batch-update', opts.detail)
      }
      return result
    })
  }

  const ops = createOps()
  return Object.assign({
    kind: 'file',
    isSupported: true,
    getLockFilePath,
    withLock,
    batch
  }, ops)
}

module.exports = {
  createFileStorageDriver
}
