const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadGeminiUtils () {
  const filePath = path.join(process.cwd(), 'src/utils/gemini.js')
  return import(pathToFileURL(filePath).href)
}

test('getGeminiQuotaDisplayItems 优先展示真实模型 bucket 配额', async () => {
  const { getGeminiQuotaDisplayItems } = await loadGeminiUtils()

  const items = getGeminiQuotaDisplayItems({
    models: [
      {
        name: 'gemini-2.5-pro',
        percentage: 75,
        reset_time: '2026-04-12T10:00:00Z',
        requests_left: 75,
        requests_limit: 100
      },
      {
        name: 'gemini-2.5-flash',
        percentage: 90,
        reset_time: '2026-04-12T08:00:00Z'
      }
    ]
  })

  assert.equal(items.length, 2)
  assert.deepEqual(items[0], {
    key: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    percentage: 90,
    resetTime: 1775980800,
    requestsLeft: null,
    requestsLimit: null
  })
  assert.deepEqual(items[1], {
    key: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    percentage: 75,
    resetTime: 1775988000,
    requestsLeft: 75,
    requestsLimit: 100
  })
})

test('getGeminiQuotaDisplayItems 在无模型 bucket 时回退旧字段', async () => {
  const { getGeminiQuotaDisplayItems } = await loadGeminiUtils()

  const items = getGeminiQuotaDisplayItems({
    hourly_percentage: 88,
    hourly_reset_time: 1775988000,
    weekly_percentage: 66,
    weekly_reset_time: 1776506400
  })

  assert.equal(items.length, 3)
  assert.equal(items[0].key, 'hourly')
  assert.equal(items[1].key, 'weekly')
  assert.equal(items[2].key, 'code-review')
  assert.equal(items[2].percentage, 66)
  assert.equal(items[2].resetTime, 1776506400)
})
