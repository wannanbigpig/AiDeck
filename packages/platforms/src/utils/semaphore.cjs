/**
 * 简单信号量实现，用于并发控制
 */

class Semaphore {
  constructor (limit) {
    this.limit = limit
    this.count = 0
    this.queue = []
  }
  
  async acquire () {
    if (this.count < this.limit) {
      this.count++
      return Promise.resolve()
    }
    
    return new Promise(resolve => {
      this.queue.push(resolve)
    })
  }
  
  release () {
    if (this.queue.length > 0) {
      const next = this.queue.shift()
      next()
    } else {
      this.count--
    }
  }
}

module.exports = { Semaphore }