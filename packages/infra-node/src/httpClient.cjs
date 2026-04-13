/**
 * httpClient.js — 轻量 HTTP 客户端（Node.js 环境）
 *
 * 封装 fetch/https 请求，统一超时、重试、错误处理。
 * 供 antigravityService / codexService / geminiService 共用。
 */

const https = require('node:https')
const http = require('node:http')
const zlib = require('node:zlib')
const requestLogger = require('./requestLogStore')

const DEFAULT_TIMEOUT_MS = 15000

function decodeResponseBuffer (buffer, headers) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  const encoding = String(headers && headers['content-encoding'] ? headers['content-encoding'] : '').trim().toLowerCase()
  if (!raw.length || !encoding) return raw

  try {
    if (encoding.includes('gzip')) return zlib.gunzipSync(raw)
    if (encoding.includes('deflate')) return zlib.inflateSync(raw)
    if (encoding.includes('br')) return zlib.brotliDecompressSync(raw)
  } catch (err) {
    requestLogger.warn('http.decode', '响应解压失败，已回退原始内容', {
      encoding,
      error: err && err.message ? err.message : String(err)
    })
  }
  return raw
}

function buildBodyPreview (text, contentType) {
  const body = String(text || '')
  const type = String(contentType || '').toLowerCase()
  if (!body) return ''
  if (type.includes('json') || type.includes('text') || type.includes('javascript') || type.includes('xml')) {
    return body
  }
  const nonPrintable = body.replace(/[\x20-\x7E\r\n\t]/g, '')
  if (nonPrintable.length > 24) {
    return `[binary body omitted, ${body.length} chars after decode]`
  }
  return body
}

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
    const startedAt = Date.now()
    const method = (options && options.method) || 'GET'
    const requestId = 'http-' + startedAt + '-' + Math.random().toString(36).slice(2, 8)

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method,
      headers: (options && options.headers) || {},
      timeout: timeout
    }

    requestLogger.info('http.request', method + ' ' + requestLogger.sanitizeUrl(url), {
      requestId,
      method,
      url,
      headers: reqOptions.headers,
      body: options && options.body ? options.body : undefined
    })

    const req = mod.request(reqOptions, function (res) {
      const chunks = []
      res.on('data', function (chunk) { chunks.push(chunk) })
      res.on('end', function () {
        const rawBuffer = Buffer.concat(chunks)
        const decodedBuffer = decodeResponseBuffer(rawBuffer, res.headers || {})
        const body = decodedBuffer.toString('utf-8')
        const contentType = res.headers ? res.headers['content-type'] : ''
        const contentEncoding = res.headers ? res.headers['content-encoding'] : ''
        requestLogger.addLog({
          level: res.statusCode >= 400 ? 'error' : 'info',
          scope: 'http.response',
          message: method + ' ' + requestLogger.sanitizeUrl(url) + ' -> ' + res.statusCode,
          detail: {
            requestId,
            status: res.statusCode,
            durationMs: Date.now() - startedAt,
            contentType,
            contentEncoding,
            body: buildBodyPreview(body, contentType)
          }
        })
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: body
        })
      })
    })

    req.on('timeout', function () {
      req.destroy()
      requestLogger.warn('http.timeout', method + ' ' + requestLogger.sanitizeUrl(url) + ' 超时', {
        requestId,
        timeout,
        durationMs: Date.now() - startedAt
      })
      reject(new Error('请求超时: ' + url))
    })

    req.on('error', function (err) {
      requestLogger.error('http.error', method + ' ' + requestLogger.sanitizeUrl(url) + ' 失败', {
        requestId,
        durationMs: Date.now() - startedAt,
        error: err && err.message ? err.message : String(err)
      })
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
