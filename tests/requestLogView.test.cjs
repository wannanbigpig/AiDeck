const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadRequestLogViewUtils () {
  const filePath = path.join(process.cwd(), 'src/utils/requestLogView.js')
  return import(pathToFileURL(filePath).href)
}

test('mergeLogWindows 应追加最新增量并保留旧窗口', async () => {
  const { mergeLogWindows } = await loadRequestLogViewUtils()
  const current = Array.from({ length: 100 }, (_, idx) => ({ raw: `line-${idx + 1}` }))
  const latest = Array.from({ length: 100 }, (_, idx) => ({ raw: `line-${idx + 51}` }))

  const merged = mergeLogWindows(current, latest)

  assert.equal(merged.appendedCount, 50)
  assert.equal(merged.logs.length, 150)
  assert.equal(merged.logs[0].raw, 'line-1')
  assert.equal(merged.logs[149].raw, 'line-150')
})

test('mergeLogWindows 在超过 500 条时只保留最近窗口', async () => {
  const { mergeLogWindows, MAX_VISIBLE_LOGS } = await loadRequestLogViewUtils()
  const current = Array.from({ length: 500 }, (_, idx) => ({ raw: `line-${idx + 1}` }))
  const latest = Array.from({ length: 100 }, (_, idx) => ({ raw: `line-${idx + 451}` }))

  const merged = mergeLogWindows(current, latest)

  assert.equal(merged.logs.length, MAX_VISIBLE_LOGS)
  assert.equal(merged.logs[0].raw, 'line-51')
  assert.equal(merged.logs[MAX_VISIBLE_LOGS - 1].raw, 'line-550')
})

test('mergeLogWindows 在没有重叠时回退到最新窗口', async () => {
  const { mergeLogWindows } = await loadRequestLogViewUtils()
  const current = Array.from({ length: 120 }, (_, idx) => ({ raw: `line-${idx + 1}` }))
  const latest = Array.from({ length: 100 }, (_, idx) => ({ raw: `line-${idx + 301}` }))

  const merged = mergeLogWindows(current, latest)

  assert.equal(merged.logs.length, 100)
  assert.equal(merged.logs[0].raw, 'line-301')
  assert.equal(merged.logs[99].raw, 'line-400')
})

test('stringifyRequestLogDetail 应将 JSON body 展开为对象输出', async () => {
  const { stringifyRequestLogDetail } = await loadRequestLogViewUtils()
  const text = stringifyRequestLogDetail({
    status: 200,
    body: '{\n  "buckets": [{"modelId": "gemini-2.5-pro"}]\n}'
  })

  assert.equal(text.includes('\\n'), false)
  assert.ok(text.includes('"body":{"buckets":[{"modelId":"gemini-2.5-pro"}]}'))
})

test('formatRequestLogTimestamp 应显示本地时间的毫秒格式', async () => {
  const { formatRequestLogTimestamp } = await loadRequestLogViewUtils()
  const ts = Date.UTC(2026, 3, 12, 8, 9, 10, 123)
  const text = formatRequestLogTimestamp(ts)
  const date = new Date(ts)
  const pad = (num) => String(num).padStart(2, '0')
  const expected = [
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
    String(date.getMilliseconds()).padStart(3, '0')
  ].join('')

  assert.equal(text, expected)
  assert.equal(text.includes('T'), false)
  assert.equal(text.includes('+'), false)
})
