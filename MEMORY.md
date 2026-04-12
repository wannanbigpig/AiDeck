# Aideck Memory

这份文档给下一次接手的 AI 或维护者使用。目标不是替代读代码，而是缩短进入状态的时间。

## 1. 项目是什么

- `Aideck` 是一个基于 `uTools` 的本地插件，不是纯浏览器网页。
- 核心定位是 `AI IDE 多平台多账号管理工具`，当前主要支持：
  - `Antigravity`
  - `Codex`
  - `Gemini CLI`
- 核心能力：
  - 本地账号导入
  - OAuth / JSON / Token 导入
  - 当前账号切换或注入
  - 配额展示与刷新
  - 标签管理、批量导出、仪表盘总览

## 2. 技术栈与运行方式

- 前端：`React 19` + `Vite 6`
- preload：`Node.js CommonJS`
- UI：原生 CSS，主题变量集中在 `src/main.css`
- 测试：Node 内置测试，执行 `npm test`

常用命令：

```bash
npm install
npm run dev
npm test
```

开发联调方式：

- 先运行本地前端：`npm run dev`
- 再在 `uTools` 开发者模式加载仓库目录
- 插件入口配置在 `public/plugin.json`

## 3. 目录骨架

```text
src/
  App.jsx                    # 全局入口，维护 platformData 与 refreshAll
  pages/                     # Dashboard / Antigravity / Codex / Gemini / Settings
  components/                # 通用组件、弹窗、卡片、图标、主题、日志等
  utils/                     # 展示格式化、全局设置、请求日志客户端等

public/
  plugin.json                # uTools 插件入口
  preload/
    services.js              # 将后端能力挂到 window.services
    lib/
      accountStorage.js      # 文件化存储层
      antigravityService.js  # Antigravity 平台服务
      codexService.js        # Codex 平台服务
      geminiService.js       # Gemini 平台服务
      requestLogStore.js     # 本地请求日志
      fileUtils.js           # 文件工具

tests/
  *.test.cjs                 # Node test
```

## 4. 最重要的架构事实

### 4.1 前后端边界

- React 页面不直接读写本地文件。
- 本地文件、网络请求、OAuth、切号、配额刷新都在 `public/preload/lib/*.js` 完成。
- 前端通过 `window.services` 调用能力，桥接定义在 `public/preload/services.js`。

### 4.2 全局状态源头

- `src/App.jsx` 是前端总入口。
- 它维护三个平台的统一状态树：
  - `platformData.antigravity`
  - `platformData.codex`
  - `platformData.gemini`
- 页面在执行导入、删除、切号、刷新后，应该先调用服务，再通过 `onRefresh?.()` 让 `App.jsx` 统一刷新。
- `Dashboard`、`Sidebar`、`StatusBar` 都消费同一份 `platformData`，不要各自维护一套重复真相。

### 4.3 本地状态自动同步

- `App.jsx` 会监听 `aideck:local-state-change`。
- `public/preload/services.js` 会对各平台本地配置目录做 `fs.watch`，检测本地登录态变化。
- 本地状态变化后会触发 `syncCurrentFromLocal()`，同步当前账号。

## 5. 数据存储与关键路径

### 5.1 Aideck 自己的数据目录

统一存储在：

```text
~/.ai_deck/
```

关键结构：

```text
~/.ai_deck/
  meta.json
  antigravity/
  codex/
  gemini/
    accounts-index.json
    accounts/
    current.json
    oauth_pending/
  logs/
  sync/
```

存储实现见 `public/preload/lib/accountStorage.js`。

### 5.2 平台本地凭证来源

- Codex：`~/.codex/auth.json`
- Gemini CLI：`~/.gemini/`
  - `oauth_creds.json`
  - `google_accounts.json`
- Antigravity：
  - 运行态探测主要依赖 `state.vscdb`
  - 另有 `storage.json`、`machineid` 等设备身份相关文件

### 5.3 请求日志

- 日志功能默认关闭
- 打开后写入：

```text
~/.ai_deck/logs/request.log
```

- 实现：`public/preload/lib/requestLogStore.js`
- 日志会做脱敏处理，尤其是 token、cookie、邮箱、URL 查询参数

## 6. 三个平台的代码差异

### 6.1 Antigravity

- 服务文件：`public/preload/lib/antigravityService.js`
- 特色能力：
  - 本地数据库导入
  - OAuth
  - 设备身份探测、切换、恢复
  - 配额查询走 Google Cloud Code 相关接口
- 页面文件：`src/pages/Antigravity.jsx`

### 6.2 Codex

- 服务文件：`public/preload/lib/codexService.js`
- 本地凭证来源：`~/.codex/auth.json`
- 特色能力：
  - OAuth
  - 配额接口：`https://chatgpt.com/backend-api/wham/usage`
  - 可探测 `Codex.app` / `OpenCode.app`
- 页面文件：`src/pages/Codex.jsx`

### 6.3 Gemini CLI

- 服务文件：`public/preload/lib/geminiService.js`
- 本地凭证目录：`~/.gemini`
- 特色能力：
  - OAuth
  - token 刷新
  - 本地凭证注入
  - 配额接口与 Google Code Assist 相关
- 页面文件：`src/pages/Gemini.jsx`

## 7. 先看哪些文件

如果下次要改功能，建议先按这个顺序读：

1. `README.md`
2. `src/App.jsx`
3. `public/preload/services.js`
4. 对应平台页面，例如 `src/pages/Codex.jsx`
5. 对应平台服务，例如 `public/preload/lib/codexService.js`
6. 相关工具文件，例如 `src/utils/*.js`
7. 相关测试文件 `tests/*.test.cjs`

## 8. 测试现状

- 当前测试是 Node 内置测试，不是 Jest/Vitest。
- 已覆盖的重点包括：
  - `accountStorage` 的初始化、去重、OAuth pending、同步加密
  - `antigravity.js` 的配额展示聚合逻辑
  - `gemini.js` 的配额展示逻辑
- 对大型页面交互本身没有完整前端测试，UI 改动后要结合手工验证。

## 9. 改动时的工程约束

- 这是一个已经存在较多本地文件副作用的项目，改动前先判断影响范围。
- 优先复用现有服务和工具函数，不要在页面里重复写一套平台逻辑。
- 新增功能优先落在：
  - 页面交互：`src/pages` / `src/components`
  - 本地副作用：`public/preload/lib`
- 不要轻易引入新依赖；当前项目风格偏原生、直接、低抽象。
- 颜色、间距、主题优先复用 `src/main.css` 里的 CSS 变量。

## 10. 当前仓库注意事项

- 当前工作区不是干净状态，已经存在较多未提交改动。
- 下次进入仓库时，第一步先执行：

```bash
git status --short
```

- 不要默认回滚或覆盖现有修改，先区分哪些是历史改动，哪些是你本次要做的事。

## 11. 多系统兼容原则

这不是单系统插件，后续所有开发默认按 `macOS / Windows / Linux` 三端兼容来考虑。

- 不允许只按当前开发机器系统修功能。
- 任何涉及以下内容的改动，都必须同步检查三端逻辑：
  - 本地配置目录与凭证路径
  - 应用路径探测
  - 切号后的应用重启、进程检测与退出
  - 文件读写、副作用、外部命令调用
  - 设置页默认值、提示文案、错误提示
- 如果某项能力只能在部分系统成立，必须在代码和文案里明确标注，不要默认其他系统也可用。
- 新增平台相关能力时，优先复用现有 `process.platform` 分支模式，不要把路径或命令写死成单一系统版本。

## 12. 一句话总结

这是一个“React 前端 + preload 本地服务层 + 文件化账号存储”的 `uTools` 插件项目；以后无论改哪个平台，真正的主线都还是这三件事：

1. 读懂 `window.services` 这层契约
2. 读懂 `~/.ai_deck` 和各平台本地凭证的关系
3. 保持 `App.jsx` 作为统一状态源，不要把页面改成各自为政
