const fs = require('fs')
const path = require('path')
const fileUtils = require('./fileUtils.cjs')
const dataRoot = require('./dataRoot.cjs')

const REVISION_FILE = 'revision.json'
const listeners = new Set()

function _revisionFilePath () {
  return path.join(dataRoot.getMetaDir(), REVISION_FILE)
}

function _readRevisionPayload () {
  dataRoot.ensureDataRootLayout()
  const filePath = _revisionFilePath()
  const current = fileUtils.readJsonFile(filePath)
  if (current && typeof current === 'object' && Number.isFinite(Number(current.revision))) {
    return current
  }
  const next = {
    revision: 0,
    updated_at: Date.now(),
    reason: 'init'
  }
  fileUtils.writeJsonFile(filePath, next)
  return next
}

function getRevision () {
  return Number(_readRevisionPayload().revision || 0)
}

function touchRevision (reason, detail) {
  const current = _readRevisionPayload()
  const next = {
    revision: Number(current.revision || 0) + 1,
    updated_at: Date.now(),
    reason: String(reason || 'update'),
    detail: detail && typeof detail === 'object' ? detail : undefined
  }
  fileUtils.writeJsonFile(_revisionFilePath(), next)
  const payload = {
    revision: Number(next.revision || 0),
    updatedAt: Number(next.updated_at || Date.now()),
    reason: String(next.reason || ''),
    detail: next.detail && typeof next.detail === 'object' ? next.detail : undefined
  }
  for (const listener of listeners) {
    try {
      listener(payload)
    } catch (err) {}
  }
  return next
}

function subscribe (listener) {
  dataRoot.ensureDataRootLayout()
  const metaDir = dataRoot.getMetaDir()
  let closed = false
  let lastRevision = getRevision()
  let watchHandle = null

  listeners.add(listener)
  try {
    watchHandle = fs.watch(metaDir, { persistent: false }, function (_eventType, filename) {
      if (closed) return
      if (String(filename || '').trim() && String(filename) !== REVISION_FILE) return
      const payload = _readRevisionPayload()
      const nextRevision = Number(payload.revision || 0)
      if (nextRevision === lastRevision) return
      lastRevision = nextRevision
      try {
        listener({
          revision: nextRevision,
          updatedAt: Number(payload.updated_at || Date.now()),
          reason: String(payload.reason || ''),
          detail: payload.detail && typeof payload.detail === 'object' ? payload.detail : undefined
        })
      } catch (err) {}
    })
  } catch (err) {}

  return function unsubscribe () {
    closed = true
    listeners.delete(listener)
    if (watchHandle && typeof watchHandle.close === 'function') {
      try {
        watchHandle.close()
      } catch (err) {}
    }
  }
}

module.exports = {
  getRevision,
  touchRevision,
  subscribe
}
