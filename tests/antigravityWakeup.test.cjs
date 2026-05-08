const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const zlib = require('node:zlib')

const antigravity = require(path.join(process.cwd(), 'packages/platforms/src/antigravityService.cjs'))

test('Antigravity 唤醒应构造官方 Cascade 配置', () => {
  const config = antigravity._internal._buildAgClientLikeCascadeConfig({ model: 1001 }, 128)

  assert.deepEqual(config, {
    plannerConfig: {
      requestedModel: { model: 1001 },
      maxOutputTokens: 128
    },
    checkpointConfig: {
      maxOutputTokens: 128
    }
  })
})

test('Antigravity 唤醒应从 Cascade 轨迹提取 plannerResponse', () => {
  const parsed = antigravity._internal._extractAgWakeupResponseFromTrajectory({
    trajectory: {
      steps: [
        { userInput: { text: 'hi' } },
        { plannerResponse: { modifiedResponse: 'pong' } }
      ]
    }
  }, 42)

  assert.deepEqual(parsed, {
    success: true,
    reply: 'pong',
    duration_ms: 42
  })
})

test('Antigravity 唤醒应解析 LanguageServerStarted 端口', () => {
  const body = Buffer.from([0x08, 0xB9, 0x60, 0x10, 0xC0, 0x62, 0x28, 0xC7, 0x64])
  const parsed = antigravity._internal._parseAgOfficialLsStartedRequest(body)

  assert.deepEqual(parsed, {
    httpsPort: 12345,
    lspPort: 12608,
    httpPort: 12871
  })
})

test('Antigravity JSON 响应解析应支持 gzip 压缩体', () => {
  const payload = Buffer.from(JSON.stringify({ ok: true }), 'utf8')
  const decoded = antigravity._internal._decodeAgHttpResponseBody(zlib.gzipSync(payload), 'gzip')

  assert.equal(decoded, '{"ok":true}')
})

test('Antigravity 临时结构化错误应可重试并转为短文案', () => {
  const raw = 'AG_WAKEUP_ERROR_JSON:' + JSON.stringify({
    version: 1,
    kind: 'temporary',
    message: 'Agent execution terminated due to error.',
    error_code: 500,
    trajectory_id: 'trace-1',
    error_message_json: '{"error":true}'
  })
  const payload = antigravity._internal._parseAgWakeupErrorPayload(raw)
  const normalized = antigravity._internal._normalizeAgWakeupErrorForRecord(raw)

  assert.equal(antigravity._internal._isAgWakeupRetryablePayload(payload), true)
  assert.equal(normalized.message, '上游服务临时错误，已重试后仍失败：Agent execution terminated due to error. (code 500)')
  assert.equal(normalized.detail.trajectory_id, 'trace-1')
})

test('Antigravity 唤醒超时应有默认值并限制范围', () => {
  assert.equal(antigravity._internal._normalizeAgWakeupTimeoutMs(), 90000)
  assert.equal(antigravity._internal._normalizeAgWakeupTimeoutMs(1000), 15000)
  assert.equal(antigravity._internal._normalizeAgWakeupTimeoutMs(999999999), 600000)
  assert.equal(antigravity._internal._normalizeAgWakeupTimeoutMs(45000), 45000)
})
