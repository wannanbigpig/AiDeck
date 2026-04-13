/**
 * accountStorage.js — Aideck 文件化账号存储层
 */

const fileUtils = require('./fileUtils.cjs')
const dataRoot = require('./dataRoot.cjs')
const revisionBus = require('./storageRevisionBus.cjs')
const sharedSettingsStore = require('./sharedSettingsStore.cjs')
const { createFileStorageDriver, createSqliteStorageDriver } = require('./storage-drivers/index.cjs')
const { createAccountCache } = require('./account-storage/cache.cjs')
const { createRevisionHelpers } = require('./account-storage/revision.cjs')
const { createMigrationHelpers } = require('./account-storage/migration.cjs')
const { createAccountRepository } = require('./repositories/accountRepository.cjs')
const { createSyncRepository } = require('./repositories/syncRepository.cjs')

const SUPPORTED_PLATFORMS = ['antigravity', 'codex', 'gemini']
const DATA_SCHEMA_VERSION = 1
const INDEX_FILE = 'accounts-index.json'
const CURRENT_FILE = 'current.json'
const ACCOUNTS_DIR = 'accounts'
const OAUTH_PENDING_DIR = 'oauth_pending'
const META_FILE = 'meta.json'

const SYNC_AAD = 'aideck-sync-v1'
const SYNC_SCHEMA_VERSION = 1
const DEFAULT_SCRYPT = {
  N: 16384,
  r: 8,
  p: 1,
  keyLen: 32,
  maxmem: 64 * 1024 * 1024
}

function nowMs () {
  return Date.now()
}

const cache = createAccountCache()
const revision = createRevisionHelpers({
  fileUtils,
  dataRoot,
  revisionBus,
  dataSchemaVersion: DATA_SCHEMA_VERSION,
  metaFile: META_FILE,
  nowMs
})

const migration = createMigrationHelpers({
  fileUtils,
  dataRoot,
  revisionBus,
  supportedPlatforms: SUPPORTED_PLATFORMS,
  dataSchemaVersion: DATA_SCHEMA_VERSION,
  indexFile: INDEX_FILE,
  currentFile: CURRENT_FILE,
  accountsDirName: ACCOUNTS_DIR,
  oauthPendingDirName: OAUTH_PENDING_DIR,
  metaFile: META_FILE,
  nowMs,
  ensureMetaFile: revision.ensureMetaFile
})

const fileStorageDriver = createFileStorageDriver({
  fileUtils,
  dataRoot,
  onCommit: (reason, detail) => revision.touchStorage(reason, detail)
})

const sqliteStorageDriver = createSqliteStorageDriver({ dataRoot })

const repository = createAccountRepository({
  fileUtils,
  revisionBus,
  dataSchemaVersion: DATA_SCHEMA_VERSION,
  nowMs,
  cache,
  storageDriver: fileStorageDriver,
  assertPlatform: migration.assertPlatform,
  indexPath: migration.indexPath,
  currentPath: migration.currentPath,
  accountsDir: migration.accountsDir,
  getOAuthPendingDir: migration.getOAuthPendingDir
})

function listAccounts (platform) {
  return repository.listAccounts(platform, migration.initStorage)
}

function getAccount (platform, accountId) {
  return repository.getAccount(platform, accountId, migration.initStorage)
}

function addAccount (platform, account, options) {
  return repository.addAccount(platform, account, options, migration.initStorage)
}

function addAccounts (platform, accounts) {
  return repository.addAccounts(platform, accounts, migration.initStorage)
}

function updateAccount (platform, accountId, updates) {
  return repository.updateAccount(platform, accountId, updates, migration.initStorage)
}

function deleteAccount (platform, accountId) {
  return repository.deleteAccount(platform, accountId, migration.initStorage)
}

function deleteAccounts (platform, accountIds) {
  return repository.deleteAccounts(platform, accountIds, migration.initStorage)
}

function getCurrentAccount (platform) {
  return repository.getCurrentAccount(platform, migration.initStorage)
}

function exportAccounts (platform, accountIds) {
  return repository.exportAccounts(platform, accountIds, migration.initStorage)
}

function getAccountCount (platform) {
  return repository.getAccountCount(platform, migration.initStorage)
}

const syncService = createSyncRepository({
  fileUtils,
  dataRoot,
  storageDriver: fileStorageDriver,
  sharedSettingsStore,
  supportedPlatforms: SUPPORTED_PLATFORMS,
  syncSchemaVersion: SYNC_SCHEMA_VERSION,
  syncAad: SYNC_AAD,
  defaultScrypt: DEFAULT_SCRYPT,
  nowMs,
  initStorage: migration.initStorage,
  listAccounts,
  getCurrentId: repository.getCurrentId,
  addAccounts,
  addAccount,
  getAccount,
  setCurrentId: repository.setCurrentId
})

module.exports = {
  initStorage: migration.initStorage,
  getDataRootDir: migration.getDataRootDir,
  getPlatformDataDir: migration.getPlatformDataDir,
  getOAuthPendingDir: migration.getOAuthPendingDir,
  getStorageDrivers: function () {
    return {
      file: fileStorageDriver,
      sqlite: sqliteStorageDriver
    }
  },
  repairIndex: repository.repairIndex,

  listAccounts,
  saveAccounts: repository.saveAccounts,
  getAccount,
  addAccount,
  addAccounts,
  updateAccount,
  deleteAccount,
  deleteAccounts,
  getCurrentId: repository.getCurrentId,
  setCurrentId: repository.setCurrentId,
  clearCurrentId: repository.clearCurrentId,
  getCurrentAccount,
  exportAccounts,
  getAccountCount,

  saveOAuthPending: repository.saveOAuthPending,
  getOAuthPending: repository.getOAuthPending,
  getLatestOAuthPending: repository.getLatestOAuthPending,
  clearOAuthPending: repository.clearOAuthPending,
  cleanupOAuthPending: repository.cleanupOAuthPending,

  buildEncryptedSyncPayload: syncService.buildEncryptedSyncPayload,
  applyEncryptedSyncPayload: syncService.applyEncryptedSyncPayload
}
