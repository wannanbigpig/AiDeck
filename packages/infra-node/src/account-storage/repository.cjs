const crypto = require('crypto')
const path = require('path')

function createRepository ({
  fileUtils,
  revisionBus,
  dataSchemaVersion,
  nowMs,
  cache,
  storageDriver,
  assertPlatform,
  indexPath,
  currentPath,
  accountsDir,
  getOAuthPendingDir
}) {
  function sanitizeFileStem (value) {
    const raw = String(value || '').trim()
    if (!raw) return 'item_' + fileUtils.generateId()
    const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, '_')
    if (normalized && normalized !== '.' && normalized !== '..') return normalized
    return 'item_' + crypto.createHash('md5').update(raw).digest('hex')
  }

  function pendingPath (platform, sessionId) {
    return path.join(getOAuthPendingDir(platform), sanitizeFileStem(sessionId) + '.json')
  }

  function accountFilePath (platform, accountId) {
    return path.join(accountsDir(platform), sanitizeFileStem(accountId) + '.json')
  }

  function normalizeString (value) {
    if (typeof value !== 'string') return ''
    return value.trim()
  }

  function normalizeEmail (value) {
    const trimmed = normalizeString(value)
    return trimmed ? trimmed.toLowerCase() : ''
  }

  function decodeJwtPayload (token) {
    const raw = normalizeString(token)
    if (!raw) return null
    try {
      const parts = raw.split('.')
      if (parts.length < 2) return null
      const payload = parts[1]
      const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
      const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
      return JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'))
    } catch {
      return null
    }
  }

  function hasQuotaModels (quota) {
    if (!quota || typeof quota !== 'object') return false
    if (Array.isArray(quota.models)) return quota.models.length > 0
    if (quota.models && typeof quota.models === 'object') return Object.keys(quota.models).length > 0
    return false
  }

  function extractCodexIdentity (account) {
    const tokens = (account && account.tokens) || {}
    const accessToken = normalizeString(tokens.access_token || account.access_token || account.token || '')
    const idToken = normalizeString(tokens.id_token || account.id_token || '')
    const accessPayload = decodeJwtPayload(accessToken) || {}
    const idPayload = decodeJwtPayload(idToken) || {}
    const accessAuth = accessPayload['https://api.openai.com/auth'] || {}
    const idAuth = idPayload['https://api.openai.com/auth'] || {}
    return {
      email: normalizeEmail(account.email || idPayload.email || accessPayload.email),
      accountId: normalizeString(
        account.account_id || account.accountId || tokens.account_id || tokens.accountId ||
        accessAuth.chatgpt_account_id || accessAuth.account_id || idAuth.chatgpt_account_id ||
        idAuth.account_id || accessPayload.account_id || idPayload.account_id
      ),
      organizationId: normalizeString(
        account.organization_id || account.organizationId || tokens.organization_id || tokens.organizationId ||
        accessAuth.organization_id || accessAuth.chatgpt_organization_id || accessAuth.chatgpt_org_id ||
        accessAuth.org_id || idAuth.organization_id || idAuth.chatgpt_organization_id ||
        idAuth.chatgpt_org_id || idAuth.org_id
      )
    }
  }

  function buildCodexStorageId (email, accountId, organizationId) {
    const seed = [normalizeEmail(email) || 'unknown@codex', normalizeString(accountId), normalizeString(organizationId)]
      .filter(Boolean)
      .join('|')
    return 'codex_' + crypto.createHash('md5').update(seed).digest('hex')
  }

  function buildAntigravityStorageId (account) {
    const token = (account && account.token) || {}
    const seed = [
      normalizeEmail(account && account.email),
      normalizeString(token.project_id),
      normalizeString(token.refresh_token) || normalizeString(token.access_token)
    ].filter(Boolean).join('|')
    if (!seed) return 'antigravity_' + fileUtils.generateId()
    return 'antigravity_' + crypto.createHash('md5').update(seed).digest('hex')
  }

  function buildGeminiStorageId (account) {
    const seed = [
      normalizeString(account && account.auth_id),
      normalizeEmail(account && account.email),
      normalizeString(account && account.refresh_token) || normalizeString(account && account.access_token)
    ].filter(Boolean).join('|')
    if (!seed) return 'gemini_' + fileUtils.generateId()
    return 'gemini_' + crypto.createHash('md5').update(seed).digest('hex')
  }

  function prepareAccountForStorage (platform, account) {
    if (!account || typeof account !== 'object') return null
    const next = Object.assign({}, account)
    next.created_at = Number(next.created_at || nowMs())
    next.last_used = Number(next.last_used || 0)
    next.updated_at = Number(next.updated_at || nowMs())
    next.added_via = normalizeString(next.added_via).toLowerCase()
    next.added_at = Number(next.added_at || 0)
    delete next.added_meta_override

    if (typeof next.email === 'string') next.email = next.email.trim()

    if (platform === 'codex') {
      const identity = extractCodexIdentity(next)
      const email = normalizeEmail(next.email || identity.email || '')
      if (!email) return null
      next.email = email
      next.account_id = identity.accountId || next.account_id || ''
      next.organization_id = identity.organizationId || next.organization_id || ''
      next.id = buildCodexStorageId(next.email, next.account_id, next.organization_id)
      return next
    }

    if (platform === 'antigravity') {
      next.email = normalizeEmail(next.email || '') || (next.email || 'unknown@antigravity')
      next.token = Object.assign({}, (next.token && typeof next.token === 'object') ? next.token : {}, {
        project_id: normalizeString(next.token && next.token.project_id)
      })
      next.id = buildAntigravityStorageId(next)
      return next
    }

    if (platform === 'gemini') {
      next.email = normalizeEmail(next.email || '') || (next.email || 'unknown@gemini')
      next.auth_id = normalizeString(next.auth_id)
      next.id = buildGeminiStorageId(next)
      return next
    }

    return next
  }

  function findExistingCodexAccountIndex (accounts, incoming) {
    const incomingId = normalizeString(incoming && incoming.id)
    if (!incomingId) return -1
    return accounts.findIndex((existing) => normalizeString(existing && existing.id) === incomingId)
  }

  function findExistingAntigravityAccountIndex (accounts, incoming) {
    const incomingId = normalizeString(incoming && incoming.id)
    const incomingEmail = normalizeEmail(incoming && incoming.email)
    const incomingToken = (incoming && incoming.token) || {}
    const incomingRefresh = normalizeString(incomingToken.refresh_token)
    const incomingAccess = normalizeString(incomingToken.access_token)
    const incomingProject = normalizeString(incomingToken.project_id)
    let firstEmailMatchIndex = -1
    let emailMatchCount = 0

    for (let i = 0; i < accounts.length; i++) {
      const existing = accounts[i] || {}
      const existingToken = (existing && existing.token) || {}
      if (incomingId && normalizeString(existing.id) === incomingId) return i
      if (incomingRefresh && normalizeString(existingToken.refresh_token) === incomingRefresh) return i
      if (incomingAccess && normalizeString(existingToken.access_token) === incomingAccess) return i

      const existingEmail = normalizeEmail(existing.email)
      if (!incomingEmail || !existingEmail || incomingEmail !== existingEmail) continue
      emailMatchCount++
      if (firstEmailMatchIndex < 0) firstEmailMatchIndex = i
      if (incomingProject && normalizeString(existingToken.project_id) === incomingProject) return i
    }
    return emailMatchCount === 1 ? firstEmailMatchIndex : -1
  }

  function findExistingGeminiAccountIndex (accounts, incoming) {
    const incomingId = normalizeString(incoming && incoming.id)
    const incomingEmail = normalizeEmail(incoming && incoming.email)
    const incomingAuthId = normalizeString(incoming && incoming.auth_id)
    const incomingRefresh = normalizeString(incoming && (incoming.refresh_token || (incoming.tokens && incoming.tokens.refresh_token)))
    const incomingAccess = normalizeString(incoming && (incoming.access_token || (incoming.tokens && incoming.tokens.access_token)))
    let firstEmailMatchIndex = -1
    let emailMatchCount = 0

    for (let i = 0; i < accounts.length; i++) {
      const existing = accounts[i] || {}
      if (incomingId && normalizeString(existing.id) === incomingId) return i
      if (incomingAuthId && normalizeString(existing.auth_id) === incomingAuthId) return i
      if (incomingRefresh && normalizeString(existing.refresh_token || (existing.tokens && existing.tokens.refresh_token)) === incomingRefresh) return i
      if (incomingAccess && normalizeString(existing.access_token || (existing.tokens && existing.tokens.access_token)) === incomingAccess) return i
      const existingEmail = normalizeEmail(existing.email)
      if (!incomingEmail || !existingEmail || incomingEmail !== existingEmail) continue
      emailMatchCount++
      if (firstEmailMatchIndex < 0) firstEmailMatchIndex = i
    }
    return emailMatchCount === 1 ? firstEmailMatchIndex : -1
  }

  function findExistingAccountIndex (platform, accounts, account) {
    if (platform === 'codex') return findExistingCodexAccountIndex(accounts, account)
    if (platform === 'antigravity') return findExistingAntigravityAccountIndex(accounts, account)
    if (platform === 'gemini') return findExistingGeminiAccountIndex(accounts, account)
    return accounts.findIndex((existing) => existing.id === account.id || normalizeEmail(existing.email) === normalizeEmail(account.email))
  }

  function mergeCodexAccount (existing, incoming) {
    const existingTokens = (existing && existing.tokens && typeof existing.tokens === 'object') ? existing.tokens : {}
    const incomingTokens = (incoming && incoming.tokens && typeof incoming.tokens === 'object') ? incoming.tokens : {}
    const mergedTokens = Object.assign({}, existingTokens, incomingTokens)
    if (!normalizeString(incomingTokens.access_token) && normalizeString(existingTokens.access_token)) mergedTokens.access_token = existingTokens.access_token
    if (!normalizeString(incomingTokens.refresh_token) && normalizeString(existingTokens.refresh_token)) mergedTokens.refresh_token = existingTokens.refresh_token
    if (!normalizeString(incomingTokens.id_token) && normalizeString(existingTokens.id_token)) mergedTokens.id_token = existingTokens.id_token

    const merged = Object.assign({}, existing, incoming, {
      id: existing.id || incoming.id,
      email: normalizeEmail(incoming.email || existing.email) || incoming.email || existing.email,
      created_at: Number(existing.created_at || incoming.created_at || nowMs()),
      last_used: Number(existing.last_used || incoming.last_used || 0),
      tokens: mergedTokens
    })
    const existingAddedAt = Number(existing && existing.added_at ? existing.added_at : 0)
    const incomingAddedAt = Number(incoming && incoming.added_at ? incoming.added_at : 0)
    const defaultAddedAt = Number(existing.created_at || incoming.created_at || 0)
    const existingAddedVia = normalizeString(existing && existing.added_via).toLowerCase()
    const incomingAddedVia = normalizeString(incoming && incoming.added_via).toLowerCase()
    if (incoming && incoming.added_meta_override === true) {
      merged.added_via = incomingAddedVia || existingAddedVia || ''
      merged.added_at = incomingAddedAt || existingAddedAt || defaultAddedAt || 0
    } else {
      merged.added_via = existingAddedVia || incomingAddedVia || ''
      merged.added_at = existingAddedAt || incomingAddedAt || defaultAddedAt || 0
    }
    delete merged.added_meta_override
    return merged
  }

  function mergeGeminiAccount (existing, incoming) {
    const merged = Object.assign({}, existing, incoming, {
      id: existing.id || incoming.id,
      email: normalizeEmail(incoming.email || existing.email) || incoming.email || existing.email,
      created_at: Number(existing.created_at || incoming.created_at || nowMs()),
      last_used: Number(existing.last_used || incoming.last_used || 0)
    })
    if (!normalizeString(incoming.access_token) && normalizeString(existing.access_token)) merged.access_token = existing.access_token
    if (!normalizeString(incoming.refresh_token) && normalizeString(existing.refresh_token)) merged.refresh_token = existing.refresh_token
    if (!normalizeString(incoming.id_token) && normalizeString(existing.id_token)) merged.id_token = existing.id_token
    if (!normalizeString(incoming.auth_id) && normalizeString(existing.auth_id)) merged.auth_id = existing.auth_id
    return merged
  }

  function mergeAntigravityAccount (existing, incoming) {
    const existingToken = (existing && existing.token && typeof existing.token === 'object') ? existing.token : {}
    const incomingToken = (incoming && incoming.token && typeof incoming.token === 'object') ? incoming.token : {}
    const mergedToken = Object.assign({}, existingToken, incomingToken)
    if (!normalizeString(incomingToken.access_token) && normalizeString(existingToken.access_token)) mergedToken.access_token = existingToken.access_token
    if (!normalizeString(incomingToken.refresh_token) && normalizeString(existingToken.refresh_token)) mergedToken.refresh_token = existingToken.refresh_token
    if (!normalizeString(incomingToken.token_type) && normalizeString(existingToken.token_type)) mergedToken.token_type = existingToken.token_type
    if (!normalizeString(incomingToken.project_id) && normalizeString(existingToken.project_id)) mergedToken.project_id = existingToken.project_id
    if (!Number.isFinite(Number(incomingToken.expiry_timestamp)) && Number.isFinite(Number(existingToken.expiry_timestamp))) mergedToken.expiry_timestamp = existingToken.expiry_timestamp

    const existingQuota = existing && existing.quota
    const incomingQuota = incoming && incoming.quota
    let mergedQuota = incomingQuota
    if (!hasQuotaModels(incomingQuota) && hasQuotaModels(existingQuota)) {
      mergedQuota = incomingQuota && typeof incomingQuota === 'object'
        ? Object.assign({}, incomingQuota, { models: existingQuota.models })
        : existingQuota
    } else if (!incomingQuota && existingQuota) {
      mergedQuota = existingQuota
    }

    return Object.assign({}, existing, incoming, {
      id: existing.id || incoming.id,
      email: normalizeEmail(incoming.email || existing.email) || incoming.email || existing.email,
      name: incoming.name || existing.name || '',
      tags: Array.isArray(incoming && incoming.tags) ? incoming.tags : (existing.tags || []),
      token: mergedToken,
      quota: mergedQuota,
      created_at: Number(existing.created_at || incoming.created_at || nowMs()),
      last_used: Number(existing.last_used || incoming.last_used || 0)
    })
  }

  function mergeAccountForStorage (platform, existing, incoming) {
    if (platform === 'antigravity') return mergeAntigravityAccount(existing, incoming)
    if (platform === 'codex') return mergeCodexAccount(existing, incoming)
    if (platform === 'gemini') return mergeGeminiAccount(existing, incoming)
    return Object.assign({}, existing, incoming, {
      id: existing.id || incoming.id,
      created_at: existing.created_at || incoming.created_at || nowMs(),
      last_used: Number(existing.last_used || incoming.last_used || 0)
    })
  }

  function buildIndexRecord (account) {
    const quota = account && account.quota
    const hasQuota = Boolean(quota && typeof quota === 'object' && (
      (Array.isArray(quota.models) && quota.models.length > 0) ||
      (quota.models && typeof quota.models === 'object' && Object.keys(quota.models).length > 0) ||
      typeof quota.hourly_percentage === 'number' ||
      typeof quota.weekly_percentage === 'number'
    ))
    return {
      id: account.id,
      email: String(account.email || ''),
      name: String(account.name || ''),
      auth_mode: String(account.auth_mode || ''),
      plan_type: String(account.plan_type || ''),
      plan_name: String(account.plan_name || ''),
      tier_id: String(account.tier_id || ''),
      tags: Array.isArray(account.tags) ? account.tags.slice(0, 50) : [],
      created_at: Number(account.created_at || nowMs()),
      last_used: Number(account.last_used || 0),
      updated_at: Number(account.updated_at || nowMs()),
      has_quota: hasQuota,
      quota_updated_at: Number((quota && quota.updated_at) || 0)
    }
  }

  function writeIndexFromAccounts (platform, accounts, tx = storageDriver) {
    return tx.writeJson(indexPath(platform), {
      schema_version: dataSchemaVersion,
      updated_at: nowMs(),
      accounts: accounts.map(buildIndexRecord)
    })
  }

  function isValidIndex (value) {
    return Boolean(
      value &&
      typeof value === 'object' &&
      Array.isArray(value.accounts) &&
      value.accounts.every((account) => account && typeof account === 'object' && typeof account.id === 'string' && typeof account.email === 'string')
    )
  }

  function loadAccountDetailById (platform, accountId) {
    if (!accountId) return null
    const detail = storageDriver.readJson(accountFilePath(platform, accountId))
    return detail && typeof detail === 'object' ? detail : null
  }

  function dedupeByIdentity (platform, accounts) {
    const deduped = []
    for (let i = 0; i < accounts.length; i++) {
      const incoming = accounts[i]
      const index = findExistingAccountIndex(platform, deduped, incoming)
      if (index < 0) {
        deduped.push(incoming)
        continue
      }
      const existing = deduped[index]
      const merged = mergeAccountForStorage(platform, existing, incoming)
      merged.updated_at = Math.max(Number(existing.updated_at || 0), Number(incoming.updated_at || 0), nowMs())
      deduped[index] = merged
    }
    return deduped
  }

  function loadAccountsFromDetails (platform) {
    const files = storageDriver.listFiles(accountsDir(platform))
    const accounts = []
    for (let i = 0; i < files.length; i++) {
      const file = String(files[i] || '')
      if (!file.endsWith('.json')) continue
      const detail = storageDriver.readJson(path.join(accountsDir(platform), file))
      const prepared = prepareAccountForStorage(platform, detail)
      if (prepared) accounts.push(prepared)
    }
    accounts.sort((left, right) => {
      const lLast = Number(left.last_used || 0)
      const rLast = Number(right.last_used || 0)
      if (rLast !== lLast) return rLast - lLast
      const lCreated = Number(left.created_at || 0)
      const rCreated = Number(right.created_at || 0)
      if (rCreated !== lCreated) return rCreated - lCreated
      return String(left.id || '').localeCompare(String(right.id || ''))
    })
    return dedupeByIdentity(platform, accounts)
  }

  function writeCurrentIdValue (platform, accountId, tx = storageDriver) {
    const nextId = String(accountId || '').trim()
    tx.writeJson(currentPath(platform), { id: nextId, updated_at: nowMs() })
  }

  function removeCurrentIdValue (platform, tx = storageDriver) {
    tx.deleteFile(currentPath(platform))
  }

  function persistAccounts (platform, accounts, tx = storageDriver) {
    assertPlatform(platform)
    const normalized = []
    for (let i = 0; i < accounts.length; i++) {
      const prepared = prepareAccountForStorage(platform, accounts[i])
      if (prepared) normalized.push(prepared)
    }
    const deduped = dedupeByIdentity(platform, normalized)
    const keep = new Set()
    for (let i = 0; i < deduped.length; i++) {
      const account = deduped[i]
      const filePath = accountFilePath(platform, account.id)
      keep.add(path.basename(filePath))
      tx.writeJson(filePath, account)
    }

    const existingFiles = tx.listFiles(accountsDir(platform))
    for (let i = 0; i < existingFiles.length; i++) {
      const file = String(existingFiles[i] || '')
      if (!file.endsWith('.json') || keep.has(file)) continue
      tx.deleteFile(path.join(accountsDir(platform), file))
    }

    writeIndexFromAccounts(platform, deduped, tx)
    const currentId = getCurrentId(platform)
    if (currentId && !deduped.some((account) => account.id === currentId)) {
      removeCurrentIdValue(platform, tx)
    }
    return deduped
  }

  function readIndex (platform, repairIndex) {
    assertPlatform(platform)
    const index = storageDriver.readJson(indexPath(platform))
    if (isValidIndex(index)) return index
    repairIndex(platform)
    const repaired = storageDriver.readJson(indexPath(platform))
    if (isValidIndex(repaired)) return repaired
    return { schema_version: dataSchemaVersion, updated_at: nowMs(), accounts: [] }
  }

  function getCurrentId (platform) {
    assertPlatform(platform)
    const current = storageDriver.readJson(currentPath(platform))
    if (!current || typeof current !== 'object') return null
    return String(current.id || '').trim() || null
  }

  function setCurrentId (platform, accountId) {
    assertPlatform(platform)
    const nextId = String(accountId || '').trim()
    storageDriver.batch({
      reason: 'set-current',
      detail: { platform, accountId: nextId }
    }, (tx) => {
      writeCurrentIdValue(platform, nextId, tx)
    })
  }

  function clearCurrentId (platform) {
    assertPlatform(platform)
    storageDriver.batch({
      reason: 'clear-current',
      detail: { platform }
    }, (tx) => {
      removeCurrentIdValue(platform, tx)
    })
  }

  function repairIndex (platform) {
    assertPlatform(platform)
    const accounts = loadAccountsFromDetails(platform)
    let written = false
    storageDriver.batch({
      reason: 'repair-index',
      detail: { platform, repairedCount: accounts.length }
    }, (tx) => {
      written = writeIndexFromAccounts(platform, accounts, tx)
      const currentId = getCurrentId(platform)
      if (currentId && !accounts.some((account) => account.id === currentId)) removeCurrentIdValue(platform, tx)
    })
    return { success: written, repaired_count: accounts.length }
  }

  function listAccounts (platform, initStorage) {
    assertPlatform(platform)
    initStorage()
    const revision = revisionBus.getRevision()
    const cached = cache.getCachedList(platform, revision)
    if (cached) return cached

    const index = readIndex(platform, repairIndex)
    const list = []
    let dirty = false
    for (let i = 0; i < index.accounts.length; i++) {
      const summary = index.accounts[i]
      if (!summary || !summary.id) {
        dirty = true
        continue
      }
      const detail = loadAccountDetailById(platform, summary.id)
      const prepared = prepareAccountForStorage(platform, detail)
      if (!prepared) {
        dirty = true
        continue
      }
      list.push(prepared)
    }

    let finalList = list
    if (dirty) {
      storageDriver.batch({
        reason: 'repair-index',
        detail: { platform, source: 'list-accounts' }
      }, (tx) => {
        finalList = persistAccounts(platform, list, tx)
      })
    }
    cache.setCachedList(platform, dirty ? revisionBus.getRevision() : revision, finalList)
    return finalList
  }

  function saveAccounts (platform, accounts) {
    storageDriver.batch({
      reason: 'save-accounts',
      detail: { platform }
    }, (tx) => {
      persistAccounts(platform, Array.isArray(accounts) ? accounts : [], tx)
    })
    cache.invalidatePlatformCache(platform)
  }

  function getAccount (platform, accountId, initStorage) {
    const accounts = listAccounts(platform, initStorage)
    return accounts.find((account) => account.id === accountId) || null
  }

  function addAccount (platform, account, options, initStorage) {
    const opts = options && typeof options === 'object' ? options : {}
    const prepared = prepareAccountForStorage(platform, account)
    if (!prepared) return null
    const accounts = listAccounts(platform, initStorage)
    const existingIndex = findExistingAccountIndex(platform, accounts, prepared)
    if (existingIndex >= 0) {
      const existing = accounts[existingIndex]
      if (opts.mode === 'sync' && Number(existing.updated_at || 0) > Number(prepared.updated_at || 0)) {
        return existing
      }
      const merged = mergeAccountForStorage(platform, existing, prepared)
      merged.updated_at = Number(prepared.updated_at || nowMs())
      accounts[existingIndex] = merged
      let persisted = null
      storageDriver.batch({
        reason: 'add-account',
        detail: { platform, accountId: merged.id }
      }, (tx) => {
        persisted = persistAccounts(platform, accounts, tx)
      })
      cache.invalidatePlatformCache(platform)
      return persisted[existingIndex] || merged
    }

    prepared.updated_at = Number(prepared.updated_at || nowMs())
    accounts.push(prepared)
    let persisted = null
    storageDriver.batch({
      reason: 'add-account',
      detail: { platform, accountId: prepared.id }
    }, (tx) => {
      persisted = persistAccounts(platform, accounts, tx)
    })
    cache.invalidatePlatformCache(platform)
    return persisted.find((item) => item.id === prepared.id) || prepared
  }

  function addAccounts (platform, incomingAccounts, initStorage, options) {
    const opts = options && typeof options === 'object' ? options : {}
    const incoming = Array.isArray(incomingAccounts) ? incomingAccounts : []
    if (incoming.length === 0) return 0
    const accounts = listAccounts(platform, initStorage)
    let count = 0
    let changed = false
    for (let i = 0; i < incoming.length; i++) {
      const prepared = prepareAccountForStorage(platform, incoming[i])
      if (!prepared) continue
      const existingIndex = findExistingAccountIndex(platform, accounts, prepared)
      if (existingIndex >= 0) {
        const existing = accounts[existingIndex]
        if (opts.mode === 'sync' && Number(existing.updated_at || 0) > Number(prepared.updated_at || 0)) {
          continue
        }
        const merged = mergeAccountForStorage(platform, existing, prepared)
        merged.updated_at = Number(prepared.updated_at || nowMs())
        accounts[existingIndex] = merged
        count++
        changed = true
        continue
      }
      prepared.updated_at = Number(prepared.updated_at || nowMs())
      accounts.push(prepared)
      count++
      changed = true
    }
    if (!changed) return 0
    storageDriver.batch({
      reason: 'add-accounts',
      detail: { platform, count }
    }, (tx) => {
      persistAccounts(platform, accounts, tx)
    })
    cache.invalidatePlatformCache(platform)
    return count
  }

  function updateAccount (platform, accountId, updates, initStorage) {
    const accounts = listAccounts(platform, initStorage)
    const index = accounts.findIndex((account) => account.id === accountId)
    if (index < 0) return null
    const existing = accounts[index]
    const incoming = Object.assign({}, existing, updates || {}, {
      id: existing.id,
      created_at: existing.created_at,
      updated_at: nowMs()
    })
    accounts[index] = mergeAccountForStorage(platform, existing, incoming)
    accounts[index].updated_at = nowMs()
    let persisted = null
    storageDriver.batch({
      reason: 'update-account',
      detail: { platform, accountId }
    }, (tx) => {
      persisted = persistAccounts(platform, accounts, tx)
    })
    cache.invalidatePlatformCache(platform)
    return persisted.find((account) => account.id === accountId) || null
  }

  function deleteAccount (platform, accountId, initStorage) {
    const accounts = listAccounts(platform, initStorage)
    const filtered = accounts.filter((account) => account.id !== accountId)
    if (filtered.length === accounts.length) return false
    storageDriver.batch({
      reason: 'delete-account',
      detail: { platform, accountId }
    }, (tx) => {
      persistAccounts(platform, filtered, tx)
      if (getCurrentId(platform) === accountId) removeCurrentIdValue(platform, tx)
    })
    cache.invalidatePlatformCache(platform)
    return true
  }

  function deleteAccounts (platform, accountIds, initStorage) {
    const idSet = new Set(Array.isArray(accountIds) ? accountIds : [])
    const accounts = listAccounts(platform, initStorage)
    const filtered = accounts.filter((account) => !idSet.has(account.id))
    const deletedCount = accounts.length - filtered.length
    if (deletedCount <= 0) return 0
    storageDriver.batch({
      reason: 'delete-accounts',
      detail: { platform, count: deletedCount }
    }, (tx) => {
      persistAccounts(platform, filtered, tx)
      const currentId = getCurrentId(platform)
      if (currentId && idSet.has(currentId)) removeCurrentIdValue(platform, tx)
    })
    cache.invalidatePlatformCache(platform)
    return deletedCount
  }

  function getCurrentAccount (platform, initStorage) {
    const id = getCurrentId(platform)
    return id ? getAccount(platform, id, initStorage) : null
  }

  function exportAccounts (platform, accountIds, initStorage) {
    const accounts = listAccounts(platform, initStorage)
    const idSet = new Set(Array.isArray(accountIds) ? accountIds : [])
    return JSON.stringify(accounts.filter((account) => idSet.has(account.id)), null, 2)
  }

  function getAccountCount (platform, initStorage) {
    return listAccounts(platform, initStorage).length
  }

  function saveOAuthPending (platform, payload) {
    assertPlatform(platform)
    if (!payload || typeof payload !== 'object') return false
    const sessionId = String(payload.sessionId || '').trim()
    if (!sessionId) return false
    let saved = false
    storageDriver.batch({
      reason: 'save-oauth-pending',
      detail: { platform, sessionId }
    }, (tx) => {
      saved = tx.writeJson(pendingPath(platform, sessionId), Object.assign({}, payload, {
        sessionId,
        updated_at: nowMs()
      }))
    })
    return saved
  }

  function getOAuthPending (platform, sessionId) {
    assertPlatform(platform)
    const sid = String(sessionId || '').trim()
    if (!sid) return null
    const data = storageDriver.readJson(pendingPath(platform, sid))
    return data && typeof data === 'object' ? data : null
  }

  function getLatestOAuthPending (platform, maxAgeMs) {
    assertPlatform(platform)
    const ttl = Number(maxAgeMs || 0)
    const now = nowMs()
    const files = storageDriver.listFiles(getOAuthPendingDir(platform))
    let latest = null
    let latestTs = 0
    for (let i = 0; i < files.length; i++) {
      const file = String(files[i] || '')
      if (!file.endsWith('.json')) continue
      const data = storageDriver.readJson(path.join(getOAuthPendingDir(platform), file))
      if (!data || typeof data !== 'object') continue
      const ts = Number(data.updated_at || data.createdAt || 0)
      if (ttl > 0 && ts > 0 && now - ts > ttl) continue
      if (ts >= latestTs) {
        latestTs = ts
        latest = data
      }
    }
    return latest
  }

  function clearOAuthPending (platform, sessionId) {
    assertPlatform(platform)
    const sid = String(sessionId || '').trim()
    if (!sid) return true
    let cleared = true
    storageDriver.batch({
      reason: 'clear-oauth-pending',
      detail: { platform, sessionId: sid }
    }, (tx) => {
      cleared = tx.deleteFile(pendingPath(platform, sid))
    })
    return cleared
  }

  function cleanupOAuthPending (platform, ttlMs) {
    assertPlatform(platform)
    const ttl = Number(ttlMs || 0)
    if (!(ttl > 0)) return 0
    const now = nowMs()
    const files = storageDriver.listFiles(getOAuthPendingDir(platform))
    let deleted = 0
    storageDriver.batch({
      reason: 'cleanup-oauth-pending',
      detail: { platform }
    }, (tx) => {
      for (let i = 0; i < files.length; i++) {
        const file = String(files[i] || '')
        if (!file.endsWith('.json')) continue
        const fullPath = path.join(getOAuthPendingDir(platform), file)
        const data = tx.readJson(fullPath)
        const ts = Number(data && (data.updated_at || data.createdAt) ? (data.updated_at || data.createdAt) : 0)
        if (ts > 0 && now - ts <= ttl) continue
        if (tx.deleteFile(fullPath)) deleted++
      }
    })
    return deleted
  }

  return {
    repairIndex,
    listAccounts,
    saveAccounts,
    getAccount,
    addAccount,
    addAccounts,
    updateAccount,
    deleteAccount,
    deleteAccounts,
    getCurrentId,
    setCurrentId,
    clearCurrentId,
    getCurrentAccount,
    exportAccounts,
    getAccountCount,
    saveOAuthPending,
    getOAuthPending,
    getLatestOAuthPending,
    clearOAuthPending,
    cleanupOAuthPending
  }
}

module.exports = {
  createRepository
}
