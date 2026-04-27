const httpClient = require('../../infra-node/src/httpClient.cjs')

module.exports = {
  request: httpClient.request,
  postJSON: httpClient.postJSON,
  getJSON: httpClient.getJSON,
  postForm: httpClient.postForm
}
