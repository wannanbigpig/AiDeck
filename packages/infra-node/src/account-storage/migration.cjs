const fs = require('node:fs')
const path = require('node:path')

function createMigrationHelpers ({
  fileUtils,
  dataRoot,
  revisionBus,
  supportedPlatforms,
  dataSchemaVersion,
  indexFile,
  currentFile,
  accountsDirName,
  oauthPendingDirName,
  metaFile,
  nowMs,
  ensureMetaFile
}) {
  function assertPlatform (platform) {
    if (!supportedPlatforms.includes(platform)) {
      throw new Error('不支持的平台: ' + platform)
    }
  }

  function getLegacyPlatformDirPath (platform) {
    return path.join(dataRoot.resolveDataRootDir(), platform)
  }

  function platformDirPath (platform) {
    assertPlatform(platform)
    return path.join(dataRoot.getAccountsRootDir(), platform)
  }

  function indexPath (platform) {
    return path.join(platformDirPath(platform), indexFile)
  }

  function currentPath (platform) {
    return path.join(platformDirPath(platform), currentFile)
  }

  function accountsDir (platform) {
    return path.join(platformDirPath(platform), accountsDirName)
  }

  function oauthPendingDir (platform) {
    return path.join(platformDirPath(platform), oauthPendingDirName)
  }

  function copyDirRecursive (fromDir, toDir) {
    if (!fileUtils.dirExists(fromDir)) return
    if (typeof fs.cpSync === 'function') {
      fs.cpSync(fromDir, toDir, { recursive: true, force: true })
      return
    }
    fileUtils.ensureDir(toDir)
    const names = fs.readdirSync(fromDir)
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      const fromPath = path.join(fromDir, name)
      const toPath = path.join(toDir, name)
      const stat = fs.statSync(fromPath)
      if (stat.isDirectory()) {
        copyDirRecursive(fromPath, toPath)
      } else {
        fs.copyFileSync(fromPath, toPath)
      }
    }
  }

  function migrateLegacyLayout () {
    const root = dataRoot.ensureDataRootLayout()
    const legacyMetaPath = path.join(root, metaFile)
    const nextMetaPath = path.join(dataRoot.getMetaDir(), metaFile)
    if (fileUtils.fileExists(legacyMetaPath) && !fileUtils.fileExists(nextMetaPath)) {
      const meta = fileUtils.readJsonFile(legacyMetaPath)
      if (meta) fileUtils.writeJsonFile(nextMetaPath, meta)
    }

    for (let i = 0; i < supportedPlatforms.length; i++) {
      const platform = supportedPlatforms[i]
      const legacyDir = getLegacyPlatformDirPath(platform)
      const nextDir = platformDirPath(platform)
      if (!fileUtils.dirExists(legacyDir)) continue
      if (!fileUtils.dirExists(nextDir) || fileUtils.listFiles(nextDir).length === 0) {
        fileUtils.ensureDir(nextDir)
        copyDirRecursive(legacyDir, nextDir)
      }
    }
  }

  function ensureIndexFile (platform) {
    const nextPath = indexPath(platform)
    if (fileUtils.fileExists(nextPath)) return
    fileUtils.writeJsonFile(nextPath, {
      schema_version: dataSchemaVersion,
      updated_at: nowMs(),
      accounts: []
    })
  }

  function getDataRootDir () {
    const root = dataRoot.ensureDataRootLayout()
    migrateLegacyLayout()
    ensureMetaFile()
    return root
  }

  function getPlatformDataDir (platform) {
    const dir = platformDirPath(platform)
    fileUtils.ensureDir(dir)
    fileUtils.ensureDir(accountsDir(platform))
    fileUtils.ensureDir(oauthPendingDir(platform))
    ensureIndexFile(platform)
    return dir
  }

  function initStorage () {
    const root = getDataRootDir()
    for (let i = 0; i < supportedPlatforms.length; i++) {
      getPlatformDataDir(supportedPlatforms[i])
    }
    fileUtils.ensureDir(dataRoot.getSyncDir())
    fileUtils.ensureDir(dataRoot.getCacheDir())
    fileUtils.ensureDir(dataRoot.getLogsDir())
    revisionBus.getRevision()
    return { success: true, root }
  }

  return {
    assertPlatform,
    platformDirPath,
    indexPath,
    currentPath,
    accountsDir,
    oauthPendingDir,
    ensureIndexFile,
    getDataRootDir,
    getPlatformDataDir,
    getOAuthPendingDir: oauthPendingDir,
    initStorage
  }
}

module.exports = {
  createMigrationHelpers
}
