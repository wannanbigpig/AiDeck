const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadGeminiUtils () {
  const filePath = path.join(process.cwd(), 'packages/app-shell/src/utils/gemini.js')
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

test('getGeminiQuotaDisplayGroups 按 pro 和 flash 聚合并保留明细', async () => {
  const { getGeminiQuotaDisplayGroups } = await loadGeminiUtils()

  const groups = getGeminiQuotaDisplayGroups({
    models: [
      {
        name: 'gemini-2.5-pro',
        percentage: 75,
        reset_time: '2026-04-12T10:00:00Z',
        requests_left: 75,
        requests_limit: 100
      },
      {
        name: 'gemini-2.5-pro-preview',
        percentage: 80,
        reset_time: '2026-04-12T11:00:00Z'
      },
      {
        name: 'gemini-2.5-flash',
        percentage: 90,
        reset_time: '2026-04-12T08:00:00Z'
      }
    ]
  })

  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0], {
    key: 'pro',
    label: 'Pro',
    percentage: 75,
    resetTime: 1775988000,
    items: [
      {
        key: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        percentage: 75,
        resetTime: 1775988000,
        requestsLeft: 75,
        requestsLimit: 100
      },
      {
        key: 'gemini-2.5-pro-preview',
        label: 'Gemini 2.5 Pro Preview',
        percentage: 80,
        resetTime: 1775991600,
        requestsLeft: null,
        requestsLimit: null
      }
    ]
  })
  assert.deepEqual(groups[1], {
    key: 'flash',
    label: 'Flash',
    percentage: 90,
    resetTime: 1775980800,
    items: [
      {
        key: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        percentage: 90,
        resetTime: 1775980800,
        requestsLeft: null,
        requestsLimit: null
      }
    ]
  })
})

test('getGeminiQuotaDisplayGroups 明细总数最多展示 6 条', async () => {
  const { getGeminiQuotaDisplayGroups } = await loadGeminiUtils()

  const groups = getGeminiQuotaDisplayGroups({
    models: [
      { name: 'gemini-2.5-flash', percentage: 90, reset_time: 1775980800 },
      { name: 'gemini-2.5-flash-lite', percentage: 88, reset_time: 1775980800 },
      { name: 'gemini-3-flash-preview', percentage: 87, reset_time: 1775980800 },
      { name: 'gemini-3.1-flash-lite-preview', percentage: 86, reset_time: 1775980800 },
      { name: 'gemini-2.5-pro', percentage: 75, reset_time: 1775988000 },
      { name: 'gemini-3.1-pro-preview', percentage: 74, reset_time: 1775988000 },
      { name: 'gemini-9-pro-preview', percentage: 73, reset_time: 1775988000 }
    ]
  })

  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0)
  assert.equal(totalItems, 6)
  assert.equal(groups[0].items.length, 2)
  assert.equal(groups[1].items.length, 4)
  assert.equal(groups[0].items.some(item => item.key === 'gemini-9-pro-preview'), false)
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
