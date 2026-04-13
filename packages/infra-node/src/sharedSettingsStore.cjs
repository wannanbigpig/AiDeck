const dataRoot = require('./dataRoot.cjs')
const revisionBus = require('./storageRevisionBus.cjs')
const fileUtils = require('./fileUtils.cjs')
const { createFileStorageDriver } = require('./storage-drivers/fileStorageDriver.cjs')
const { createSharedSettingsRepository } = require('./repositories/settingsRepository.cjs')

const storageDriver = createFileStorageDriver({
  fileUtils,
  dataRoot,
  onCommit: (reason, detail) => revisionBus.touchRevision(reason, detail)
})

module.exports = createSharedSettingsRepository({
  storageDriver,
  dataRoot
})
