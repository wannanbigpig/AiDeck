/**
 * 配额错误分类工具
 * 参考：google-gemini/gemini-cli packages/core/src/utils/googleQuotaErrors.ts
 */

/**
 * 配额错误类型枚举
 */
const QuotaErrorType = {
  TERMINAL: 'TERMINAL',           // 不可重试 (如每日配额耗尽)
  RETRYABLE: 'RETRYABLE',         // 可重试 (如每分钟配额)
  VALIDATION_REQUIRED: 'VALIDATION_REQUIRED', // 需要用户验证
  INVALID_GRANT: 'INVALID_GRANT'  // Token 失效
}

/**
 * 分类 Google API 配额错误
 * @param {number} statusCode - HTTP 状态码
 * @param {string} errorMessage - 错误消息
 * @param {object} errorDetails - 详细错误信息 (如果有)
 * @returns {{ type: QuotaErrorType, retryDelayMs?: number, reason?: string }}
 */
function classifyQuotaError (statusCode, errorMessage, errorDetails = {}) {
  const rawError = String(errorMessage || '').toLowerCase()
  
  // 1. invalid_grant 错误 (Token 失效)
  if (rawError.includes('invalid_grant')) {
    return {
      type: QuotaErrorType.INVALID_GRANT,
      reason: 'Token 已失效或已被撤销'
    }
  }
  
  // 2. 403 + VALIDATION_REQUIRED (需要用户验证)
  if (statusCode === 403 && rawError.includes('validation_required')) {
    return {
      type: QuotaErrorType.VALIDATION_REQUIRED,
      reason: '需要用户验证'
    }
  }
  
  // 3. 429/499 配额错误
  if (statusCode === 429 || statusCode === 499) {
    // 检测每日配额耗尽
    if (rawError.includes('perday') || rawError.includes('daily') || 
        rawError.includes('quota exhausted') || rawError.includes('quota_exhausted')) {
      return {
        type: QuotaErrorType.TERMINAL,
        reason: '每日配额已耗尽'
      }
    }
    
    // 检测每分钟配额限制
    if (rawError.includes('perminute') || rawError.includes('rate limit')) {
      // 尝试解析重试延迟
      const retryMatch = rawError.match(/retry in ([0-9.]+(?:ms|s))/i)
      const retryDelaySeconds = retryMatch ? parseDurationInSeconds(retryMatch[1]) : 60
      
      if (retryDelaySeconds > 300) { // 超过 5 分钟视为不可重试
        return {
          type: QuotaErrorType.TERMINAL,
          retryDelayMs: retryDelaySeconds * 1000,
          reason: '配额限制时间过长'
        }
      }
      
      return {
        type: QuotaErrorType.RETRYABLE,
        retryDelayMs: retryDelaySeconds * 1000,
        reason: '每分钟配额限制'
      }
    }
    
    // 默认视为可重试
    return {
      type: QuotaErrorType.RETRYABLE,
      retryDelayMs: 5000, // 默认 5 秒后重试
      reason: '配额限制'
    }
  }
  
  // 4. 503 服务不可用
  if (statusCode === 503) {
    return {
      type: QuotaErrorType.RETRYABLE,
      retryDelayMs: 10000, // 10 秒后重试
      reason: '服务暂时不可用'
    }
  }
  
  // 5. 其他错误 (默认不可重试)
  return {
    type: QuotaErrorType.TERMINAL,
    reason: '未知错误'
  }
}

/**
 * 解析持续时间字符串 (如 "34.074824224s", "60s", "900ms")
 * @param {string} duration - 持续时间字符串
 * @returns {number|null} - 秒数，解析失败返回 null
 */
function parseDurationInSeconds (duration) {
  if (!duration) return null
  
  const trimmed = String(duration).trim().toLowerCase()
  
  if (trimmed.endsWith('ms')) {
    const milliseconds = parseFloat(trimmed.slice(0, -2))
    return isNaN(milliseconds) ? null : milliseconds / 1000
  }
  
  if (trimmed.endsWith('s')) {
    const seconds = parseFloat(trimmed.slice(0, -1))
    return isNaN(seconds) ? null : seconds
  }
  
  return null
}

/**
 * 判断是否为网络错误
 * @param {Error|unknown} err - 错误对象
 * @returns {boolean}
 */
function isNetworkError (err) {
  if (!err) return false
  
  const networkCodes = [
    'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND',
    'EAI_AGAIN', 'ECONNREFUSED'
  ]
  
  if (err.code && networkCodes.includes(err.code)) {
    return true
  }
  
  if (err.message && typeof err.message === 'string') {
    const lowerMessage = err.message.toLowerCase()
    if (lowerMessage.includes('fetch failed') || 
        lowerMessage.includes('network') ||
        lowerMessage.includes('timeout')) {
      return true
    }
  }
  
  return false
}

module.exports = {
  QuotaErrorType,
  classifyQuotaError,
  parseDurationInSeconds,
  isNetworkError
}
