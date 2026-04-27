const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createHostBridge } = require(path.join(__dirname, '..', 'packages', 'core', 'src', 'createHostBridge.cjs'))

function createMemorySettingsStore () {
  const shared = new Map()
  const host = new Map()

  return {
    sharedSettingsStore: {
      readValue (key, fallback = null) {
        return shared.has(key) ? shared.get(key) : fallback
      },
      writeValue (key, value) {
        shared.set(key, value)
        return value
      },
      merge (patch) {
        const current = shared.get('merged') || {}
        const next = Object.assign({}, current, patch)
        shared.set('merged', next)
        return next
      }
    },
    hostSettingsStore: {
      readValue (hostId, key, fallback = null) {
        return host.has(`${hostId}:${key}`) ? host.get(`${hostId}:${key}`) : fallback
      },
      writeValue (hostId, key, value) {
        host.set(`${hostId}:${key}`, value)
        return value
      }
    }
  }
}

test('createHostBridge 应仅暴露约定命名空间并将平台实例挂到 platforms 下', () => {
  const { sharedSettingsStore, hostSettingsStore } = createMemorySettingsStore()
  const services = {
    codex: {
      list () { return [{ id: 'cx-1' }] },
      getCurrent () { return { id: 'cx-1' } },
      refreshQuota (id) { return { success: true, id } },
      switchAccount (id) { return { success: true, changed: true, stage: 'switch', id } }
    }
  }
  const logs = {
    subscribe (listener) {
      listener({ type: 'append', entry: { id: 1 } })
      return function unsubscribe () {}
    }
  }

  const bridge = createHostBridge({
    hostId: 'utools',
    services,
    host: { copyText: () => true },
    plugin: { onEnter: () => function unsubscribe () {} },
    storage: { getDataRootDir: () => '/tmp/.ai_deck' },
    logs,
    platform: { osType: 'darwin' },
    sharedSettingsStore,
    hostSettingsStore,
    subscribeLocalState: () => function unsubscribe () {},
    subscribeStorageRevision: () => function unsubscribe () {}
  })

  assert.equal(bridge.hostId, 'utools')
  assert.deepEqual(Object.keys(bridge).sort(), [
    'events',
    'host',
    'hostId',
    'logs',
    'platform',
    'platforms',
    'plugin',
    'settings',
    'storage'
  ])
  assert.equal(typeof bridge.services, 'undefined')
  assert.equal(typeof bridge.platforms.listAccounts, 'function')
  assert.equal(typeof bridge.platforms.codex.list, 'function')
  assert.equal(typeof bridge.platforms.codex.refreshQuotaOrUsage, 'function')
  assert.equal(typeof bridge.platforms.codex.activateAccount, 'function')
  assert.deepEqual(bridge.platforms.listAccounts('codex'), [{ id: 'cx-1' }])
  assert.deepEqual(bridge.platforms.getCurrentAccount('codex'), { id: 'cx-1' })
  assert.deepEqual(bridge.platforms.refreshQuota('codex', 'cx-1'), { success: true, id: 'cx-1' })
  assert.deepEqual(bridge.platforms.codex.refreshQuotaOrUsage('cx-1'), { success: true, id: 'cx-1' })
})

test('createHostBridge 应为平台实例补齐共享契约兼容入口', async () => {
  const { sharedSettingsStore, hostSettingsStore } = createMemorySettingsStore()
  const bridge = createHostBridge({
    hostId: 'utools',
    services: {
      gemini: {
        refreshToken (id) { return { success: true, id, from: 'refreshToken' } },
        inject (id) { return { success: true, error: null, id } }
      }
    },
    sharedSettingsStore,
    hostSettingsStore
  })

  assert.equal(typeof bridge.platforms.gemini.refreshQuotaOrUsage, 'function')
  assert.equal(typeof bridge.platforms.gemini.activateAccount, 'function')
  assert.deepEqual(bridge.platforms.gemini.refreshQuotaOrUsage('gm-1'), { success: true, id: 'gm-1', from: 'refreshToken' })

  const activated = await bridge.platforms.gemini.activateAccount('gm-1')
  assert.deepEqual(activated, {
    success: true,
    error: null,
    warnings: [],
    stage: 'inject',
    changed: true
  })
})

test('createHostBridge 应正确读写 shared settings 和 host settings', () => {
  const { sharedSettingsStore, hostSettingsStore } = createMemorySettingsStore()
  const bridge = createHostBridge({
    hostId: 'utools',
    services: {},
    sharedSettingsStore,
    hostSettingsStore
  })

  bridge.settings.setShared('global', { requestLogEnabled: true })
  bridge.settings.setHost('theme', 'dark')

  assert.deepEqual(bridge.settings.getShared('global', null), { requestLogEnabled: true })
  assert.equal(bridge.settings.getHost('theme', 'light'), 'dark')
  assert.deepEqual(bridge.settings.mergeShared({ autoImportLocalAccounts: false }), { autoImportLocalAccounts: false })
})

test('createHostBridge 应暴露宿主通知导航订阅入口', () => {
  const { sharedSettingsStore, hostSettingsStore } = createMemorySettingsStore()
  let handled = null
  const bridge = createHostBridge({
    hostId: 'utools',
    services: {},
    sharedSettingsStore,
    hostSettingsStore,
    subscribeHostNavigation (listener) {
      listener({ platform: 'codex' })
      return function unsubscribe () {}
    }
  })

  const unsubscribe = bridge.events.subscribeHostNavigation((detail) => {
    handled = detail
  })

  assert.equal(typeof unsubscribe, 'function')
  assert.deepEqual(handled, { platform: 'codex' })
})
