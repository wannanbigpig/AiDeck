/**
 * fileUtils.js — 文件操作工具函数
 * 提供安全的文件读写、目录操作等能力
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

/**
 * 获取用户主目录
 */
function getHomeDir () {
  return os.homedir()
}

/**
 * 原子写入文本文件（先写 tmp 再 rename）
 * @param {string} filePath
 * @param {string} content
 * @returns {boolean}
 */
function writeTextFileAtomic (filePath, content) {
  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const tmpPath = filePath + '.tmp-' + process.pid + '-' + Date.now()
    fs.writeFileSync(tmpPath, content, { encoding: 'utf-8' })
    fs.renameSync(tmpPath, filePath)
    return true
  } catch (err) {
    console.error('[fileUtils] writeTextFileAtomic failed:', filePath, err.message)
    return false
  }
}

/**
 * 安全读取 JSON 文件
 * @param {string} filePath 文件绝对路径
 * @returns {object|null} 解析后的对象，失败返回 null
 */
function readJsonFile (filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    const content = fs.readFileSync(filePath, { encoding: 'utf-8' })
    return JSON.parse(content)
  } catch (err) {
    console.error('[fileUtils] readJsonFile failed:', filePath, err.message)
    return null
  }
}

/**
 * 安全写入 JSON 文件（自动创建父目录）
 * @param {string} filePath 文件绝对路径
 * @param {object} data 要写入的对象
 * @returns {boolean} 是否成功
 */
function writeJsonFile (filePath, data) {
  try {
    const content = JSON.stringify(data, null, 2)
    return writeTextFileAtomic(filePath, content)
  } catch (err) {
    console.error('[fileUtils] writeJsonFile failed:', filePath, err.message)
    return false
  }
}

/**
 * 安全读取文本文件
 * @param {string} filePath
 * @returns {string|null}
 */
function readTextFile (filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    return fs.readFileSync(filePath, { encoding: 'utf-8' })
  } catch (err) {
    console.error('[fileUtils] readTextFile failed:', filePath, err.message)
    return null
  }
}

/**
 * 安全写入文本文件（自动创建父目录）
 * @param {string} filePath
 * @param {string} content
 * @returns {boolean}
 */
function writeTextFile (filePath, content) {
  return writeTextFileAtomic(filePath, content)
}

/**
 * 检查文件是否存在
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists (filePath) {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

/**
 * 检查目录是否存在
 * @param {string} dirPath
 * @returns {boolean}
 */
function dirExists (dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

/**
 * 确保目录存在
 * @param {string} dirPath
 * @returns {boolean}
 */
function ensureDir (dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    return true
  } catch (err) {
    console.error('[fileUtils] ensureDir failed:', dirPath, err.message)
    return false
  }
}

/**
 * 删除文件
 * @param {string} filePath
 * @returns {boolean}
 */
function deleteFile (filePath) {
  try {
    if (!fs.existsSync(filePath)) return true
    fs.unlinkSync(filePath)
    return true
  } catch (err) {
    console.error('[fileUtils] deleteFile failed:', filePath, err.message)
    return false
  }
}

/**
 * 列出目录下的文件名
 * @param {string} dirPath
 * @returns {string[]}
 */
function listFiles (dirPath) {
  try {
    if (!dirExists(dirPath)) return []
    return fs.readdirSync(dirPath)
  } catch {
    return []
  }
}

/**
 * 列出目录下文件绝对路径
 * @param {string} dirPath
 * @returns {string[]}
 */
function listFilePaths (dirPath) {
  try {
    if (!dirExists(dirPath)) return []
    const names = fs.readdirSync(dirPath)
    const out = []
    for (let i = 0; i < names.length; i++) {
      out.push(path.join(dirPath, names[i]))
    }
    return out
  } catch {
    return []
  }
}

/**
 * 生成唯一 ID（基于时间戳 + 随机数）
 * @returns {string}
 */
function generateId () {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return timestamp + '-' + random
}

module.exports = {
  getHomeDir,
  readJsonFile,
  writeJsonFile,
  readTextFile,
  writeTextFile,
  writeTextFileAtomic,
  fileExists,
  dirExists,
  ensureDir,
  deleteFile,
  listFiles,
  listFilePaths,
  generateId
}
