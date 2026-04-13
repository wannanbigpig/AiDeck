/**
 * format.js — 格式化工具函数
 */

/**
 * 统一把时间值转成 Unix 秒（支持秒/毫秒/ISO 字符串）
 * @param {number|string|object} value
 * @returns {number}
 */
function normalizeTimestampSeconds (value) {
  if (value === null || value === undefined || value === '') return 0

  if (typeof value === 'object') {
    const candidates = [
      value.seconds,
      value.sec,
      value.value,
      value.timestamp,
      value.ts,
      value.reset_at,
      value.resetAt,
      value.reset_time,
      value.resetTime
    ]
    for (let i = 0; i < candidates.length; i++) {
      const normalized = normalizeTimestampSeconds(candidates[i])
      if (normalized > 0) return normalized
    }
    return 0
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1000000000000) return Math.floor(value / 1000)
    if (value > 10000000000) return Math.floor(value / 1000)
    return Math.floor(value)
  }

  const raw = String(value).trim()
  if (!raw) return 0

  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    return normalizeTimestampSeconds(numeric)
  }

  const parsedMs = Date.parse(raw)
  if (!Number.isFinite(parsedMs)) return 0
  return Math.floor(parsedMs / 1000)
}

/**
 * 格式化相对时间
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {string}
 */
export function formatRelativeTime (timestamp) {
  const ts = normalizeTimestampSeconds(timestamp)
  if (!ts) return ''
  const now = Math.floor(Date.now() / 1000)
  const diff = ts - now

  if (diff <= 0) return '已重置'

  const totalMinutes = Math.floor(diff / 60)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  const parts = []
  if (days > 0) parts.push(days + '天')
  if (hours > 0) parts.push(hours + '小时')
  if (minutes > 0) parts.push(minutes + '分钟')

  return parts.length > 0 ? parts.join(' ') : '不到1分钟'
}

/**
 * 格式化时分秒倒计时
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {string}
 */
export function formatCountdownTime (timestamp) {
  const ts = normalizeTimestampSeconds(timestamp)
  if (!ts) return ''
  const now = Math.floor(Date.now() / 1000)
  const diff = ts - now

  if (diff <= 0) return '已重置'

  const totalSeconds = Math.floor(diff)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts = []
  if (days > 0) parts.push(days + '天')
  parts.push(String(hours).padStart(2, '0') + '小时')
  parts.push(String(minutes).padStart(2, '0') + '分钟')
  parts.push(String(seconds).padStart(2, '0') + '秒')

  return parts.join(' ')
}

/**
 * 格式化绝对时间
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {string}
 */
export function formatAbsoluteTime (timestamp) {
  const ts = normalizeTimestampSeconds(timestamp)
  if (!ts) return ''
  const date = new Date(ts * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (v) => String(v).padStart(2, '0')
  return pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' +
         pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/**
 * 格式化重置时间（相对 + 绝对）
 * @param {number} resetTime - Unix 时间戳（秒）
 * @returns {string}
 */
export function formatResetTime (resetTime) {
  const ts = normalizeTimestampSeconds(resetTime)
  if (!ts) return ''
  const relative = formatRelativeTime(ts)
  const absolute = formatAbsoluteTime(ts)
  return relative + ' (' + absolute + ')'
}

/**
 * 获取配额百分比对应的颜色级别
 * @param {number} percentage - 0-100
 * @returns {'high'|'medium'|'low'|'critical'}
 */
export function getQuotaLevel (percentage) {
  let thresholds = { yellow: 20, green: 60 }
  const raw = readSharedSetting('aideck_quota_thresholds', null)
  if (raw && typeof raw.yellow === 'number' && typeof raw.green === 'number') {
    thresholds = raw
  }

  if (percentage >= thresholds.green) return 'high'
  if (percentage >= thresholds.yellow) return 'medium'
  return 'critical'
}

/**
 * 截断邮箱显示
 * @param {string} email
 * @param {number} [maxLen=24]
 * @returns {string}
 */
export function truncateEmail (email, maxLen = 24) {
  if (!email) return ''
  if (email.length <= maxLen) return email
  const atIndex = email.indexOf('@')
  if (atIndex < 0) return email.slice(0, maxLen) + '…'
  const local = email.slice(0, atIndex)
  const domain = email.slice(atIndex)
  if (local.length > 12) {
    return local.slice(0, 10) + '…' + domain
  }
  return email.slice(0, maxLen) + '…'
}

/**
 * 格式化时间戳为日期字符串
 * @param {number} ts - 毫秒时间戳
 * @returns {string}
 */
export function formatDate (ts) {
  const seconds = normalizeTimestampSeconds(ts)
  if (!seconds) return ''
  const d = new Date(seconds * 1000)
  const pad = (v) => String(v).padStart(2, '0')
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

/**
 * 脱敏显示处理
 * @param {string} text - 原文本
 * @param {'email'|'id'|'text'} [type='text'] - 脱敏类型
 * @returns {string}
 */
export function maskText (text, type = 'text') {
  if (!text || typeof text !== 'string') return text

  if (type === 'email') {
    const [local, domain] = text.split('@')
    if (!domain) return maskText(text, 'text')
    if (local.length <= 2) return local + '***' + '@' + domain
    return local[0] + '***' + local[local.length - 1] + '@' + domain
  }

  if (type === 'id') {
    // 针对 acc_xxx, proj_xxx 等格式保留前缀
    if (text.includes('_')) {
      const parts = text.split('_')
      return parts[0] + '_***'
    }
    if (text.length <= 6) return text.slice(0, 2) + '***'
    return text.slice(0, 4) + '***'
  }

  // 通用脱敏
  if (text.length <= 2) return text[0] + '*'
  return text[0] + '***' + text[text.length - 1]
}
import { readSharedSetting } from './hostBridge.js'
