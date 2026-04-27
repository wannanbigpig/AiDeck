const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function withTempAnnouncementEnv (payload, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-ann-'))
  const filePath = path.join(dir, 'announcements.json')
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
  const oldDataDir = process.env.AIDECK_DATA_DIR
  const oldFile = process.env.AIDECK_ANNOUNCEMENT_FILE
  process.env.AIDECK_DATA_DIR = path.join(dir, 'data')
  process.env.AIDECK_ANNOUNCEMENT_FILE = filePath
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (oldDataDir == null) delete process.env.AIDECK_DATA_DIR
      else process.env.AIDECK_DATA_DIR = oldDataDir
      if (oldFile == null) delete process.env.AIDECK_ANNOUNCEMENT_FILE
      else process.env.AIDECK_ANNOUNCEMENT_FILE = oldFile
      fs.rmSync(dir, { recursive: true, force: true })
    })
}

function withTempEnv (values, fn) {
  const oldValues = {}
  Object.keys(values).forEach(key => {
    oldValues[key] = process.env[key]
    if (values[key] == null) delete process.env[key]
    else process.env[key] = values[key]
  })
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.keys(values).forEach(key => {
        if (oldValues[key] == null) delete process.env[key]
        else process.env[key] = oldValues[key]
      })
    })
}

test('announcementService 应过滤公告并返回未读弹窗项', async () => {
  const service = require(path.join(process.cwd(), 'packages/infra-node/src/announcementService.cjs'))
  await withTempAnnouncementEnv({
    version: '1.0',
    announcements: [
      {
        id: 'ann-visible',
        type: 'info',
        title: 'Hello',
        summary: 'Summary',
        content: 'Content',
        version: '1.0.2',
        releaseStatus: 'reviewing',
        marketVersion: '1.0.1',
        targetVersions: '>=1.0.0',
        targetLanguages: ['zh-CN'],
        popup: true,
        createdAt: '2026-04-27T00:00:00Z'
      },
      {
        id: 'ann-hidden',
        type: 'info',
        title: 'Hidden',
        targetVersions: '<1.0.0',
        targetLanguages: ['zh-CN'],
        popup: true,
        createdAt: '2026-04-27T00:00:00Z'
      }
    ]
  }, async () => {
    const state = await service.getAnnouncementState({ version: '1.0.1', locale: 'zh-CN' })
    assert.equal(state.announcements.length, 1)
    assert.equal(state.announcements[0].id, 'ann-visible')
    assert.equal(state.announcements[0].version, '1.0.2')
    assert.equal(state.announcements[0].releaseStatus, 'reviewing')
    assert.equal(state.announcements[0].marketVersion, '1.0.1')
    assert.deepEqual(state.unreadIds, ['ann-visible'])
    assert.equal(state.popupAnnouncement.id, 'ann-visible')
  })
})

test('announcementService 应支持标记已读和全部已读', async () => {
  const service = require(path.join(process.cwd(), 'packages/infra-node/src/announcementService.cjs'))
  await withTempAnnouncementEnv({
    version: '1.0',
    announcements: [
      {
        id: 'ann-a',
        type: 'info',
        title: 'A',
        targetVersions: '*',
        targetLanguages: ['*'],
        popup: true,
        createdAt: '2026-04-27T00:00:00Z'
      },
      {
        id: 'ann-b',
        type: 'feature',
        title: 'B',
        targetVersions: '*',
        targetLanguages: ['*'],
        popup: false,
        createdAt: '2026-04-26T00:00:00Z'
      }
    ]
  }, async () => {
    await service.markAnnouncementAsRead('ann-a')
    let state = await service.getAnnouncementState({ version: '1.0.1', locale: 'zh-CN' })
    assert.deepEqual(state.unreadIds, ['ann-b'])
    assert.equal(state.popupAnnouncement, null)

    await service.markAllAnnouncementsAsRead({ version: '1.0.1', locale: 'zh-CN' })
    state = await service.getAnnouncementState({ version: '1.0.1', locale: 'zh-CN' })
    assert.deepEqual(state.unreadIds, [])
  })
})

test('announcementService 应在开发环境默认读取仓库根公告文件', async () => {
  const service = require(path.join(process.cwd(), 'packages/infra-node/src/announcementService.cjs'))
  await withTempEnv({
    AIDECK_ANNOUNCEMENT_FILE: null,
    AIDECK_ANNOUNCEMENT_DEV_LOCAL: null
  }, async () => {
    const localFile = service.getLocalAnnouncementFile()
    assert.equal(localFile, path.join(process.cwd(), 'announcements.json'))
    const state = await service.getAnnouncementState({ version: '1.0.1', locale: 'zh-CN' })
    assert.ok(state.announcements.some(item => item.id === 'ann-2026-04-aideck-1-0-2-update'))
  })
})

test('announcementService 应识别 uTools dist preload 开发路径', () => {
  const service = require(path.join(process.cwd(), 'packages/infra-node/src/announcementService.cjs'))
  assert.equal(service.isDevelopmentRuntime(path.join(process.cwd(), 'dist/preload')), true)
})

test('announcementService 应将 GitHub blob 公告地址转换为 raw 地址', () => {
  const service = require(path.join(process.cwd(), 'packages/infra-node/src/announcementService.cjs'))
  assert.equal(
    service.normalizeAnnouncementUrl('https://github.com/wannanbigpig/AiDeck/blob/main/announcements.json'),
    'https://raw.githubusercontent.com/wannanbigpig/AiDeck/main/announcements.json'
  )
})

test('announcementService 远程失败时应回退到随包公告文件', async () => {
  const service = require(path.join(process.cwd(), 'packages/infra-node/src/announcementService.cjs'))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-bundled-ann-'))
  const bundledFile = path.join(dir, 'announcements.json')
  fs.writeFileSync(bundledFile, JSON.stringify({
    version: '1.0',
    announcements: [
      {
        id: 'bundled-ann',
        type: 'info',
        title: 'Bundled',
        targetVersions: '*',
        targetLanguages: ['*'],
        createdAt: '2026-04-27T00:00:00Z'
      }
    ]
  }))

  try {
    await withTempEnv({
      AIDECK_DATA_DIR: path.join(dir, 'data'),
      AIDECK_ANNOUNCEMENT_FILE: null,
      AIDECK_ANNOUNCEMENT_DEV_LOCAL: '0',
      AIDECK_ANNOUNCEMENT_URL: 'file:///not-found-aideck-announcements.json',
      AIDECK_BUNDLED_ANNOUNCEMENT_FILE: bundledFile
    }, async () => {
      const state = await service.forceRefreshAnnouncements({ version: '1.0.2', locale: 'zh-CN' })
      assert.equal(state.announcements.length, 1)
      assert.equal(state.announcements[0].id, 'bundled-ann')
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('announcementService 应置顶优先并按发布时间倒序排序', async () => {
  const service = require(path.join(process.cwd(), 'packages/infra-node/src/announcementService.cjs'))
  const list = service.filterAnnouncements([
    {
      id: 'normal-new',
      type: 'info',
      title: 'normal-new',
      targetVersions: '*',
      targetLanguages: ['*'],
      createdAt: '2026-04-29T00:00:00Z'
    },
    {
      id: 'pinned-old',
      type: 'info',
      title: 'pinned-old',
      targetVersions: '*',
      targetLanguages: ['*'],
      pinned: true,
      createdAt: '2026-04-27T00:00:00Z'
    },
    {
      id: 'pinned-new',
      type: 'info',
      title: 'pinned-new',
      targetVersions: '*',
      targetLanguages: ['*'],
      pinned: true,
      createdAt: '2026-04-28T00:00:00Z'
    },
    {
      id: 'normal-old',
      type: 'info',
      title: 'normal-old',
      targetVersions: '*',
      targetLanguages: ['*'],
      createdAt: '2026-04-26T00:00:00Z'
    }
  ], { version: '1.0.1', locale: 'zh-CN' })

  assert.deepEqual(list.map(item => item.id), ['pinned-new', 'pinned-old', 'normal-new', 'normal-old'])
})

test('announcementService 应按当前语言应用本地化公告内容', () => {
  const service = require(path.join(process.cwd(), 'packages/infra-node/src/announcementService.cjs'))
  const list = service.filterAnnouncements([
    {
      id: 'localized',
      type: 'feature',
      title: '默认标题',
      summary: '默认摘要',
      content: '默认正文',
      version: '1.0.2',
      action: {
        type: 'url',
        target: 'https://example.com',
        label: '打开'
      },
      targetVersions: '*',
      targetLanguages: ['*'],
      locales: {
        'en-US': {
          title: 'English title',
          summary: 'English summary',
          content: 'English content',
          actionLabel: 'Open'
        }
      },
      createdAt: '2026-04-27T00:00:00Z'
    }
  ], { version: '1.0.1', locale: 'en' })

  assert.equal(list.length, 1)
  assert.equal(list[0].title, 'English title')
  assert.equal(list[0].summary, 'English summary')
  assert.equal(list[0].content, 'English content')
  assert.equal(list[0].version, '1.0.2')
  assert.equal(list[0].action.label, 'Open')
})
