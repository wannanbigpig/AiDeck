function createRevisionHelpers ({
  fileUtils,
  dataRoot,
  revisionBus,
  dataSchemaVersion,
  metaFile,
  nowMs
}) {
  function metaPath () {
    return require('node:path').join(dataRoot.getMetaDir(), metaFile)
  }

  function ensureMetaFile () {
    const nextPath = metaPath()
    if (fileUtils.fileExists(nextPath)) return
    fileUtils.writeJsonFile(nextPath, {
      schema_version: dataSchemaVersion,
      created_at: nowMs(),
      updated_at: nowMs()
    })
  }

  function touchMeta () {
    const current = fileUtils.readJsonFile(metaPath()) || {}
    const next = Object.assign({}, current, {
      schema_version: dataSchemaVersion,
      updated_at: nowMs()
    })
    if (!current.created_at) next.created_at = nowMs()
    fileUtils.writeJsonFile(metaPath(), next)
  }

  function touchStorage (reason, detail) {
    touchMeta()
    revisionBus.touchRevision(reason, detail)
  }

  return {
    metaPath,
    ensureMetaFile,
    touchMeta,
    touchStorage
  }
}

module.exports = {
  createRevisionHelpers
}
