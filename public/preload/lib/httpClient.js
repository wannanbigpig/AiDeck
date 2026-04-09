/**
 * httpClient.js — 轻量 HTTP 客户端（Node.js 环境）
 *
 * 封装 fetch/https 请求，统一超时、重试、错误处理。
 * 供 antigravityService / codexService / geminiService 共用。
 */

const https = require('node:https')
const http = require('node:http')

const DEFAULT_TIMEOUT_MS = 15000

/**
 * 发起 HTTPS/HTTP 请求
 * @param {string} url
 * @param {object} options - { method, headers, body, timeout }
 * @returns {Promise<{ ok: boolean, status: number, body: string }>}
 */
function request (url, options) {
  return new Promise(function (resolve, reject) {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const mod = isHttps ? https : http
    const timeout = (options && options.timeout) || DEFAULT_TIMEOUT_MS

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: (options && options.method) || 'GET',
      headers: (options && options.headers) || {},
      timeout: timeout
    }

    const req = mod.request(reqOptions, function (res) {
      const chunks = []
      res.on('data', function (chunk) { chunks.push(chunk) })
      res.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf-8')
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: body
        })
      })
    })

    req.on('timeout', function () {
      req.destroy()
      reject(new Error('请求超时: ' + url))
    })

    req.on('error', function (err) {
      reject(err)
    })

    if (options && options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

/**
 * POST JSON 请求
 * @param {string} url
 * @param {object} headers - 额外请求头
 * @param {object} jsonBody - JSON 请求体
 * @returns {Promise<{ ok: boolean, status: number, data: object, raw: string }>}
 */
async function postJSON (url, headers, jsonBody) {
  const body = JSON.stringify(jsonBody)
  const mergedHeaders = Object.assign({
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }, headers || {})
  mergedHeaders['Content-Length'] = Buffer.byteLength(body)

  const res = await request(url, {
    method: 'POST',
    headers: mergedHeaders,
    body: body
  })

  let data = null
  try {
    data = JSON.parse(res.body)
  } catch (_) {
    data = null
  }

  return { ok: res.ok, status: res.status, data: data, raw: res.body }
}

/**
 * GET JSON 请求
 * @param {string} url
 * @param {object} headers
 * @returns {Promise<{ ok: boolean, status: number, data: object, raw: string }>}
 */
async function getJSON (url, headers) {
  const mergedHeaders = Object.assign({
    Accept: 'application/json'
  }, headers || {})

  const res = await request(url, {
    method: 'GET',
    headers: mergedHeaders
  })

  let data = null
  try {
    data = JSON.parse(res.body)
  } catch (_) {
    data = null
  }

  return { ok: res.ok, status: res.status, data: data, raw: res.body }
}

/**
 * POST form-urlencoded 请求（OAuth Token 刷新用）
 * @param {string} url
 * @param {object} params - key-value 表单参数
 * @returns {Promise<{ ok: boolean, status: number, data: object, raw: string }>}
 */
async function postForm (url, params) {
  const entries = Object.entries(params || {})
  const body = entries.map(function (pair) {
    return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1])
  }).join('&')

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body)
  }

  const res = await request(url, {
    method: 'POST',
    headers: headers,
    body: body
  })

  let data = null
  try {
    data = JSON.parse(res.body)
  } catch (_) {
    data = null
  }

  return { ok: res.ok, status: res.status, data: data, raw: res.body }
}

module.exports = {
  request,
  postJSON,
  getJSON,
  postForm
}
