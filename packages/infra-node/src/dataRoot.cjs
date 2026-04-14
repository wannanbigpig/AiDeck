const path = require('path')
const fileUtils = require('./fileUtils.cjs')

const DATA_ROOT_NAME = '.ai_deck'

function resolveDataRootDir () {
  const override = String(process.env.AIDECK_DATA_DIR || '').trim()
  if (override) {
    return path.resolve(override)
  }
  return path.join(fileUtils.getHomeDir(), DATA_ROOT_NAME)
}

function getMetaDir () {
  return path.join(resolveDataRootDir(), 'meta')
}

function getAccountsRootDir () {
  return path.join(resolveDataRootDir(), 'accounts')
}

function getSettingsDir () {
  return path.join(resolveDataRootDir(), 'settings')
}

function getHostSettingsDir () {
  return path.join(getSettingsDir(), 'hosts')
}

function getLogsDir () {
  return path.join(resolveDataRootDir(), 'logs')
}

function getSyncDir () {
  return path.join(resolveDataRootDir(), 'sync')
}

function getCacheDir () {
  return path.join(resolveDataRootDir(), 'cache')
}

function ensureDataRootLayout () {
  const root = resolveDataRootDir()
  fileUtils.ensureDir(root)
  fileUtils.ensureDir(getMetaDir())
  fileUtils.ensureDir(getAccountsRootDir())
  fileUtils.ensureDir(getSettingsDir())
  fileUtils.ensureDir(getHostSettingsDir())
  fileUtils.ensureDir(getLogsDir())
  fileUtils.ensureDir(getSyncDir())
  fileUtils.ensureDir(getCacheDir())
  return root
}

module.exports = {
  DATA_ROOT_NAME,
  resolveDataRootDir,
  ensureDataRootLayout,
  getMetaDir,
  getAccountsRootDir,
  getSettingsDir,
  getHostSettingsDir,
  getLogsDir,
  getSyncDir,
  getCacheDir
}
