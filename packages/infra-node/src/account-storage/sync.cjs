const crypto = require('node:crypto')
const path = require('node:path')

function createSyncService ({
  fileUtils,
  dataRoot,
  storageDriver,
  sharedSettingsStore,
  supportedPlatforms,
  syncSchemaVersion,
  syncAad,
  defaultScrypt,
  nowMs,
  initStorage,
  listAccounts,
  getCurrentId,
  addAccounts,
  addAccount,
  getAccount,
  setCurrentId
}) {
  function snapshotAllPlatforms () {
    const snapshot = {
      version: syncSchemaVersion,
      created_at: nowMs(),
      shared_settings: sharedSettingsStore.readAll(),
      platforms: {}
    }
    for (let i = 0; i < supportedPlatforms.length; i++) {
      const platform = supportedPlatforms[i]
      snapshot.platforms[platform] = {
        current_id: getCurrentId(platform),
        accounts: listAccounts(platform)
      }
    }
    return snapshot
  }

  function deriveSyncKey (passphrase, salt, kdfConfig) {
    const cfg = Object.assign({}, defaultScrypt, kdfConfig || {})
    return crypto.scryptSync(String(passphrase || ''), salt, Number(cfg.keyLen || 32), {
      N: Number(cfg.N || defaultScrypt.N),
      r: Number(cfg.r || defaultScrypt.r),
      p: Number(cfg.p || defaultScrypt.p),
      maxmem: Number(cfg.maxmem || defaultScrypt.maxmem)
    })
  }

  function buildEncryptedSyncPayload (passphrase) {
    const pass = String(passphrase || '')
    if (!pass) return { success: false, error: '同步口令不能为空' }

    try {
      initStorage()
      const plaintext = Buffer.from(JSON.stringify(snapshotAllPlatforms()), 'utf8')
      const salt = crypto.randomBytes(16)
      const iv = crypto.randomBytes(12)
      const key = deriveSyncKey(pass, salt, defaultScrypt)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(syncAad, 'utf8'))
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
      const envelope = {
        version: syncSchemaVersion,
        aad: syncAad,
        cipher: {
          algorithm: 'aes-256-gcm',
          iv: iv.toString('base64'),
          tag: cipher.getAuthTag().toString('base64')
        },
        kdf: {
          name: 'scrypt',
          salt: salt.toString('base64'),
          N: defaultScrypt.N,
          r: defaultScrypt.r,
          p: defaultScrypt.p,
          keyLen: defaultScrypt.keyLen
        },
        ciphertext: encrypted.toString('base64'),
        created_at: nowMs()
      }
      fileUtils.ensureDir(dataRoot.getSyncDir())
      storageDriver.writeJson(path.join(dataRoot.getSyncDir(), 'last-payload.json'), envelope)
      return { success: true, payload: envelope }
    } catch (err) {
      return { success: false, error: err.message || String(err) }
    }
  }

  function applyEncryptedSyncPayload (payload, passphrase) {
    const pass = String(passphrase || '')
    if (!pass) return { success: false, error: '同步口令不能为空' }

    try {
      const env = typeof payload === 'string' ? JSON.parse(payload) : payload
      if (!env || typeof env !== 'object') return { success: false, error: '无效的同步数据格式' }
      const kdf = env.kdf || {}
      const cipherMeta = env.cipher || {}
      if (String(cipherMeta.algorithm || '').toLowerCase() !== 'aes-256-gcm') {
        return { success: false, error: '不支持的加密算法' }
      }

      const salt = Buffer.from(String(kdf.salt || ''), 'base64')
      const iv = Buffer.from(String(cipherMeta.iv || ''), 'base64')
      const tag = Buffer.from(String(cipherMeta.tag || ''), 'base64')
      const ciphertext = Buffer.from(String(env.ciphertext || ''), 'base64')
      if (!salt.length || !iv.length || !tag.length || !ciphertext.length) {
        return { success: false, error: '同步密文结构不完整' }
      }

      const key = deriveSyncKey(pass, salt, {
        N: Number(kdf.N || defaultScrypt.N),
        r: Number(kdf.r || defaultScrypt.r),
        p: Number(kdf.p || defaultScrypt.p),
        keyLen: Number(kdf.keyLen || defaultScrypt.keyLen)
      })
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAAD(Buffer.from(String(env.aad || syncAad), 'utf8'))
      decipher.setAuthTag(tag)
      const snapshot = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
      if (!snapshot || typeof snapshot !== 'object' || !snapshot.platforms || typeof snapshot.platforms !== 'object') {
        return { success: false, error: '解密成功但数据结构无效' }
      }

      let mergedAccounts = 0
      for (let i = 0; i < supportedPlatforms.length; i++) {
        const platform = supportedPlatforms[i]
        const platformSnapshot = snapshot.platforms[platform]
        if (!platformSnapshot || typeof platformSnapshot !== 'object') continue
        const incomingAccounts = Array.isArray(platformSnapshot.accounts) ? platformSnapshot.accounts : []
        if (typeof addAccounts === 'function') {
          mergedAccounts += addAccounts(platform, incomingAccounts, initStorage, { mode: 'sync' })
        } else {
          for (let j = 0; j < incomingAccounts.length; j++) {
            if (addAccount(platform, incomingAccounts[j], { mode: 'sync' })) mergedAccounts++
          }
        }
        const nextCurrent = String(platformSnapshot.current_id || '').trim()
        if (nextCurrent && getAccount(platform, nextCurrent)) setCurrentId(platform, nextCurrent)
      }

      if (snapshot.shared_settings && typeof snapshot.shared_settings === 'object') {
        sharedSettingsStore.merge(snapshot.shared_settings)
      }

      return { success: true, merged_accounts: mergedAccounts }
    } catch (err) {
      return { success: false, error: '同步数据解密失败: ' + (err.message || String(err)) }
    }
  }

  return {
    buildEncryptedSyncPayload,
    applyEncryptedSyncPayload
  }
}

module.exports = {
  createSyncService
}
