const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const zlib = require('node:zlib')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-log-home-'))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome

const requestLogStorePath = path.join(__dirname, '..', 'public', 'preload', 'lib', 'requestLogStore.js')
const httpClientPath = path.join(__dirname, '..', 'public', 'preload', 'lib', 'httpClient.js')

function resetLogEnvironment () {
  fs.rmSync(path.join(tempHome, '.ai_deck'), { recursive: true, force: true })
  delete globalThis.__AIDECK_REQUEST_LOG_STATE__
  delete require.cache[require.resolve(requestLogStorePath)]
  delete require.cache[require.resolve(httpClientPath)]
}

function loadLogModules () {
  const requestLogStore = require(requestLogStorePath)
  const httpClient = require(httpClientPath)
  return { requestLogStore, httpClient }
}

function formatLocalTimestamp (value) {
  const date = new Date(value)
  const pad = (num, size = 2) => String(num).padStart(size, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
    '.',
    pad(date.getMilliseconds(), 3)
  ].join('')
}

test.after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test('requestLogStore 应保留完整 body 且继续脱敏', () => {
  resetLogEnvironment()
  const { requestLogStore } = loadLogModules()
  requestLogStore.setEnabled(true)
  requestLogStore.clearLogs()

  const payload = JSON.stringify({
    access_token: 'ya29.this-is-a-very-long-access-token-value',
    email: 'logger@example.com',
    content: 'x'.repeat(1800)
  })
  const entry = requestLogStore.addLog({
    scope: 'http.response',
    message: 'body check',
    detail: { body: payload }
  })

  assert.equal(entry.detail.body.includes('logger@example.com'), false)
  assert.equal(entry.detail.body.includes('ya29.this-is-a-very-long-access-token-value'), false)
  assert.ok(entry.detail.body.includes('x'.repeat(1200)))
  assert.ok(entry.detail.body.length > 1600)
  assert.equal(entry.detail.body.endsWith('…'), false)

  const rawLine = requestLogStore.listLogs(10)[0].raw
  assert.ok(rawLine.includes('"body":{"access_token":"ya29***alue"'))
  assert.equal(rawLine.includes('\\n'), false)
})

test('requestLogStore 应按当前系统时区写入日志时间', () => {
  resetLogEnvironment()
  const { requestLogStore } = loadLogModules()
  requestLogStore.setEnabled(true)
  requestLogStore.clearLogs()

  const ts = Date.UTC(2026, 3, 12, 8, 9, 10, 123)
  requestLogStore.addLog({
    scope: 'http.response',
    message: 'timezone check',
    detail: { body: '{"ok":true}' },
    ts
  })

  const rawLine = requestLogStore
    .listLogs(5)
    .map(entry => entry.raw || '')
    .find(line => line.includes('timezone check'))
  const expected = formatLocalTimestamp(ts)
  assert.ok(rawLine)
  assert.ok(rawLine.startsWith(expected + ' INFO [http.response]'))
  assert.equal(rawLine.includes('T'), false)
  assert.equal(rawLine.includes('+'), false)
  assert.equal(rawLine.includes('Z INFO [http.response]'), false)
})

test('requestLogStore.listLogs 默认 100 条且支持 500 条窗口', () => {
  resetLogEnvironment()
  const { requestLogStore } = loadLogModules()
  requestLogStore.setEnabled(true)
  requestLogStore.clearLogs()

  for (let idx = 1; idx <= 550; idx++) {
    requestLogStore.addLog({
      scope: 'http.response',
      message: `line-${idx}`,
      detail: { body: `payload-${idx}` }
    })
  }

  assert.equal(requestLogStore.listLogs().length, 100)
  assert.equal(requestLogStore.listLogs(100).length, 100)
  assert.equal(requestLogStore.listLogs(500).length, 500)
})

test('httpClient 应记录完整的 gzip JSON 响应体', async () => {
  resetLogEnvironment()
  const { requestLogStore, httpClient } = loadLogModules()
  requestLogStore.setEnabled(true)
  requestLogStore.clearLogs()

  const tailMarker = 'TAIL_MARKER_123456789'
  const payload = JSON.stringify({
    buckets: Array.from({ length: 40 }, (_, idx) => ({
      modelId: `gemini-model-${idx}`,
      remainingFraction: 1,
      note: `segment-${idx}-${'x'.repeat(40)}`
    })),
    tailMarker
  })

  const server = http.createServer((req, res) => {
    const body = zlib.gzipSync(Buffer.from(payload, 'utf-8'))
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip'
    })
    res.end(body)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = server.address()
    const url = `http://127.0.0.1:${address.port}/quota`
    const result = await httpClient.getJSON(url)

    assert.equal(result.ok, true)
    assert.equal(result.data.tailMarker, tailMarker)

    const responseLine = requestLogStore
      .listLogs(20)
      .map(entry => entry.raw || '')
      .find(line => line.includes('[http.response]') && line.includes('/quota'))

    assert.ok(responseLine)
    assert.ok(responseLine.includes(tailMarker))
    assert.ok(responseLine.includes('"body":{"buckets":['))
    assert.equal(responseLine.includes('\\n'), false)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
})
