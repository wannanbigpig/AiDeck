/**
 * 带配额感知的重试机制
 * 参考：google-gemini/gemini-cli packages/core/src/utils/retry.ts
 */

const { classifyQuotaError, QuotaErrorType } = require('./quotaErrorClassifier')

/**
 * 带配额感知的重试机制
 * @param {Function} fn - 要重试的异步函数
 * @param {object} options - 选项
 * @param {number} options.maxAttempts - 最大重试次数 (默认 5)
 * @param {number} options.initialDelayMs - 初始延迟 (默认 5000ms)
 * @param {number} options.maxDelayMs - 最大延迟 (默认 30000ms)
 * @param {boolean} options.retryFetchErrors - 是否重试网络错误 (默认 true)
 * @returns {Promise<any>}
 */
async function retryWithQuotaAware (fn, options = {}) {
  const {
    maxAttempts = 5,  // 改为 5 次，按照要求
    initialDelayMs = 5000,
    maxDelayMs = 30000,
    retryFetchErrors = true
  } = options
  
  let attempt = 0
  let currentDelay = initialDelayMs
  
  while (attempt < maxAttempts) {
    attempt++
    
    try {
      return await fn()
    } catch (err) {
      const statusCode = err.status || err.code
      const errorClass = classifyQuotaError(statusCode, err.message || String(err))
      
      // 不可重试的错误，直接抛出
      if (errorClass.type === QuotaErrorType.TERMINAL ||
          errorClass.type === QuotaErrorType.INVALID_GRANT ||
          errorClass.type === QuotaErrorType.VALIDATION_REQUIRED) {
        throw err
      }
      
      // 可重试的错误
      if (errorClass.type === QuotaErrorType.RETRYABLE) {
        const delayMs = Math.min(
          errorClass.retryDelayMs || currentDelay,
          maxDelayMs
        )
        
        console.info(`重试 ${attempt}/${maxAttempts}，等待 ${delayMs}ms`, {
          error_type: errorClass.reason
        })
        
        await new Promise(resolve => setTimeout(resolve, delayMs))
        
        // 指数退避
        currentDelay = Math.min(currentDelay * 2, maxDelayMs)
        continue
      }
      
      // 其他错误，达到最大次数后抛出
      if (attempt >= maxAttempts) {
        throw err
      }
      
      // 网络错误重试
      if (retryFetchErrors && isNetworkError(err)) {
        await new Promise(resolve => setTimeout(resolve, currentDelay))
        currentDelay = Math.min(currentDelay * 2, maxDelayMs)
        continue
      }
      
      throw err
    }
  }
}

/**
 * 判断是否为网络错误
 */
function isNetworkError (err) {
  const networkCodes = [
    'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND',
    'EAI_AGAIN', 'ECONNREFUSED'
  ]
  return networkCodes.includes(err.code) ||
         (err.message && typeof err.message === 'string' && 
          err.message.toLowerCase().includes('fetch failed'))
}

module.exports = { retryWithQuotaAware, isNetworkError }