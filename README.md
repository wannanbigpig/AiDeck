# AiDeck

![Version](https://img.shields.io/badge/version-0.1.0-blue)
[![Stars](https://img.shields.io/github/stars/wannanbigpig/AiDeck?style=flat&color=gold)](https://github.com/wannanbigpig/AiDeck)
[![Issues](https://img.shields.io/github/issues/wannanbigpig/AiDeck)](https://github.com/wannanbigpig/AiDeck/issues)
[![Last Commit](https://img.shields.io/github/last-commit/wannanbigpig/AiDeck)](https://github.com/wannanbigpig/AiDeck)

一个面向本地桌面场景的 **AI IDE 多平台多账号管理工具**。

AiDeck 当前聚焦 **Antigravity**、**Codex**、**Gemini CLI** 三个平台，提供本地导入、OAuth / JSON / Token 导入、账号切换、配额展示、标签整理、批量导出与仪表盘总览等能力。

> **定位先说清楚：**
> 本项目用于 **学习、交流和本地研究** AI IDE 账号管理与配额展示方案。
> 它 **不是任何第三方平台的官方客户端、官方插件或官方授权管理工具**。

---

## 功能概览

### 仪表盘

- 统一查看三个平台账号数量、当前活跃账号与运行状态
- 支持搜索过滤，统计数字会跟随过滤条件实时变化
- 支持分平台折叠展示与当前账号高亮

### Antigravity 账号管理

- 支持本地导入、JSON 导入、Token 添加、OAuth 授权
- 展示模型配额、重置时间与可用 AI 积分
- 支持切号、批量刷新、设备身份绑定与查看
- 支持按需切换设备身份、恢复原始设备身份

### Codex 账号管理

- 支持从当前系统默认配置目录自动探测并导入当前账号
- 支持 OAuth / JSON / Token 添加账号
- 展示 5 小时、每周、代码审查配额
- 支持 Team / Plus / Free 等套餐识别、切号与标签管理

### Gemini CLI 账号管理

- 支持从当前系统默认配置目录自动探测并导入当前登录态
- 支持 OAuth / JSON / Token 添加账号
- 展示 5 小时与每周配额
- 支持切号注入、本地凭证回写与标签管理

### 通用能力

- 批量导出账号 JSON
- 批量设置标签
- 卡片翻转查看详情
- 本地未导入账号检测与手动导入
- 多平台设置页与风险提示

---

## 当前支持的平台

| 平台 | 本地导入 | OAuth | JSON / Token | 配额展示 | 切号注入 |
| --- | --- | --- | --- | --- | --- |
| Antigravity | 支持 | 支持 | 支持 | 支持 | 支持 |
| Codex | 支持 | 支持 | 支持 | 支持 | 支持 |
| Gemini CLI | 支持 | 支持 | 支持 | 支持 | 支持 |

---

## 技术栈

- `React 19`
- `Vite 6`
- `uTools preload` + Node.js 本地文件/网络能力
- 原生 CSS 变量主题系统

---

## 开发启动

### 1. 安装依赖

```bash
npm install
```

### 2. 启动前端开发服务

```bash
npm run dev
```

### 3. 在 uTools 开发者模式中加载插件目录

本项目的插件入口配置位于：

- `public/plugin.json`

其中开发模式会将主页面指向本地 Vite 服务：

- `http://localhost:5173`

如果你已经启动 `npm run dev`，在 uTools 中加载本仓库目录后即可联调。

---

## 项目结构

```text
Aideck/
├─ public/
│  ├─ plugin.json            # uTools 插件入口
│  └─ preload/               # 本地服务桥接层
├─ src/
│  ├─ pages/                 # Antigravity / Codex / Gemini / Dashboard / Settings
│  ├─ components/            # 通用组件与图标
│  └─ utils/                 # 平台格式化与设置工具
├─ tests/                    # Node test
└─ AI_ONBOARDING.md          # 项目接手说明
```

---

## 数据与安全

AiDeck 是一个 **本地工具**，账号数据和运行时状态主要保存在本机。

典型涉及的本地位置包括：

- 当前系统默认 `Codex` 配置目录中的 `auth.json`
- 当前系统默认 `Gemini CLI` 配置目录
- `~/.ai_deck/antigravity/`
- Antigravity 官方客户端本地运行态文件
- uTools 本地数据存储

需要联网的场景主要包括：

- OAuth 授权
- 配额刷新
- 官方接口状态查询
- GitHub / Issues / 文档跳转

**建议：**

- 仅在你合法拥有和有权使用的账号、令牌与设备环境中使用本项目
- 妥善保管本地凭证文件，不要直接分享用户目录
- 在公共或共用电脑上使用后及时清理本地账号数据

---

## 使用须知与免责声明

- 本项目用于 **学习、交流和本地研究**，不应被理解为规避平台策略的承诺工具
- 使用本项目时，你仍应自行遵守相关平台的服务条款、账号规则、API 使用规范以及所在地法律法规
- 如因频繁切号、异常请求、凭证泄露、账号风控、服务限流、账号停用或数据误操作导致任何问题，**风险由使用者自行承担**
- 本项目按 **“现状”** 提供，不附带任何明示或默示担保
- 项目作者与贡献者 **不对因使用、误用、依赖或无法使用本项目而产生的任何直接、间接、附带、特殊或后续损失承担责任**

---

## 反馈与支持

- ⭐ [GitHub Star](https://github.com/wannanbigpig/AiDeck)
- 💬 [反馈问题 / 提交建议](https://github.com/wannanbigpig/AiDeck/issues)
- ☕ [赞赏支持](./docs/DONATE.md)

如果你觉得 AiDeck 对你有帮助，可以前往 GitHub 点一个 Star。
这既是对作者工作的直接反馈，也能帮助更多人看到这个项目。
