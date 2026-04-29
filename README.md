<p align="center">
  <img src="apps/utools/public/logo.png" width="128" style="border-radius: 24px; box-shadow: 0 8px 16px rgba(0,0,0,0.1);" />
</p>

<h1 align="center">AiDeck</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-v1.0.4-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/platform-uTools%20%E6%8F%92%E4%BB%B6-green?style=flat-square" />
  <img src="https://img.shields.io/badge/License-MIT-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/Node.js-25.9.0-83CD29?style=flat-square&logo=node.js" />
</p>

<p align="center">
  <strong>面向 uTools 的本地 AI IDE 多账号管理插件</strong><br>
  统一管理 Antigravity、Codex、Gemini CLI 账号，提供本地导入、账号切换、配额查看、CLI 启动、标签整理、导出同步和消息通知能力。
</p>

<p align="center">
  <a href="#项目简介">项目简介</a> ·
  <a href="#核心功能">核心功能</a> ·
  <a href="#界面导览">界面导览</a> ·
  <a href="#启动与构建">启动与构建</a> ·
  <a href="#数据与安全">数据与安全</a> ·
  <a href="#版本更新记录">版本更新记录</a>
</p>

---

## 项目简介

**AiDeck** 当前只维护 **uTools 插件端**。项目已移除 Electron Desktop 和旧根入口，构建产物统一输出到仓库根目录 `dist/`，通过 uTools 开发者工具导入即可调试或使用。

当前支持的平台：

- **Codex**：OpenAI / ChatGPT 登录态管理、配额查看、OAuth / Token / JSON / 本地导入、全局切号、Codex CLI 账号绑定实例启动。
- **Antigravity**：本地数据库导入、OAuth / Token / JSON 导入、设备身份同步、配额查看、账号切换和预警。
- **Gemini CLI**：读取和写入本地 Gemini CLI 配置，支持 OAuth / Token / JSON / 本地导入、账号注入、配额刷新和 CLI 启动。

---

## 核心功能

### 多平台账号管理

- 仪表盘汇总展示各平台账号数量、当前账号和配额状态。
- 平台页支持添加账号、本机导入、JSON 导入、批量导出、批量刷新配额、标签编辑和删除账号。
- 侧边栏搜索会按邮箱、账号名、组织、工作区、套餐和标签过滤账号。
- 支持隐私模式，隐藏邮箱等敏感信息。

### Codex 能力

- 支持从系统默认 Codex 配置目录探测并导入当前登录账号。
- 支持 OAuth 授权、Token / JSON 导入和当前账号切换。
- 配额展示支持 5 小时、每周、剩余额度，以及接口返回的额外模型额度。
- 旧配额快照会在进入 Codex 页面后自动静默刷新一次，补齐新配额结构。
- Codex CLI 启动不会再执行全局切号：账号首次点击 CLI 按钮时创建独立 `CODEX_HOME` 实例并绑定到该账号，后续启动复用同一个实例目录。
- Codex 账号卡片新增唤醒任务入口，每个账号可单独设置启用 / 停用、调度模式、提示词、预设或自定义模型和推理强度，也可立即通过账号绑定实例执行 `codex exec` 轻量唤醒并刷新配额。
- 账号绑定实例会共享默认 Codex 的 `skills`、`rules`、`vendor_imports/skills` 和 `AGENTS.md`，但 `auth.json`、`sessions`、`archived_sessions`、`session_index.jsonl`、`history.jsonl` 等账号状态与会话数据保持实例隔离，避免多实例并发写入或会话索引不一致。
- Codex 会话管理支持按工作区查看默认实例和账号绑定实例中的本地会话，预览 Markdown 对话内容和图片附件，并可继续、归档、取消归档、移入回收站、恢复、复制或移动到指定账号实例。
- 会话维护工具支持清理缺失会话文件残留的 SQLite / `session_index.jsonl` 索引，降低 Codex App 本地索引异常带来的干扰。
- 删除 Codex 账号时，会同步删除该账号绑定的 Codex CLI 实例目录。

### Antigravity 能力

- 支持从本机 Antigravity 本地数据库导入当前登录账号。
- 支持 OAuth、Token / JSON 导入、切号和配额刷新。
- 支持配额聚合展示、自动刷新、低配额自动切换和系统级预警通知。
- 支持设备身份相关操作，包括读取当前设备身份、切号时同步设备身份和恢复原始设备身份。

### Gemini CLI 能力

- 支持读取当前系统默认 Gemini CLI 配置目录中的 `oauth_creds.json`、`google_accounts.json` 和 `settings.json`。
- 支持 OAuth、Token / JSON、本机导入和账号注入。
- 支持 Pro / Flash 分组配额展示、自动刷新和系统级配额预警。
- 支持从账号卡片选择工作目录并用默认终端启动 `gemini` CLI。

### 终端与 CLI 启动

- 常规设置中可选择默认终端。
- macOS 会检测 Terminal、iTerm2 等常见终端；Windows / Linux 会检测常见系统终端。
- CLI 检测会额外扫描 Homebrew、npm、Volta、Bun、nvm、fnm 等常见目录，减少 GUI 环境 `PATH` 过短导致找不到命令的问题。
- 未检测到 `codex` 或 `gemini` 时，会提示对应安装命令。

### 消息、日志和同步

- 侧边栏提供消息通知中心，支持远程公告、未读角标、置顶、刷新、全部已读和弹窗公告。
- 当公告版本高于当前安装版本时，会提示等待 uTools 应用市场审核通过后再更新并重启插件。
- 常规设置中可开启操作日志；日志保存在本地，会对敏感字段脱敏，并支持复制、清空和打开日志目录。
- 账号数据支持加密快照导出和恢复，便于多设备间手动同步。

---

## 界面导览

<p align="center">
  <img src="docs/Dashboard.png" width="32%" />
  <img src="docs/Antigravity.png" width="32%" />
  <img src="docs/codex.png" width="32%" />
</p>
<p align="center">
  <img src="docs/settings.png" width="32%" />
  <img src="docs/Antigravity_settings.png" width="32%" />
</p>

---

## 仓库结构

```text
Aideck/
├── apps/
│   └── utools/              # uTools 插件宿主、Vite 构建和 postbuild
├── packages/
│   ├── app-shell/           # React 渲染层、页面、组件和运行时 hooks
│   ├── core/                # HostBridge 桥接协议
│   ├── infra-node/          # 本地存储、设置、日志、公告和终端启动能力
│   └── platforms/           # Antigravity / Codex / Gemini 服务实现
├── docs/                    # 截图、赞助说明和文档资源
├── scripts/                 # 测试收集、发布等脚本
└── tests/                   # Node test 自动化测试
```

---

## 数据与安全

AiDeck 默认把数据保存在用户主目录下的 `.ai_deck`：

- macOS / Linux：`~/.ai_deck`
- Windows：`%USERPROFILE%\.ai_deck`

主要数据类型：

- `accounts/`：各平台账号索引和账号详情。
- `settings/`：共享设置和宿主设置。
- `logs/`：操作日志，仅在设置中开启后记录。
- `cache/`：公告等缓存。
- `sync/`：同步快照相关文件。
- `instances/codex-cli/`：Codex CLI 账号绑定实例和共享静态配置目录。

安全说明：

- 账号、Token、刷新凭证默认仅保存在本地设备。
- 导出的同步快照需要口令加密。
- 日志默认关闭；开启后会保留在本地，并对敏感内容做脱敏处理。
- 本项目不是 Antigravity、OpenAI、Google 或 uTools 的官方客户端，请在合法合规前提下使用，并自行承担账号风控、凭证管理和平台规则风险。

---

## 安装插件

AiDeck 是 uTools 插件，使用前需要先安装 uTools 桌面端。

### 通过 uTools 应用市场安装

1. 前往 uTools 官网下载并安装 uTools：`https://u.tools`
2. 打开 uTools，进入插件应用市场。
3. 搜索 `AiDeck`。
4. 点击安装，安装完成后即可在 uTools 中打开使用。

如果应用市场中的版本仍在审核中，请等待审核通过后再安装或更新。

### 通过本地构建产物导入

适合开发调试或提前体验未上架版本：

1. 先安装 uTools 桌面端。
2. 在本项目中执行 `npm install` 和 `npm run build`。
3. 打开 uTools 开发者工具。
4. 选择导入插件，目录选择仓库根目录下的 `dist/`。
5. 导入后即可在 uTools 中启动 AiDeck。

开发模式下也可以先执行 `npm run dev`，再在 uTools 开发者工具中导入仓库根目录的 `plugin.json`。

---

## 启动与构建

### 环境要求

- Node.js：建议使用 `25.9.0`，与当前 CI 配置一致。
- npm：使用随 Node 附带的 npm 即可。

### 本地开发

```bash
npm install
npm run dev
```

开发服务启动后，在 uTools 开发者工具中导入仓库根目录的 `plugin.json`，开发入口会指向 `http://localhost:5173`。

### 生产构建

```bash
npm run build
```

构建产物位于仓库根目录 `dist/`。uTools 生产导入时选择 `dist/` 目录。

### 发布打包

```bash
npm run release
```

该命令会构建 uTools 插件产物，并生成校验文件。

### 测试

```bash
npm test
```

当前 CI 会在 `ubuntu-latest` 上使用 Node.js `25.9.0` 执行 `npm ci`、`npm test` 和 `npm run build`。

---

## 版本更新记录

完整版本历史维护在 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

消息中心的 `announcements.json` 只保留当前需要提示的最新版本更新公告；发布下一个版本时，上一版本更新公告会从消息中心移除，但历史内容会继续保留在 `docs/CHANGELOG.md`。

---

## 贡献与反馈

如果你在使用过程中发现问题或有改进建议，欢迎提交 [Issues](https://github.com/wannanbigpig/AiDeck/issues) 或 Pull Request。

**Author**: [wannanbigpig](https://github.com/wannanbigpig)
