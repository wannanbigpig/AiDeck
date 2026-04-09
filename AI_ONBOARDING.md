# Aideck - AI Agent Onboarding Guide

> **致下一位接手的 AI Agent：**
> 请在进行任何代码修改或架构设计前，**务必全文阅读本指南及用户自定义规则（User Rules）**。本项目严格遵循一套极简、务实且高度定制化的工程流派。

## 一、 项目背景 (Project Context)

**Aideck** 是一个基于 [uTools](https://u.tools/) 插件生态构建的 **本地 AI 编程辅助工具的多账号管理与监控仪表盘**。
它的核心目标是集中管理诸如 **Antigravity**, **Codex (OpenAI)**, **Gemini CLI** 等多平台的本地凭证（如 `~/.codex/auth.json`），并提供：
1. **多账号无缝切换**（一键修改本地底层凭证路由）。
2. **配额水位监控**（实时拉取后台 API，以高质感 UI 呈现不同时间维度的 Quota 消耗）。
3. **全局状态总览**（在统一的 Dashboard 与 StatusBar 中监控活跃实例和健康度）。

## 二、 核心技术栈与架构 (Architecture)

- **前端层 (Frontend)**: `React 18` + `Vite`。没有任何庞大的 UI 组件库（如 AntD 或 TailwindCSS），所有现代化 UI（如拨动开关、翻转卡片、双轨滑块、3D配额条）均基于 **原生 CSS 变量** 和自主构建。
- **桥接层 (Preload / Backend)**: 利用 uTools 的 `preload.js` 机制，在 `public/preload/lib/` 下封装了 Node.js 原生的文件系统操作与网络请求（如 `codexService.js`）。这些底层能力透过 `window.services` 全局对象直接挂载给 React 前端调用。
- **数据持久化**: 大量依赖于 `uTools.dbStorage` 接口进行跨窗口及本地数据缓存。

## 三、 核心状态流转机制 (State Management)

本项目 **没有** 使用 Redux/Zustand 等状态库，而是遵从了极简的 **单向数据流**：

- **大管家 (`App.jsx`)**: 维护全局唯一真相数据树 `platformData`（包含了所有平台的 Accounts 列表及激活状态 `currentId`），以及一个下放各路由的洗牌函数 `refreshAll()`。
- **页面组件 (`Codex.jsx` 等)**: 当执行导入、删除或刷新配额等异步操作时，**必须且只能**调用 `svc` 相关接口更新底层，随后再调用由 App 传入的 `onRefresh?.()` 回调通知外层。
- **同步消费栏 (`Sidebar.jsx` & `StatusBar.jsx` & `Dashboard.jsx`)**: 层层接管 `platformData` 数据，实现跨组件的“帧同步”更新，绝不允许在局部组件内维护封闭的孤岛全集数据。

## 四、 核心 UI 视觉哲学 (UI Design System)

本项目极其看重 **界面质感与现代审美**（参考已有的深浅色切换及配色系统）：

1. **变量化主题**：所有颜色必须使用 `src/main.css` 中预设的 CSS 变量（如 `var(--bg-base)`, `var(--text-primary)`, `var(--accent-yellow)`）。
2. **渐进式揭示 (Progressive Disclosure)**：如账号卡片采用的 **3D 翻转卡片 (Flip Card)** 设计，正面展示高频指标（账号邮箱、配额条），反面（点击触发）展示低频极客信息（底层 ID、认证路径）。
3. **警报色彩分级**：配额条大量运用了带高光的 `linear-gradient`，绿色代表充裕，黄色中等，红色告警。任何新增指示器必须遵循这套严密的色彩语义。

## 五、 最高工程行动准则 (CRITICAL RULES)

用户为本项目量身定制了以“**实事求是、抓主要矛盾**”为核心的独特开发约束（详情可查当前 prompt 中的 User Rules）。接手任务时，请严格贯彻以下红线：

1. **没有调查就没有发言权**：
   - 接到任务后，**必须先用 `view_file` 或 `grep_search` 审阅现有上下文**。不要凭空瞎猜结构或盲目套用通用模板。
2. **战术游击，拒绝形式主义**：
   - 能用原生 CSS 解决的，**严禁** 引入复杂的三方依赖。
   - 能在一个文件用简单函数解决的，**严禁** 过度设计（工厂模式、多层抽象等）。
   - 不留隔夜债：新增功能的同时，主动删除多余且不再使用的 Mock 代码或占位容器。
3. **群众路线（体验至上）**：
   - 对报错异常进行温柔的 UI 劫持（如 Toast 提示或优雅降级），不要让底层 Error 冲破到用户界面。
   - 代码可读性重于一切，给未来的维护者（也是 AI）留下自解释的变量语义。

---
当你阅读完本指南，你已经继承了 Aideck 的火种。请在下一步开发中继续保持这份简洁、动态且硬核的代码信仰！
