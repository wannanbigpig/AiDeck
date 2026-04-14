/**
 * OAuth 请求重试工具
 * 支持指数退避重试，用于处理网络不稳定问题
 */

/**
 * 判断是否为可重试的网络错误
 * @param {Error|unknown} err - 错误对象
 * @returns {boolean}
 */
function isRetryableNetworkError (err) {
  if (!err) return false
  
  const message = String(err.message || err || '')
  const code = String(err.code || '')
  
  // 可重试的错误特征
  const retryablePatterns = [
    'socket disconnected',
    'TLS connection',
    'secure TLS connection',
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'network',
    'timeout',
    'fetch failed'
  ]
  
  // 不可重试的错误特征（配置错误、认证错误等）
  const nonRetryablePatterns = [
    'invalid_client',
    'unauthorized_client',
    'invalid_grant',
    '400 Bad Request',
    '401 Unauthorized',
    '403 Forbidden'
  ]
  
  // 先检查是否是不可重试的错误
  for (const pattern of nonRetryablePatterns) {
    if (message.toLowerCase().includes(pattern.toLowerCase())) {
      return false
    }
  }
  
  // 检查是否是可重试的网络错误
  for (const pattern of retryablePatterns) {
    if (message.toLowerCase().includes(pattern.toLowerCase())) {
      return true
    }
  }
  
  // 如果是网络相关的错误代码，也可重试
  const retryableCodes = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']
  if (retryableCodes.includes(code)) {
    return true
  }
  
  return false
}

/**
 * 延迟指定毫秒数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * OAuth 请求重试包装器
 * @param {Function} fn - 要执行的异步函数
 * @param {object} options - 选项
 * @param {number} options.maxAttempts - 最大重试次数 (默认 5)
 * @param {number} options.initialDelayMs - 初始延迟 (默认 1000ms)
 * @param {number} options.maxDelayMs - 最大延迟 (默认 30000ms)
 * @param {function} options.onRetry - 重试回调 (attempt, error, delay)
 * @param {string} options.operationName - 操作名称（用于日志）
 * @returns {Promise<any>}
 */
async function retryOAuthRequest (fn, options = {}) {
  const {
    maxAttempts = 5,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    onRetry = null,
    operationName = 'OAuth request'
  } = options
  
  let lastError = null
  let attempt = 0
  
  while (attempt < maxAttempts) {
    attempt++
    
    try {
      return await fn()
    } catch (err) {
      lastError = err
      
      // 检查是否是可重试的错误
      if (!isRetryableNetworkError(err)) {
        // 不可重试的错误，直接抛出
        throw err
      }
      
      // 已达到最大重试次数，抛出错误
      if (attempt >= maxAttempts) {
        break
      }
      
      // 计算指数退避延迟
      const exponentialDelay = initialDelayMs * Math.pow(2, attempt - 1)
      const delayMs = Math.min(exponentialDelay, maxDelayMs)
      
      // 调用重试回调
      if (onRetry) {
        onRetry(attempt, err, delayMs)
      }
      
      // 等待后重试
      await delay(delayMs)
    }
  }
  
  // 所有重试都失败，抛出最后一次错误
  throw lastError
}

module.exports = {
  retryOAuthRequest,
  isRetryableNetworkError,
  delay
}
