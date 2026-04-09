/**
 * format.js — 格式化工具函数
 */

/**
 * 格式化相对时间
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {string}
 */
export function formatRelativeTime (timestamp) {
  if (!timestamp) return ''
  const now = Math.floor(Date.now() / 1000)
  const diff = timestamp - now

  if (diff <= 0) return '已重置'

  const totalMinutes = Math.floor(diff / 60)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  const parts = []
  if (days > 0) parts.push(days + 'd')
  if (hours > 0) parts.push(hours + 'h')
  if (minutes > 0) parts.push(minutes + 'm')

  return parts.length > 0 ? parts.join(' ') : '<1m'
}

/**
 * 格式化绝对时间
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {string}
 */
export function formatAbsoluteTime (timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
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
  if (!resetTime) return ''
  const relative = formatRelativeTime(resetTime)
  const absolute = formatAbsoluteTime(resetTime)
  return relative + ' (' + absolute + ')'
}

/**
 * 获取配额百分比对应的颜色级别
 * @param {number} percentage - 0-100
 * @returns {'high'|'medium'|'low'|'critical'}
 */
export function getQuotaLevel (percentage) {
  let thresholds = { yellow: 20, green: 60 }
  try {
    let raw = null
    if (window.utools) {
      raw = window.utools.dbStorage.getItem('aideck_quota_thresholds')
    } else {
      const s = localStorage.getItem('aideck_quota_thresholds')
      if (s) raw = JSON.parse(s)
    }
    if (raw && typeof raw.yellow === 'number' && typeof raw.green === 'number') {
      thresholds = raw
    }
  } catch (e) {}

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
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (v) => String(v).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes())
}
