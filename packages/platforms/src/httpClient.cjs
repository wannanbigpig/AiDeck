function loadHttpClient () {
  let firstError = null
  try {
    return require('../../infra-node/src/httpClient.cjs')
  } catch (err) {
    const message = String(err && err.message ? err.message : '')
    if (!(err && err.code === 'MODULE_NOT_FOUND' && message.includes('../../infra-node/src/httpClient.cjs'))) {
      throw err
    }
    firstError = err
  }

  try {
    return require('../infra-node/src/httpClient.cjs')
  } catch (err) {
    const message = String(err && err.message ? err.message : '')
    if (!(err && err.code === 'MODULE_NOT_FOUND' && message.includes('../infra-node/src/httpClient.cjs'))) {
      throw err
    }
    throw err || firstError
  }

  if (firstError) throw firstError
  throw new Error('Unable to load httpClient module')
}

const httpClient = loadHttpClient()

module.exports = {
  request: httpClient.request,
  postJSON: httpClient.postJSON,
  getJSON: httpClient.getJSON,
  postForm: httpClient.postForm
}
