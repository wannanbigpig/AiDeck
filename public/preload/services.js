/**
 * services.js — uTools preload 入口文件
 *
 * 将所有后端服务挂载到 window.services 对象上，
 * 供前端 React 组件直接调用。
 */

const antigravityService = require('./lib/antigravityService')
const codexService = require('./lib/codexService')
const geminiService = require('./lib/geminiService')
const accountStorage = require('./lib/accountStorage')
const fileUtils = require('./lib/fileUtils')

window.services = {
  // ===== Antigravity =====
  antigravity: {
    list: function () { return antigravityService.list() },
    getCurrent: function () { return antigravityService.getCurrent() },
    importFromLocal: function () { return antigravityService.importFromLocal() },
    importFromJson: function (json) { return antigravityService.importFromJson(json) },
    addWithToken: function (token) { return antigravityService.addWithToken(token) },
    switchAccount: function (id) { return antigravityService.switchAccount(id) },
    deleteAccount: function (id) { return antigravityService.deleteAccount(id) },
    deleteAccounts: function (ids) { return antigravityService.deleteAccounts(ids) },
    refreshQuota: function (id) { return antigravityService.refreshQuota(id) },
    exportAccounts: function (ids) { return antigravityService.exportAccounts(ids) },
    updateTags: function (id, tags) { return antigravityService.updateTags(id, tags) },
    getConfigDir: function () { return antigravityService.getConfigDir() }
  },

  // ===== Codex =====
  codex: {
    list: function () { return codexService.list() },
    getCurrent: function () { return codexService.getCurrent() },
    importFromLocal: function () { return codexService.importFromLocal() },
    importFromJson: function (json) { return codexService.importFromJson(json) },
    addWithToken: function (idToken, accessToken, refreshToken) {
      return codexService.addWithToken(idToken, accessToken, refreshToken)
    },
    switchAccount: function (id, options) { return codexService.switchAccount(id, options) },
    deleteAccount: function (id) { return codexService.deleteAccount(id) },
    deleteAccounts: function (ids) { return codexService.deleteAccounts(ids) },
    refreshQuota: function (id) { return codexService.refreshQuota(id) },
    exportAccounts: function (ids) { return codexService.exportAccounts(ids) },
    updateTags: function (id, tags) { return codexService.updateTags(id, tags) },
    getPlanDisplayName: function (plan) { return codexService.getPlanDisplayName(plan) },
    getConfigDir: function () { return codexService.getConfigDir() },
    detectCodexAppPath: function (customPath) { return codexService.detectCodexAppPath(customPath) }
  },

  // ===== Gemini CLI =====
  gemini: {
    list: function () { return geminiService.list() },
    getCurrent: function () { return geminiService.getCurrent() },
    importFromLocal: function () { return geminiService.importFromLocal() },
    importFromJson: function (json) { return geminiService.importFromJson(json) },
    inject: function (id) { return geminiService.inject(id) },
    deleteAccount: function (id) { return geminiService.deleteAccount(id) },
    deleteAccounts: function (ids) { return geminiService.deleteAccounts(ids) },
    refreshToken: function (id) { return geminiService.refreshToken(id) },
    exportAccounts: function (ids) { return geminiService.exportAccounts(ids) },
    updateTags: function (id, tags) { return geminiService.updateTags(id, tags) },
    getPlanBadge: function (account) { return geminiService.getPlanBadge(account) },
    getConfigDir: function () { return geminiService.getConfigDir() }
  },

  // ===== 通用工具 =====
  storage: {
    getAccountCount: function (platform) { return accountStorage.getAccountCount(platform) }
  },
  platform: {
    getHomeDir: function () { return fileUtils.getHomeDir() },
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux',
    osType: process.platform
  }
}
