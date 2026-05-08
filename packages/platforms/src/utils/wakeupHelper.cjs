/**
 * wakeupHelper.cjs — 通用唤醒调度基础设施
 *
 * 提供唤醒调度存储、历史记录、定时器等通用功能，
 * 各平台服务只需提供平台特定的任务执行逻辑即可。
 */

const path = require('path')
const fileUtils = require('../../../infra-node/src/fileUtils.cjs')
const storage = require('../../../infra-node/src/accountStorage.cjs')
const dataRoot = require('../../../infra-node/src/dataRoot.cjs')
const requestLogger = require('../../../infra-node/src/requestLogStore.cjs')

const SCHEDULER_INTERVAL_MS = 60 * 1000
const HISTORY_LIMIT = 100
const BACKGROUND_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_PROMPT = 'hi'
const DEFAULT_DAILY_TIME = '09:00'
const DEFAULT_SCHEDULE_KIND = 'daily'
const DEFAULT_WEEKLY_DAYS = [1]
const DEFAULT_INTERVAL_HOURS = 4
const ALLOWED_SCHEDULE_KINDS = new Set(['daily', 'weekly', 'interval', 'quota_reset', 'startup'])
const ALLOWED_QUOTA_RESET_WINDOWS = new Set(['either', 'primary_window', 'secondary_window'])

// ─── 归一化 ───

function normalizeScheduleKind (value) {
  const text = String(value || '').trim()
  return ALLOWED_SCHEDULE_KINDS.has(text) ? text : DEFAULT_SCHEDULE_KIND
}

function normalizeDailyTime (value) {
  const text = String(value || '').trim()
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const parts = text.split(':')
    return String(parts[0]).padStart(2, '0') + ':' + parts[1]
  }
  return DEFAULT_DAILY_TIME
}

function normalizeWeeklyDays (value) {
  const raw = Array.isArray(value) ? value : []
  const days = Array.from(new Set(raw.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)))
  return days.length > 0 ? days : [1]
}

function normalizeIntervalHours (value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 1 && n <= 24 ? Math.floor(n) : DEFAULT_INTERVAL_HOURS
}

function normalizeQuotaResetWindow (value) {
  const text = String(value || '').trim()
  return ALLOWED_QUOTA_RESET_WINDOWS.has(text) ? text : 'either'
}

function normalizeStartupDelayMinutes (value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.floor(n), 24 * 60)
}

function normalizePrompt (value) {
  return String(value || DEFAULT_PROMPT).trim() || DEFAULT_PROMPT
}

function normalizeTriggerType (value, fallback) {
  const raw = String(value || fallback || 'manual').trim()
  if (['manual', 'daily', 'weekly', 'interval', 'quota_reset', 'startup'].includes(raw)) return raw
  if (raw === 'scheduled') return 'daily'
  return 'manual'
}

function resolveTriggerLabel (triggerType) {
  const type = normalizeTriggerType(triggerType)
  if (type === 'daily') return '每日定时'
  if (type === 'weekly') return '每周定时'
  if (type === 'interval') return '间隔触发'
  if (type === 'quota_reset') return '配额重置触发'
  if (type === 'startup') return '启动后触发'
  return '立即唤醒'
}

// ─── 时间计算 ───

function buildDateAtTime (nowMs, timeStr) {
  const now = new Date(nowMs)
  const parts = String(timeStr || DEFAULT_DAILY_TIME).split(':')
  const hours = Number(parts[0] || 0)
  const minutes = Number(parts[1] || 0)
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0)
}

function buildScheduleRunKey (schedule, nowMs) {
  const kind = schedule.schedule_kind
  const date = new Date(nowMs)
  const dateStr = date.toISOString().slice(0, 10)
  if (kind === 'daily') return 'daily:' + dateStr
  if (kind === 'weekly') return 'weekly:' + dateStr + ':' + date.getDay()
  if (kind === 'interval') return 'interval:' + dateStr + ':' + Math.floor(nowMs / (schedule.interval_hours * 3600000))
  if (kind === 'quota_reset') return 'quota_reset:' + dateStr
  if (kind === 'startup') return 'startup:' + dateStr
  return 'manual:' + dateStr
}

function computeNextRunAt (schedule, nowMs) {
  if (!schedule || schedule.enabled !== true) return 0
  const kind = schedule.schedule_kind
  const lastRunAt = Number(schedule.last_run_at || 0) || 0

  if (kind === 'daily') {
    const candidate = buildDateAtTime(nowMs, schedule.daily_time).getTime()
    if (candidate > nowMs) return candidate
    const tomorrow = new Date(nowMs + 24 * 60 * 60 * 1000)
    return buildDateAtTime(tomorrow.getTime(), schedule.daily_time).getTime()
  }
  if (kind === 'weekly') {
    for (let offset = 0; offset < 8; offset++) {
      const d = new Date(nowMs + offset * 24 * 60 * 60 * 1000)
      if ((schedule.weekly_days || []).includes(d.getDay())) {
        const candidate = buildDateAtTime(d.getTime(), schedule.weekly_time || schedule.daily_time).getTime()
        if (candidate > nowMs || (candidate <= nowMs && lastRunAt < candidate)) return candidate
      }
    }
    return 0
  }
  if (kind === 'interval') {
    const base = lastRunAt || schedule.created_at || nowMs
    const intervalMs = schedule.interval_hours * 60 * 60 * 1000
    let next = base + intervalMs
    while (next <= nowMs) next += intervalMs
    return next
  }
  return 0
}

function getScheduleDueAt (schedule, nowMs, getQuotaResetTimes) {
  if (!schedule || schedule.enabled !== true || !schedule.account_id) return 0
  const kind = schedule.schedule_kind
  const lastRunAt = Number(schedule.last_run_at || 0) || 0

  if (kind === 'weekly') {
    const now = new Date(nowMs)
    if (!(schedule.weekly_days || []).includes(now.getDay())) return 0
    const candidate = buildDateAtTime(nowMs, schedule.weekly_time || schedule.daily_time).getTime()
    return candidate <= nowMs && lastRunAt < candidate ? candidate : 0
  }
  if (kind === 'interval') {
    const dueAt = (lastRunAt || schedule.created_at || nowMs) + schedule.interval_hours * 60 * 60 * 1000
    return dueAt <= nowMs ? dueAt : 0
  }
  if (kind === 'quota_reset') {
    if (typeof getQuotaResetTimes === 'function') {
      return getQuotaResetTimes(schedule)
        .filter(v => v <= nowMs && v > lastRunAt)
        .pop() || 0
    }
    return 0
  }
  if (kind === 'startup') return 0
  const candidate = buildDateAtTime(nowMs, schedule.daily_time).getTime()
  return candidate <= nowMs && lastRunAt < candidate ? candidate : 0
}

// ─── 调度存储 ───

function normalizeSchedule (raw, nowMs, platformDefaults) {
  const item = raw && typeof raw === 'object' ? raw : {}
  const accountId = String(item.account_id || item.accountId || '').trim()
  if (!accountId) return null
  const scheduleKind = normalizeScheduleKind(item.schedule_kind || item.scheduleKind || item.kind)
  const schedule = {
    account_id: accountId,
    enabled: item.enabled === true,
    schedule_kind: scheduleKind,
    daily_time: normalizeDailyTime(item.daily_time || item.dailyTime),
    weekly_days: normalizeWeeklyDays(item.weekly_days || item.weeklyDays),
    weekly_time: normalizeDailyTime(item.weekly_time || item.weeklyTime || item.daily_time || item.dailyTime),
    interval_hours: normalizeIntervalHours(item.interval_hours || item.intervalHours),
    quota_reset_window: normalizeQuotaResetWindow(item.quota_reset_window || item.quotaResetWindow),
    startup_delay_minutes: normalizeStartupDelayMinutes(item.startup_delay_minutes || item.startupDelayMinutes),
    prompt: normalizePrompt(item.prompt),
    model: String(item.model || platformDefaults.model || '').trim(),
    reasoning_effort: String(item.reasoning_effort || item.reasoningEffort || platformDefaults.reasoningEffort || '').trim(),
    created_at: Number(item.created_at || item.createdAt || nowMs) || nowMs,
    updated_at: Number(item.updated_at || item.updatedAt || nowMs) || nowMs,
    last_run_at: Number(item.last_run_at || item.lastRunAt || 0) || 0,
    last_run_key: String(item.last_run_key || item.lastRunKey || '').trim(),
    last_status: String(item.last_status || item.lastStatus || '').trim(),
    last_message: String(item.last_message || item.lastMessage || '').trim(),
    last_success_count: Number(item.last_success_count || item.lastSuccessCount || 0) || 0,
    last_failure_count: Number(item.last_failure_count || item.lastFailureCount || 0) || 0
  }
  schedule.next_run_at = schedule.enabled ? computeNextRunAt(schedule, nowMs) : 0
  return schedule
}

function readScheduleMap (filePath, nowMs, platformDefaults) {
  let raw = null
  try { raw = fileUtils.readJsonFile(filePath) } catch {}
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.schedules) ? raw.schedules : [])
  const map = new Map()
  for (const item of items) {
    const schedule = normalizeSchedule(item, nowMs, platformDefaults)
    if (schedule) map.set(schedule.account_id, schedule)
  }
  return map
}

function writeScheduleMap (filePath, map, platformDefaults) {
  const schedules = Array.from(map.values())
    .map(item => normalizeSchedule(item, Date.now(), platformDefaults))
    .filter(Boolean)
    .sort((a, b) => String(a.schedule_kind).localeCompare(String(b.schedule_kind)) || String(a.daily_time).localeCompare(String(b.daily_time)) || String(a.account_id).localeCompare(String(b.account_id)))
  fileUtils.ensureDir(path.dirname(filePath))
  return fileUtils.writeJsonFile(filePath, { version: 1, schedules })
}

function withAccountMeta (schedule, platform) {
  if (!schedule) return null
  const account = storage.getAccount(platform, schedule.account_id)
  return Object.assign({}, schedule, {
    account_email: account ? String(account.email || account.id || '') : '',
    account_exists: !!account
  })
}

// ─── 历史记录 ───

function readHistoryItems (filePath) {
  let raw = null
  try { raw = fileUtils.readJsonFile(filePath) } catch {}
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : [])
  return items
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const startedAt = Number(item.started_at || item.startedAt || item.timestamp || 0) || 0
      const status = String(item.status || '').trim() || (item.success ? 'success' : 'error')
      const staleRunning = status === 'running' && startedAt > 0 && Date.now() - startedAt > BACKGROUND_TIMEOUT_MS
      return Object.assign({}, item, {
        run_id: String(item.run_id || item.runId || '').trim(),
        status: staleRunning ? 'error' : status,
        trigger_type: normalizeTriggerType(item.trigger_type || item.triggerType),
        trigger_label: String(item.trigger_label || item.triggerLabel || '').trim() || resolveTriggerLabel(item.trigger_type || item.triggerType),
        account_ids: Array.isArray(item.account_ids || item.accountIds) ? (item.account_ids || item.accountIds).map(id => String(id || '').trim()).filter(Boolean) : [],
        records: Array.isArray(item.records) ? item.records : [],
        started_at: startedAt,
        finished_at: Number(item.finished_at || item.finishedAt || 0) || 0,
        duration_ms: Number(item.duration_ms || item.durationMs || 0) || 0,
        success_count: Number(item.success_count || item.successCount || 0) || 0,
        failure_count: Number(item.failure_count || item.failureCount || 0) || 0,
        error: staleRunning ? '唤醒任务未正常结束' : (item.error || null),
        next_run_at: Number(item.next_run_at || item.nextRunAt || 0) || 0
      })
    })
    .filter(item => item.run_id)
}

function writeHistoryItems (filePath, items) {
  fileUtils.ensureDir(path.dirname(filePath))
  const normalized = (Array.isArray(items) ? items : [])
    .filter(item => item && item.run_id)
    .sort((a, b) => Number(b.started_at || 0) - Number(a.started_at || 0))
    .slice(0, HISTORY_LIMIT)
  return fileUtils.writeJsonFile(filePath, { version: 1, items: normalized })
}

function buildHistoryItem (payload) {
  const startedAt = Number(payload.startedAt || Date.now()) || Date.now()
  const finishedAt = Number(payload.finishedAt || 0) || 0
  const triggerType = normalizeTriggerType(payload.triggerType)
  return {
    run_id: String(payload.runId || '').trim(),
    status: String(payload.status || 'running').trim(),
    phase: String(payload.phase || '').trim(),
    trigger_type: triggerType,
    trigger_label: resolveTriggerLabel(triggerType),
    account_ids: Array.isArray(payload.accountIds) ? payload.accountIds.map(id => String(id || '').trim()).filter(Boolean) : [],
    account_email: String(payload.accountEmail || '').trim(),
    prompt: payload.prompt,
    model: payload.model || '',
    model_reasoning_effort: payload.reasoningEffort || '',
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Number(payload.durationMs || (finishedAt ? finishedAt - startedAt : 0)) || 0,
    success_count: Number(payload.successCount || 0) || 0,
    failure_count: Number(payload.failureCount || 0) || 0,
    records: Array.isArray(payload.records) ? payload.records : [],
    error: payload.error || null,
    next_run_at: Number(payload.nextRunAt || 0) || 0
  }
}

function upsertHistoryItem (filePath, item) {
  if (!item || !item.run_id) return null
  const items = readHistoryItems(filePath).filter(existing => existing.run_id !== item.run_id)
  const normalized = Object.assign({}, item, {
    trigger_type: normalizeTriggerType(item.trigger_type),
    trigger_label: item.trigger_label || resolveTriggerLabel(item.trigger_type),
    account_ids: Array.isArray(item.account_ids) ? item.account_ids.map(id => String(id || '').trim()).filter(Boolean) : [],
    records: Array.isArray(item.records) ? item.records : []
  })
  items.unshift(normalized)
  writeHistoryItems(filePath, items)
  return normalized
}

function recordHistoryStart (filePath, payload) {
  return upsertHistoryItem(filePath, buildHistoryItem(Object.assign({}, payload, {
    status: 'running',
    phase: payload.phase || 'queued'
  })))
}

function recordHistoryFinish (filePath, payload, result) {
  const now = Date.now()
  return upsertHistoryItem(filePath, buildHistoryItem(Object.assign({}, payload, {
    status: result && result.success ? 'success' : 'error',
    phase: 'completed',
    finishedAt: now,
    durationMs: now - (Number(payload.startedAt || now) || now),
    successCount: Number(result && result.success_count || 0) || 0,
    failureCount: Number(result && result.failure_count || 0) || 0,
    records: Array.isArray(result && result.records) ? result.records : [],
    error: result && result.error
  })))
}

// ─── 创建唤醒工厂 ───

/**
 * 为指定平台创建唤醒调度基础设施
 *
 * @param {object} config
 * @param {string} config.platform - 平台名称 ('gemini' | 'antigravity')
 * @param {string} config.scheduleFile - 调度文件名 (如 'gemini-wakeup-schedules.json')
 * @param {string} config.historyFile - 历史文件名 (如 'gemini-wakeup-history.json')
 * @param {object} config.platformDefaults - 平台默认值 { model, reasoningEffort }
 * @param {function} config.runTask - 平台特定任务执行函数 async (opts) => result
 * @param {function} [config.getQuotaResetTimes] - 可选，配额重置时间计算
 * @returns {object} 唤醒 API
 */
function createWakeupInfrastructure (config) {
  const platform = config.platform
  const scheduleFile = config.scheduleFile
  const historyFile = config.historyFile
  const platformDefaults = config.platformDefaults || {}
  const runTask = config.runTask
  const getQuotaResetTimes = config.getQuotaResetTimes || null

  let schedulerTimer = null
  let startupTriggered = false
  const runningScheduleIds = new Set()

  function getScheduleFilePath () {
    return path.join(dataRoot.getSettingsDir(), scheduleFile)
  }

  function getHistoryFilePath () {
    return path.join(dataRoot.getSettingsDir(), historyFile)
  }

  // ─── 调度 CRUD ───

  function _readScheduleMap (nowMs) {
    return readScheduleMap(getScheduleFilePath(), nowMs || Date.now(), platformDefaults)
  }

  function _writeScheduleMap (map) {
    return writeScheduleMap(getScheduleFilePath(), map, platformDefaults)
  }

  function listWakeupSchedules () {
    return Array.from(_readScheduleMap().values()).map(s => withAccountMeta(s, platform))
  }

  function getWakeupSchedule (accountId) {
    const id = String(accountId || '').trim()
    if (!id) return { success: false, error: '账号 ID 为空' }
    const existing = _readScheduleMap().get(id)
    const fallback = normalizeSchedule({
      account_id: id,
      enabled: false,
      schedule_kind: DEFAULT_SCHEDULE_KIND,
      daily_time: DEFAULT_DAILY_TIME,
      weekly_days: DEFAULT_WEEKLY_DAYS,
      weekly_time: DEFAULT_DAILY_TIME,
      interval_hours: DEFAULT_INTERVAL_HOURS,
      quota_reset_window: 'either',
      startup_delay_minutes: 0,
      prompt: DEFAULT_PROMPT,
      model: platformDefaults.model || '',
      reasoning_effort: platformDefaults.reasoningEffort || ''
    }, Date.now(), platformDefaults)
    return { success: true, schedule: withAccountMeta(existing || fallback, platform) }
  }

  function getWakeupOverview (accountId) {
    const id = String(accountId || '').trim()
    if (!id) return { success: false, error: '账号 ID 为空' }
    const scheduleResult = getWakeupSchedule(id)
    const schedule = scheduleResult && scheduleResult.schedule ? scheduleResult.schedule : null
    const latest = listWakeupHistory({ accountId: id, limit: 1 })[0] || null
    return {
      success: true,
      schedule,
      latest,
      running: !!(latest && latest.status === 'running'),
      next_run_at: schedule ? Number(schedule.next_run_at || 0) || 0 : 0
    }
  }

  function saveWakeupSchedule (accountId, patch) {
    const id = String(accountId || '').trim()
    if (!id) return { success: false, error: '账号 ID 为空' }
    const account = storage.getAccount(platform, id)
    if (!account) return { success: false, error: '账号不存在' }
    const now = Date.now()
    const map = _readScheduleMap(now)
    const existing = map.get(id)
    const schedule = normalizeSchedule(Object.assign({}, existing || {}, patch || {}, {
      account_id: id,
      updated_at: now,
      created_at: existing ? existing.created_at : now
    }), now, platformDefaults)
    map.set(id, schedule)
    if (!_writeScheduleMap(map)) {
      return { success: false, error: '保存唤醒配置失败' }
    }
    ensureScheduler()
    return { success: true, schedule: withAccountMeta(schedule, platform) }
  }

  function deleteWakeupSchedule (accountId) {
    const id = String(accountId || '').trim()
    if (!id) return { success: false, error: '账号 ID 为空' }
    const map = _readScheduleMap()
    const deleted = map.delete(id)
    if (!_writeScheduleMap(map)) {
      return { success: false, error: '删除唤醒配置失败' }
    }
    return { success: true, deleted }
  }

  // ─── 历史记录 ───

  function listWakeupHistory (options) {
    const opts = options && typeof options === 'object' ? options : {}
    const accountId = String(opts.accountId || opts.account_id || '').trim()
    const limit = Math.max(1, Math.min(Number(opts.limit || HISTORY_LIMIT) || HISTORY_LIMIT, HISTORY_LIMIT))
    let items = readHistoryItems(getHistoryFilePath())
    if (accountId) {
      items = items.filter(item => item.account_ids.includes(accountId) || (item.records || []).some(record => String(record.account_id || '') === accountId))
    }
    return items.slice(0, limit)
  }

  function getWakeupRun (runId) {
    const id = String(runId || '').trim()
    if (!id) return { success: false, error: 'run_id 为空' }
    const item = readHistoryItems(getHistoryFilePath()).find(entry => entry.run_id === id)
    return item ? { success: true, item } : { success: false, error: '唤醒记录不存在' }
  }

  // ─── 调度执行记录 ───

  function _recordScheduleRun (accountId, result, runKey) {
    const nowMs = Date.now()
    const id = String(accountId || '').trim()
    if (!id) return
    const map = _readScheduleMap(nowMs)
    const schedule = map.get(id)
    if (!schedule) return
    const records = Array.isArray(result && result.records) ? result.records : []
    const first = records[0] || {}
    schedule.last_run_at = nowMs
    schedule.last_run_key = runKey || buildScheduleRunKey(schedule, nowMs)
    schedule.last_status = result && result.success ? 'success' : 'error'
    schedule.last_message = result && result.success
      ? (first.reply || '唤醒完成')
      : ((first && first.error) || (result && result.error) || '唤醒失败')
    schedule.last_success_count = Number(result && result.success_count || 0) || 0
    schedule.last_failure_count = Number(result && result.failure_count || 0) || 0
    schedule.updated_at = nowMs
    schedule.next_run_at = schedule.enabled ? computeNextRunAt(schedule, nowMs) : 0
    map.set(id, schedule)
    _writeScheduleMap(map)
  }

  // ─── 任务执行 ───

  async function runWakeupTask (options) {
    const opts = options && typeof options === 'object' ? options : {}
    const triggerType = normalizeTriggerType(opts.triggerType || opts.trigger_type)
    const runId = String(opts.runId || (platform + '-wakeup-' + Date.now() + '-' + fileUtils.generateId())).trim()
    const startedAt = Date.now()
    const accountIds = Array.isArray(opts.accountIds)
      ? opts.accountIds.map(id => String(id || '').trim()).filter(Boolean)
      : []
    const historyPayload = {
      runId,
      triggerType,
      accountIds,
      prompt: opts.prompt,
      model: opts.model,
      reasoningEffort: opts.reasoningEffort,
      startedAt,
      nextRunAt: Number(opts.nextRunAt || opts.next_run_at || 0) || 0
    }

    if (opts.background === true) {
      recordHistoryStart(getHistoryFilePath(), historyPayload)
      setTimeout(() => {
        runTask(Object.assign({}, opts, {
          background: false,
          runId,
          triggerType,
          startedAt
        })).then(result => {
          recordHistoryFinish(getHistoryFilePath(), historyPayload, result)
        }).catch(err => {
          recordHistoryFinish(getHistoryFilePath(), historyPayload, {
            success: false,
            success_count: 0,
            failure_count: accountIds.length,
            records: [],
            error: err && err.message ? err.message : String(err)
          })
        })
      }, 0).unref?.()
      return {
        success: true,
        running: true,
        status: 'running',
        run_id: runId,
        records: [],
        success_count: 0,
        failure_count: 0
      }
    }

    const result = await runTask(Object.assign({}, opts, { runId, triggerType }))
    recordHistoryFinish(getHistoryFilePath(), historyPayload, result)
    return result
  }

  async function runWakeupSchedule (accountId, options) {
    const id = String(accountId || '').trim()
    if (!id) return { success: false, error: '账号 ID 为空' }
    const schedule = _readScheduleMap().get(id)
    if (!schedule) return { success: false, error: '尚未保存此账号的唤醒配置' }
    const result = await runWakeupTask(Object.assign({}, options || {}, {
      accountIds: [id],
      prompt: schedule.prompt,
      model: schedule.model,
      reasoningEffort: schedule.reasoning_effort,
      triggerType: schedule.schedule_kind,
      nextRunAt: schedule.next_run_at
    }))
    _recordScheduleRun(id, result)
    return result
  }

  // ─── 定时调度器 ───

  async function runDueWakeupSchedules (nowMs) {
    const schedules = Array.from(_readScheduleMap(nowMs).values())
      .map(schedule => ({ schedule, dueAt: getScheduleDueAt(schedule, nowMs, getQuotaResetTimes) }))
      .filter(item => item.dueAt > 0)
    const results = []
    for (const item of schedules) {
      const schedule = item.schedule
      const runKey = buildScheduleRunKey(schedule, item.dueAt)
      const key = schedule.account_id + ':' + runKey
      if (runningScheduleIds.has(key)) continue
      runningScheduleIds.add(key)
      try {
        const result = await runWakeupTask({
          accountIds: [schedule.account_id],
          prompt: schedule.prompt,
          model: schedule.model,
          reasoningEffort: schedule.reasoning_effort,
          triggerType: schedule.schedule_kind,
          nextRunAt: schedule.next_run_at,
          runId: platform + '-wakeup-scheduled-' + Date.now() + '-' + fileUtils.generateId()
        })
        _recordScheduleRun(schedule.account_id, result, runKey)
        results.push({ account_id: schedule.account_id, result })
      } finally {
        runningScheduleIds.delete(key)
      }
    }
    return { success: true, checked_at: nowMs, due_count: schedules.length, results }
  }

  function triggerStartupSchedules () {
    if (startupTriggered) return
    startupTriggered = true
    const schedules = Array.from(_readScheduleMap().values())
      .filter(schedule => schedule.enabled === true && schedule.schedule_kind === 'startup')
    for (const schedule of schedules) {
      const delayMs = normalizeStartupDelayMinutes(schedule.startup_delay_minutes) * 60 * 1000
      setTimeout(() => {
        const latest = _readScheduleMap().get(schedule.account_id)
        if (!latest || latest.enabled !== true || latest.schedule_kind !== 'startup') return
        const runKey = buildScheduleRunKey(latest, Date.now())
        const key = latest.account_id + ':' + runKey
        if (runningScheduleIds.has(key)) return
        runningScheduleIds.add(key)
        runWakeupSchedule(latest.account_id, {
          runId: platform + '-wakeup-startup-' + Date.now() + '-' + fileUtils.generateId()
        }).catch(err => {
          requestLogger.warn(platform + '.wakeup', '启动后唤醒失败', {
            accountId: latest.account_id,
            error: err && err.message ? err.message : String(err)
          })
        }).finally(() => {
          runningScheduleIds.delete(key)
        })
      }, delayMs).unref?.()
    }
  }

  function ensureScheduler () {
    if (schedulerTimer) return
    schedulerTimer = setInterval(() => {
      runDueWakeupSchedules(Date.now()).catch(err => {
        requestLogger.warn(platform + '.wakeup', '定时唤醒检查失败', {
          error: err && err.message ? err.message : String(err)
        })
      })
    }, SCHEDULER_INTERVAL_MS)
    if (typeof schedulerTimer.unref === 'function') {
      schedulerTimer.unref()
    }
  }

  // 自动启动调度器
  ensureScheduler()
  triggerStartupSchedules()
  // 启动时立即检查所有到期调度（daily/weekly/interval/quota_reset）
  // 不等待首个 60 秒间隔，确保应用启动后尽快执行到期任务
  runDueWakeupSchedules(Date.now()).catch(function (err) {
    requestLogger.warn(platform + '.wakeup', '启动时检查到期调度失败', {
      error: err && err.message ? err.message : String(err)
    })
  })

  return {
    listWakeupSchedules,
    getWakeupSchedule,
    getWakeupOverview,
    saveWakeupSchedule,
    deleteWakeupSchedule,
    listWakeupHistory,
    getWakeupRun,
    runWakeupTask,
    runWakeupSchedule,
    runDueWakeupSchedules,
    ensureScheduler,
    triggerStartupSchedules,
    // 暴露工具函数
    _internal: {
      normalizeScheduleKind,
      normalizeDailyTime,
      normalizeWeeklyDays,
      normalizeIntervalHours,
      normalizeQuotaResetWindow,
      normalizeStartupDelayMinutes,
      normalizePrompt,
      normalizeTriggerType,
      resolveTriggerLabel,
      computeNextRunAt,
      getScheduleDueAt,
      buildScheduleRunKey,
      buildDateAtTime,
      normalizeSchedule,
      withAccountMeta
    }
  }
}

module.exports = {
  createWakeupInfrastructure,
  normalizeScheduleKind,
  normalizeDailyTime,
  normalizeWeeklyDays,
  normalizeIntervalHours,
  normalizeQuotaResetWindow,
  normalizeStartupDelayMinutes,
  normalizePrompt,
  normalizeTriggerType,
  resolveTriggerLabel,
  computeNextRunAt,
  getScheduleDueAt,
  buildScheduleRunKey,
  buildDateAtTime,
  normalizeSchedule,
  withAccountMeta,
  DEFAULT_PROMPT,
  DEFAULT_DAILY_TIME,
  DEFAULT_SCHEDULE_KIND,
  DEFAULT_WEEKLY_DAYS,
  DEFAULT_INTERVAL_HOURS
}
