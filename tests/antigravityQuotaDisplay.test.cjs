const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadAntigravityUtils () {
  const filePath = path.join(process.cwd(), 'packages/app-shell/src/utils/antigravity.js')
  return import(pathToFileURL(filePath).href)
}

test('getAntigravityQuotaDisplayItems 聚合模式应按三组展示', async () => {
  const { getAntigravityQuotaDisplayItems } = await loadAntigravityUtils()

  const items = getAntigravityQuotaDisplayItems({
    models: [
      { name: 'claude-sonnet-4-6-thinking', percentage: 40, reset_time: '2026-04-15T09:00:00Z' },
      { name: 'claude-opus-4-6-thinking', percentage: 20, reset_time: '2026-04-15T09:00:00Z' },
      { name: 'gpt-oss-120b-medium', percentage: 60, reset_time: '2026-04-15T09:00:00Z' },
      { name: 'gemini-3.1-pro-high', percentage: 20, reset_time: '2026-04-16T10:00:00Z' },
      { name: 'gemini-3.1-pro-low', percentage: 40, reset_time: '2026-04-16T10:00:00Z' },
      { name: 'gemini-3-flash', percentage: 100, reset_time: '2026-04-11T12:00:00Z' }
    ]
  })

  assert.equal(items.length, 3)
  assert.equal(items[0].label, 'Claude')
  assert.equal(items[1].label, 'Gemini 3.1 Pro')
  assert.equal(items[2].label, 'Gemini 3 Flash')
})

test('getAntigravityQuotaDisplayItems 非聚合模式应按 IDE 同款模型项展示', async () => {
  const { getAntigravityQuotaDisplayItems } = await loadAntigravityUtils()

  const items = getAntigravityQuotaDisplayItems({
    models: [
      { name: 'gemini-3.1-pro-high', percentage: 20, reset_time: '2026-04-16T10:00:00Z' },
      { name: 'gemini-3.1-pro-low', percentage: 20, reset_time: '2026-04-16T10:00:00Z' },
      { name: 'gemini-3-flash', percentage: 100, reset_time: '2026-04-11T12:00:00Z' },
      { name: 'gemini-3.1-flash-lite', percentage: 100, reset_time: '2026-04-11T12:00:00Z' },
      { name: 'claude-sonnet-4-6-thinking', percentage: 40, reset_time: '2026-04-15T09:00:00Z' },
      { name: 'claude-opus-4-6-thinking', percentage: 40, reset_time: '2026-04-15T09:00:00Z' },
      { name: 'gpt-oss-120b-medium', percentage: 40, reset_time: '2026-04-15T09:00:00Z' },
      { name: 'chat_23310', percentage: 100, reset_time: '2026-04-11T12:00:00Z' }
    ]
  }, { aggregated: false })

  assert.deepEqual(items.map(item => item.label), [
    'Gemini 3.1 Pro (High)',
    'Gemini 3.1 Pro (Low)',
    'Gemini 3 Flash',
    'Claude Sonnet 4.6 (Thinking)',
    'Claude Opus 4.6 (Thinking)',
    'GPT-OSS 120B (Medium)'
  ])
})
