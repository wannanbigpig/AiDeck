const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function loadStores (rootDir) {
  process.env.AIDECK_DATA_DIR = rootDir
  const sharedPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'sharedSettingsStore.cjs')
  const hostPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'hostSettingsStore.cjs')
  const revisionPath = path.join(__dirname, '..', 'packages', 'infra-node', 'src', 'storageRevisionBus.cjs')

  delete require.cache[require.resolve(sharedPath)]
  delete require.cache[require.resolve(hostPath)]
  delete require.cache[require.resolve(revisionPath)]

  return {
    sharedSettingsStore: require(sharedPath),
    hostSettingsStore: require(hostPath),
    revisionBus: require(revisionPath)
  }
}

test('sharedSettingsStore 写入应持久化并触发一次 revision', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-shared-settings-'))
  const { sharedSettingsStore, revisionBus } = loadStores(rootDir)
  const before = revisionBus.getRevision()

  const saved = sharedSettingsStore.writeValue('aideck_global_settings', {
    requestLogEnabled: true
  })
  const after = revisionBus.getRevision()

  assert.equal(saved.aideck_global_settings.requestLogEnabled, true)
  assert.equal(after, before + 1)
  assert.equal(sharedSettingsStore.readValue('aideck_global_settings').requestLogEnabled, true)

  fs.rmSync(rootDir, { recursive: true, force: true })
})

test('hostSettingsStore 写入应与 shared settings 隔离', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-host-settings-'))
  const { sharedSettingsStore, hostSettingsStore, revisionBus } = loadStores(rootDir)
  const before = revisionBus.getRevision()

  hostSettingsStore.writeValue('desktop', 'sidebar_collapsed', true)
  const after = revisionBus.getRevision()

  assert.equal(after, before)
  assert.equal(hostSettingsStore.readValue('desktop', 'sidebar_collapsed', false), true)
  assert.equal(sharedSettingsStore.readValue('sidebar_collapsed', null), null)

  fs.rmSync(rootDir, { recursive: true, force: true })
})
