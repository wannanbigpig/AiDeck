const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function loadInfraModules (rootDir) {
  process.env.AIDECK_DATA_DIR = rootDir
  const fileUtilsPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'fileUtils.cjs')
  const dataRootPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'dataRoot.cjs')
  const revisionBusPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'storageRevisionBus.cjs')
  const driverIndexPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'storage-drivers', 'index.cjs')

  delete require.cache[require.resolve(fileUtilsPath)]
  delete require.cache[require.resolve(dataRootPath)]
  delete require.cache[require.resolve(revisionBusPath)]
  delete require.cache[require.resolve(driverIndexPath)]

  return {
    fileUtils: require(fileUtilsPath),
    dataRoot: require(dataRootPath),
    revisionBus: require(revisionBusPath),
    drivers: require(driverIndexPath)
  }
}

test('FileStorageDriver 契约：批次写入后应只触发一次 revision', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-driver-'))
  const { fileUtils, dataRoot, revisionBus, drivers } = loadInfraModules(rootDir)
  const driver = drivers.createFileStorageDriver({
    fileUtils,
    dataRoot,
    onCommit: (reason, detail) => revisionBus.touchRevision(reason, detail)
  })

  dataRoot.ensureDataRootLayout()
  const before = revisionBus.getRevision()
  const samplePath = path.join(rootDir, 'settings', 'shared.json')
  const metaPath = path.join(rootDir, 'meta', 'sample.json')

  driver.batch({
    reason: 'driver-contract',
    detail: { platform: 'codex' }
  }, (tx) => {
    tx.writeJson(samplePath, { ok: true })
    tx.writeJson(metaPath, { count: 2 })
  })

  const after = revisionBus.getRevision()
  assert.equal(after, before + 1)
  assert.deepEqual(driver.readJson(samplePath), { ok: true })
  assert.deepEqual(driver.readJson(metaPath), { count: 2 })
  assert.equal(fs.existsSync(driver.getLockFilePath()), false)

  fs.rmSync(rootDir, { recursive: true, force: true })
})

test('FileStorageDriver 应能回收过期锁文件', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-driver-lock-'))
  const { fileUtils, dataRoot, drivers } = loadInfraModules(rootDir)
  const driver = drivers.createFileStorageDriver({
    fileUtils,
    dataRoot,
    lockRetryLimit: 1
  })

  dataRoot.ensureDataRootLayout()
  fileUtils.writeJsonFile(driver.getLockFilePath(), {
    pid: 99999,
    acquired_at: Date.now() - 10000,
    expires_at: Date.now() - 5000
  })

  const targetPath = path.join(rootDir, 'cache', 'lock-recovered.json')
  driver.batch({ reason: 'recover-lock' }, (tx) => {
    tx.writeJson(targetPath, { recovered: true })
  })

  assert.deepEqual(driver.readJson(targetPath), { recovered: true })
  assert.equal(fs.existsSync(driver.getLockFilePath()), false)

  fs.rmSync(rootDir, { recursive: true, force: true })
})

test('SqliteStorageDriver 仅暴露占位骨架，不接入运行时', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-sqlite-driver-'))
  const { dataRoot, drivers } = loadInfraModules(rootDir)
  const driver = drivers.createSqliteStorageDriver({ dataRoot })

  assert.equal(driver.kind, 'sqlite')
  assert.equal(driver.isSupported, false)
  assert.equal(driver.getDatabasePath(), path.join(rootDir, 'meta', 'aideck.db'))
  assert.throws(() => driver.batch({}, () => {}), /尚未接入运行时/)

  fs.rmSync(rootDir, { recursive: true, force: true })
})
