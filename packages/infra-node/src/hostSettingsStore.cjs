const dataRoot = require('./dataRoot.cjs')
const fileUtils = require('./fileUtils.cjs')
const { createFileStorageDriver } = require('./storage-drivers/fileStorageDriver.cjs')
const { createHostSettingsRepository } = require('./repositories/settingsRepository.cjs')

const storageDriver = createFileStorageDriver({
  fileUtils,
  dataRoot
})

module.exports = createHostSettingsRepository({
  storageDriver,
  dataRoot
})
