const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function waitForCondition (fn, timeoutMs = 2000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  return null
}

test('Codex 唤醒参数应复用 codex exec 安全参数', () => {
  const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
  const args = codex._internal.buildCodexWakeupArgs({
    prompt: ' hello ',
    model: 'gpt-"demo"',
    reasoningEffort: 'medium',
    outputPath: '/tmp/last.txt',
    workspaceDir: '/tmp/workspace'
  })

  assert.deepEqual(args.slice(0, 5), ['exec', '--skip-git-repo-check', '--ignore-rules', '--color', 'never'])
  assert.equal(args.includes('--ignore-rules'), true)
  assert.equal(args.includes('--output-last-message'), true)
  assert.equal(args.includes('-C'), true)
  assert.equal(args.includes('model="gpt-\\"demo\\""'), true)
  assert.equal(args.includes('model_reasoning_effort="medium"'), true)
  assert.equal(args[args.length - 1], 'hello')

  const defaultModelArgs = codex._internal.buildCodexWakeupArgs({
    prompt: 'hi',
    model: '',
    reasoningEffort: ''
  })
  assert.equal(defaultModelArgs.some(arg => String(arg).includes('model=')), false)
  assert.equal(defaultModelArgs.some(arg => String(arg).includes('model_reasoning_effort=')), false)
})

test('Codex 唤醒任务在 CLI 缺失时应返回每个账号的失败记录', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-wakeup-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()
    const account = storage.addAccount('codex', {
      id: 'codex-wakeup-target',
      email: 'wakeup@example.com',
      tokens: {
        access_token: 'token',
        refresh_token: 'refresh'
      }
    })

    const result = await codex.runWakeupTask({
      command: 'definitely-not-aideck-codex',
      accountIds: [account.id],
      prompt: '',
      model: '',
      reasoningEffort: 'unknown'
    })

    assert.equal(result.success, false)
    assert.equal(result.success_count, 0)
    assert.equal(result.failure_count, 1)
    assert.equal(result.records.length, 1)
    assert.equal(result.records[0].account_email, 'wakeup@example.com')
    assert.equal(result.records[0].prompt, 'hi')
    assert.equal(result.records[0].success, false)
    assert.match(result.records[0].error, /未检测到 codex CLI/)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex 单账号唤醒失败应返回当前账号失败文案', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-wakeup-current-fail-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()
    const account = storage.addAccount('codex', {
      id: 'codex-current-wakeup-target',
      email: 'current-fail@example.com',
      tokens: {
        access_token: 'header.' + Buffer.from('{}').toString('base64url') + '.signature',
        refresh_token: 'refresh'
      }
    })
    const fakeCodex = path.join(root, 'fake-codex')
    fs.writeFileSync(fakeCodex, '#!/bin/sh\necho "fake wakeup failed" >&2\nexit 1\n')
    fs.chmodSync(fakeCodex, 0o755)

    const result = await codex.runWakeupTask({
      command: fakeCodex,
      accountIds: [account.id],
      prompt: 'hi',
      model: 'gpt-5.3-codex',
      reasoningEffort: 'medium'
    })

    assert.equal(result.success, false)
    assert.equal(result.success_count, 0)
    assert.equal(result.failure_count, 1)
    assert.equal(result.error, '当前账号唤醒失败')
    assert.equal(result.records[0].account_email, 'current-fail@example.com')
    assert.match(result.records[0].error, /fake wakeup failed/)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex 唤醒任务应优先使用设置中的自定义 CLI 命令', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-wakeup-custom-cli-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const sharedSettingsStore = require(path.join(process.cwd(), 'packages/infra-node/src/sharedSettingsStore.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()
    const account = storage.addAccount('codex', {
      id: 'codex-custom-cli-target',
      email: 'custom-cli@example.com',
      tokens: {
        access_token: 'header.' + Buffer.from('{}').toString('base64url') + '.signature',
        refresh_token: 'refresh'
      }
    })
    const fakeCodex = path.join(root, 'custom-codex')
    fs.writeFileSync(fakeCodex, '#!/bin/sh\necho "custom cli from settings" >&2\nexit 1\n')
    fs.chmodSync(fakeCodex, 0o755)
    sharedSettingsStore.writeValue('codex_advanced_settings', {
      codexCliPath: fakeCodex
    })

    const result = await codex.runWakeupTask({
      accountIds: [account.id],
      prompt: 'hi',
      model: 'gpt-5.3-codex',
      reasoningEffort: 'medium'
    })

    assert.equal(result.success, false)
    assert.equal(result.failure_count, 1)
    assert.equal(result.records[0].cli_path, fakeCodex)
    assert.match(result.records[0].error, /custom cli from settings/)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex 后台唤醒应立即返回 run_id 并写入最近历史状态', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-wakeup-history-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()
    const account = storage.addAccount('codex', {
      id: 'codex-history-target',
      email: 'history@example.com',
      tokens: {
        access_token: 'token',
        refresh_token: 'refresh'
      }
    })

    const started = await codex.runWakeupTask({
      command: 'definitely-not-aideck-codex',
      commandRuntime: { env: { PATH: '' } },
      accountIds: [account.id],
      prompt: 'hi',
      triggerType: 'manual',
      background: true
    })

    assert.equal(started.running, true)
    assert.match(started.run_id, /^codex-wakeup-/)

    const finished = await waitForCondition(() => {
      const run = codex.getWakeupRun(started.run_id)
      return run.success && run.item.status !== 'running' ? run.item : null
    })
    assert.ok(finished)
    assert.equal(finished.trigger_label, '立即唤醒')
    assert.equal(finished.status, 'error')
    assert.equal(finished.failure_count, 1)
    assert.match(finished.records[0].error, /未检测到 codex CLI/)

    const overview = codex.getWakeupOverview(account.id)
    assert.equal(overview.success, true)
    assert.equal(overview.latest.run_id, started.run_id)
    assert.equal(overview.latest.trigger_label, '立即唤醒')
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex 唤醒不应读取账号实例中的全局 AGENTS.md', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-wakeup-no-agents-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()
    const account = storage.addAccount('codex', {
      id: 'codex-no-agents-target',
      email: 'no-agents@example.com',
      tokens: {
        access_token: 'header.' + Buffer.from('{}').toString('base64url') + '.signature',
        refresh_token: 'refresh'
      }
    })
    const prepared = await codex.prepareCliLaunch(account.id)
    assert.equal(prepared.success, true)
    fs.writeFileSync(path.join(prepared.instanceDir, 'AGENTS.md'), 'global rules should not be read', 'utf8')

    const fakeCodex = path.join(root, 'fake-codex-no-agents')
    fs.writeFileSync(fakeCodex, '#!/bin/sh\nif [ -e "$CODEX_HOME/AGENTS.md" ]; then echo "AGENTS.md exists" >&2; exit 1; fi\nexit 0\n')
    fs.chmodSync(fakeCodex, 0o755)

    const result = await codex.runWakeupTask({
      command: fakeCodex,
      accountIds: [account.id],
      prompt: 'hi',
      model: '',
      reasoningEffort: ''
    })

    assert.equal(result.success, true)
    assert.equal(fs.existsSync(path.join(prepared.instanceDir, 'AGENTS.md')), true)
    const wakeupDir = codex._internal.buildCodexWakeupInstanceDir(account.id)
    assert.notEqual(wakeupDir, prepared.instanceDir)
    assert.equal(fs.existsSync(path.join(wakeupDir, 'AGENTS.md')), false)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex 会话管理应单独显示唤醒会话来源区', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-wakeup-sessions-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()
    const account = storage.addAccount('codex', {
      id: 'codex-wakeup-session-target',
      email: 'wakeup-session@example.com',
      tokens: {
        access_token: 'token',
        refresh_token: 'refresh'
      }
    })
    const secondAccount = storage.addAccount('codex', {
      id: 'codex-wakeup-session-second',
      email: 'wakeup-second@example.com',
      tokens: {
        access_token: 'token-2',
        refresh_token: 'refresh-2'
      }
    })
    const wakeupDir = codex._internal.buildCodexWakeupInstanceDir(account.id)
    const sessionPath = path.join(wakeupDir, 'sessions', '2026', '04', '29', 'rollout-wakeup-session.jsonl')
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, JSON.stringify({ type: 'metadata', cwd: path.join(wakeupDir, 'wakeup-workspace'), title: '唤醒测试' }) + '\n', 'utf8')
    fs.writeFileSync(path.join(wakeupDir, 'session_index.jsonl'), JSON.stringify({
      id: 'wakeup-session',
      title: '唤醒测试',
      cwd: path.join(wakeupDir, 'wakeup-workspace'),
      rollout_path: sessionPath,
      updated_at_ms: 1777372800000
    }) + '\n', 'utf8')
    const secondWakeupDir = codex._internal.buildCodexWakeupInstanceDir(secondAccount.id)
    const secondSessionPath = path.join(secondWakeupDir, 'sessions', '2026', '04', '29', 'rollout-wakeup-session-second.jsonl')
    fs.mkdirSync(path.dirname(secondSessionPath), { recursive: true })
    fs.writeFileSync(secondSessionPath, JSON.stringify({ type: 'metadata', cwd: path.join(secondWakeupDir, 'wakeup-workspace'), title: '唤醒测试 2' }) + '\n', 'utf8')
    fs.writeFileSync(path.join(secondWakeupDir, 'session_index.jsonl'), JSON.stringify({
      id: 'wakeup-session-second',
      title: '唤醒测试 2',
      cwd: path.join(secondWakeupDir, 'wakeup-workspace'),
      rollout_path: secondSessionPath,
      updated_at_ms: 1777372810000
    }) + '\n', 'utf8')

    const result = codex.listCliSessions({ includeDefaultHome: false })
    assert.equal(result.success, true)
    const wakeupAccount = result.accounts.find(item => item.sourceType === 'wakeup')
    assert.ok(wakeupAccount)
    assert.equal(wakeupAccount.sourceName, 'wakeup-session@example.com 唤醒会话')
    const wakeupGroups = result.groups.filter(group => group.workspaceName === '唤醒会话')
    assert.equal(wakeupGroups.length, 1)
    const wakeupGroup = wakeupGroups[0]
    assert.ok(wakeupGroup)
    assert.equal(wakeupGroup.workspacePath, '')
    assert.equal(wakeupGroup.sessions.length, 2)
    assert.equal(wakeupGroup.sessions.every(session => session.sourceType === 'wakeup'), true)
    assert.equal(wakeupGroup.sessions.some(session => session.sourceName === 'wakeup-session@example.com 唤醒会话'), true)
    assert.equal(wakeupGroup.sessions.some(session => session.sourceName === 'wakeup-second@example.com 唤醒会话'), true)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex 单账号唤醒配置应支持保存、读取、删除和到点触发', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-wakeup-schedule-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()
    const account = storage.addAccount('codex', {
      id: 'codex-scheduled-target',
      email: 'scheduled@example.com',
      tokens: {
        access_token: 'token',
        refresh_token: 'refresh'
      }
    })

    const saved = codex.saveWakeupSchedule(account.id, {
      enabled: true,
      daily_time: '8:05',
      prompt: 'wake',
      model: 'gpt-5.3-codex',
      reasoning_effort: 'high'
    })
    assert.equal(saved.success, true)
    assert.equal(saved.schedule.account_id, account.id)
    assert.equal(saved.schedule.schedule_kind, 'daily')
    assert.equal(saved.schedule.daily_time, '08:05')
    assert.equal(saved.schedule.reasoning_effort, 'high')

    const loaded = codex.getWakeupSchedule(account.id)
    assert.equal(loaded.success, true)
    assert.equal(loaded.schedule.account_email, 'scheduled@example.com')
    assert.equal(loaded.schedule.enabled, true)

    const dueAt = new Date(2026, 3, 28, 8, 6, 0, 0).getTime()
    assert.equal(codex._internal.isCodexWakeupScheduleDue(loaded.schedule, dueAt), true)
    const due = await codex.runDueWakeupSchedules(dueAt, {
      command: 'definitely-not-aideck-codex',
      commandRuntime: { env: { PATH: '' } }
    })
    assert.equal(due.success, true)
    assert.equal(due.due_count, 1)
    assert.equal(due.results.length, 1)

    const afterRun = codex.getWakeupSchedule(account.id)
    assert.equal(afterRun.schedule.last_status, 'error')
    assert.match(afterRun.schedule.last_message, /未检测到 codex CLI/)
    assert.equal(codex._internal.isCodexWakeupScheduleDue(afterRun.schedule, dueAt), false)

    const deleted = codex.deleteWakeupSchedule(account.id)
    assert.equal(deleted.success, true)
    assert.equal(codex.listWakeupSchedules().length, 0)

    codex.saveWakeupSchedule(account.id, {
      enabled: true,
      daily_time: '09:15',
      prompt: 'wake'
    })
    assert.equal(codex.listWakeupSchedules().length, 1)
    assert.equal(codex.deleteAccount(account.id), true)
    assert.equal(codex.listWakeupSchedules().length, 0)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex 唤醒调度模式应支持停用、每周、间隔和配额重置', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aideck-codex-wakeup-modes-'))
  const previousDataDir = process.env.AIDECK_DATA_DIR
  process.env.AIDECK_DATA_DIR = root

  try {
    const storage = require(path.join(process.cwd(), 'packages/infra-node/src/accountStorage.cjs'))
    const codex = require(path.join(process.cwd(), 'packages/platforms/src/codexService.impl.cjs'))
    storage.initStorage()
    const account = storage.addAccount('codex', {
      id: 'codex-schedule-mode-target',
      email: 'modes@example.com',
      tokens: {
        access_token: 'token',
        refresh_token: 'refresh'
      },
      quota: {
        hourly_reset_time: new Date(2026, 3, 28, 10, 0, 0, 0).getTime() / 1000,
        weekly_reset_time: new Date(2026, 3, 30, 10, 0, 0, 0).getTime() / 1000
      }
    })

    const weekly = codex.saveWakeupSchedule(account.id, {
      enabled: true,
      schedule_kind: 'weekly',
      weekly_days: [2],
      weekly_time: '10:15',
      prompt: 'weekly'
    })
    assert.equal(weekly.success, true)
    assert.equal(weekly.schedule.schedule_kind, 'weekly')
    assert.deepEqual(weekly.schedule.weekly_days, [2])
    assert.equal(codex._internal.isCodexWakeupScheduleDue(weekly.schedule, new Date(2026, 3, 28, 10, 16, 0, 0).getTime()), true)
    assert.equal(codex._internal.isCodexWakeupScheduleDue(weekly.schedule, new Date(2026, 3, 29, 10, 16, 0, 0).getTime()), false)

    const disabled = codex.saveWakeupSchedule(account.id, {
      enabled: false,
      schedule_kind: 'weekly',
      weekly_days: [2],
      weekly_time: '10:15'
    })
    assert.equal(disabled.success, true)
    assert.equal(codex._internal.isCodexWakeupScheduleDue(disabled.schedule, new Date(2026, 3, 28, 10, 16, 0, 0).getTime()), false)

    const interval = codex.saveWakeupSchedule(account.id, {
      enabled: true,
      schedule_kind: 'interval',
      interval_hours: 2,
      last_run_at: new Date(2026, 3, 28, 8, 0, 0, 0).getTime()
    })
    assert.equal(interval.success, true)
    assert.equal(interval.schedule.interval_hours, 2)
    assert.equal(codex._internal.isCodexWakeupScheduleDue(interval.schedule, new Date(2026, 3, 28, 9, 59, 0, 0).getTime()), false)
    assert.equal(codex._internal.isCodexWakeupScheduleDue(interval.schedule, new Date(2026, 3, 28, 10, 0, 0, 0).getTime()), true)

    const quotaReset = codex.saveWakeupSchedule(account.id, {
      enabled: true,
      schedule_kind: 'quota_reset',
      quota_reset_window: 'primary_window',
      last_run_at: new Date(2026, 3, 28, 9, 0, 0, 0).getTime()
    })
    assert.equal(quotaReset.success, true)
    assert.equal(quotaReset.schedule.quota_reset_window, 'primary_window')
    assert.equal(codex._internal.isCodexWakeupScheduleDue(quotaReset.schedule, new Date(2026, 3, 28, 9, 59, 0, 0).getTime()), false)
    assert.equal(codex._internal.isCodexWakeupScheduleDue(quotaReset.schedule, new Date(2026, 3, 28, 10, 0, 0, 0).getTime()), true)
  } finally {
    if (previousDataDir == null) delete process.env.AIDECK_DATA_DIR
    else process.env.AIDECK_DATA_DIR = previousDataDir
    fs.rmSync(root, { recursive: true, force: true })
  }
})
