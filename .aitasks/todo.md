# 任务：Codex 卡片背面显示订阅到期时间

## 目标
- 在 AiDeck 的 Codex 账号卡片背面补充订阅到期时间展示。
- 参考 `/Users/liuml/data/openSource/cockpit-tools` 项目 Codex 部分的字段与展示逻辑。

## 步骤
- [x] 审查项目规则与历史经验。
- [x] 定位 AiDeck Codex 卡片背面实现与账号字段来源。
- [x] 对照 cockpit-tools 的 Codex 订阅到期时间字段与格式化方式。
- [x] 最小范围实现展示逻辑与样式。
- [x] 执行相关测试或构建验证。
- [x] 记录修改内容、验证结果、风险与未验证项。

## 验证方法
- 优先运行与 Codex 工具函数或前端构建相关的现有测试。
- 若构建成本可控，运行项目现有构建或 lint。
- 检查新增字段在缺失、数字时间戳、ISO 字符串等输入下不会破坏渲染。

## 风险
- Codex 账号字段可能存在多个来源，需要沿用现有数据结构并兼容旧账号。
- 只应展示订阅到期时间，不改变账号切换、配额刷新或存储行为。

## 结果记录
- 修改内容：Codex 服务层从 `id_token` / profile / JSON 导入中保留 `subscription_active_until`；Codex 卡片背面新增“订阅到期”字段；前端工具函数兼容账号字段、`subscriptionActiveUntil` 和 `chatgpt_subscription_active_until`。
- 验证结果：`resolveCodexSubscriptionDisplay` 新增测试用例通过；`node -e` 直接导入前端工具函数与 `codexService.impl.cjs` 成功；`npm run build:utools` 成功。
- 未验证项：完整 `npm test -- --test-name-pattern=Codex` 在当前沙箱中仍触发既有失败，包括 `apps/desktop/src/main/preload.cjs` 缺失以及本地 `127.0.0.1` 监听 `EPERM`。
- 风险说明：旧账号没有可解析订阅字段时会显示“未知”，需要刷新配额、重新导入或重新授权后才可能补齐字段。

# 任务：配额刷新时间支持 1-60 分钟细粒度

## 目标
- 配额自动刷新间隔支持 1 分钟粒度。
- 可配置范围为 1-60 分钟，0 仍表示关闭自动刷新。

## 步骤
- [x] 定位刷新间隔归一化、UI 控件与运行时定时逻辑。
- [x] 修改共享刷新间隔工具与滑块控件。
- [x] 让 Gemini 设置接入共享归一化。
- [x] 增加或更新测试。
- [x] 执行验证并记录结果。

## 验证方法
- 运行刷新间隔归一化相关测试。
- 运行 uTools 前端构建验证 UI 编译链路。

## 风险
- 旧设置中的 5/10/15/30/60 应保持原值。
- 非法值需要被夹到 1-60，关闭态 `0` 不能被误改成 1。

## 结果记录
- 修改内容：共享刷新间隔范围改为 `1-60`，滑块 `step=1`，新增数字输入框；Gemini 设置接入 `normalizeRefreshIntervalMinutes`。
- 验证结果：`node --test --test-name-pattern=normalizeRefreshIntervalMinutes tests/platformRuntimeHelpers.test.cjs` 通过；`node -e` 验证刷新间隔和 Gemini 归一化通过；`npm run build:utools` 通过；`git diff --check` 通过。
- 未验证项：未运行完整测试套件，本仓库当前完整测试存在既有桌面 preload 缺失与本地监听 `EPERM` 问题。
- 风险说明：旧的 5/10/15/30/60 设置会原样保留；已有非法值会被归一化到关闭或 1-60 范围内。

# 任务：Codex 订阅到期按剩余天数着色

## 目标
- Codex 卡片背面的订阅到期时间按剩余时间显示颜色。
- 剩余 3 天内红色，剩余 10 天内黄色，大于 10 天绿色。

## 步骤
- [x] 定位订阅到期展示与颜色逻辑。
- [x] 在展示工具函数中补充阈值判断。
- [x] 卡片使用工具函数返回的颜色。
- [x] 增加阈值测试并验证。

## 验证方法
- 运行 `resolveCodexSubscriptionDisplay` 相关测试。
- 运行 uTools 前端构建。

## 结果记录
- 修改内容：`resolveCodexSubscriptionDisplay` 返回订阅颜色，Codex 卡片使用该颜色显示订阅到期时间。
- 验证结果：`node --test --test-name-pattern=resolveCodexSubscriptionDisplay tests/platformRuntimeHelpers.test.cjs` 通过；`npm run build:utools` 通过；`git diff --check` 通过。
- 未验证项：未运行完整测试套件，本仓库当前完整测试存在既有桌面 preload 缺失与本地监听 `EPERM` 问题。
- 风险说明：阈值按毫秒剩余时间判断，已过期和剩余 3 天内同属红色。

# 任务：Codex 订阅到期显示剩余天数

## 目标
- Codex 卡片背面的订阅到期日期后追加括号，显示剩余几天。

## 步骤
- [x] 定位订阅日期文本生成逻辑。
- [x] 修改展示文本。
- [x] 更新测试并验证。

## 验证方法
- 运行 `resolveCodexSubscriptionDisplay` 相关测试。
- 运行 uTools 前端构建。

## 结果记录
- 修改内容：订阅到期展示文本从纯日期改为 `日期（剩余 N 天）`，剩余天数向上取整，已过期显示 `剩余 0 天`。
- 验证结果：`node --test --test-name-pattern=resolveCodexSubscriptionDisplay tests/platformRuntimeHelpers.test.cjs` 通过；`npm run build:utools` 通过；`git diff --check` 通过。
- 未验证项：未运行完整测试套件，本仓库当前完整测试存在既有桌面 preload 缺失与本地监听 `EPERM` 问题。

# 任务：Codex/Gemini 卡片增加 CLI 启动按钮和默认终端设置

## 目标
- Codex 和 Gemini 账号卡片操作栏增加 CLI 按钮。
- 点击先检测对应 CLI 命令是否安装，未安装提示安装命令。
- 已安装时选择工作目录，然后切换账号并在默认终端中运行 `codex` 或 `gemini`。
- 全局设置常规首项增加默认终端设置。

## 步骤
- [x] 参考 cockpit-tools 默认终端和终端执行逻辑。
- [x] 补宿主 API：CLI 检测、可用终端列表、终端执行命令。
- [x] 常规设置增加默认终端选项。
- [x] Codex / Gemini 卡片增加 CLI 按钮和启动流程。
- [x] 增加关键测试并执行构建验证。

## 验证方法
- 运行新增终端工具单元测试。
- 运行 uTools 前端构建。
- 检查 `git diff --check`。

## 风险
- macOS 直执终端命令当前支持 Terminal / iTerm2；其他终端会提示改用支持项。
- CLI 命令检测依赖当前宿主进程可见的 `PATH`。

## 结果记录
- 修改内容：新增 `terminalLauncher` 宿主工具；uTools / Desktop preload 暴露 `getAvailableTerminals`、`getCommandStatus`、`launchCliCommand`；全局常规设置首项新增默认终端；Codex / Gemini 卡片增加 CLI 按钮并接入检测、选目录、切号、终端启动流程。
- 验证结果：`node --test tests/terminalLauncher.test.cjs` 通过；`node -e` 导入 `launchPlatformCli` 通过；`npm run build:utools` 通过；`npm run build:desktop` 通过；`git diff --check` 通过。
- 完整测试：`npm test` 跑到后段卡住，已中断；中断前有既有失败：`tests/desktopSmoke.test.cjs` 仍查找 `apps/desktop/src/main/preload.cjs`，Gemini OAuth 相关测试失败/未收尾。
- 风险说明：终端启动依赖宿主系统能力，macOS 当前仅直接支持 Terminal / iTerm2；未检测到 CLI 时会提示对应 `npm install -g ...` 安装命令。

# 任务：参考 cockpit-tools 增加全局通知提示

## 目标
- 参考 `/Users/liuml/data/openSource/cockpit-tools` 的全局通知/弹窗做法。
- CLI 未安装时使用全局提示展示安装命令，避免短 toast 信息丢失。

## 步骤
- [x] 调研 cockpit-tools 全局通知实现链路。
- [x] 对照 Aideck 现有 toast 与宿主通知能力。
- [x] 增加轻量全局提示组件与 Hook。
- [x] 将 Codex/Gemini CLI 未安装提示改为全局提示。
- [x] 执行构建与关键路径验证。

## 验证方法
- 运行 uTools / Desktop 构建。
- 运行 `git diff --check`。

## 风险
- 全局提示应只影响 CLI 未安装提示，不改变其他 toast 行为。
- 复制命令需要兼容无剪贴板权限的环境。

## 结果记录
- 修改内容：新增 `GlobalNoticeProvider` / `useGlobalNotice`，挂载到 `App` 顶层；CLI 未安装时改为全局提示展示安装命令，并提供复制按钮。
- 验证结果：`node -e` 导入 `launchPlatformCli` 成功；`node --test tests/terminalLauncher.test.cjs` 通过；`npm run build:utools` 通过；`npm run build:desktop` 通过；`git diff --check` 通过。
- 未验证项：未重新运行完整 `npm test`，此前完整测试存在既有桌面 preload 路径和 Gemini OAuth 相关失败/卡住问题。
- 风险说明：本次只替换 CLI 未安装提示方式，其他 toast 与宿主系统通知保持不变。

# 任务：默认终端列表展示系统已安装终端

## 目标
- 默认终端设置不应只显示“系统默认”。
- 参考 cockpit-tools，列出当前系统已安装的常见终端。

## 步骤
- [x] 定位终端探测与设置页加载链路。
- [x] 对照 cockpit-tools 的终端候选列表。
- [x] 扩展 macOS 终端探测候选。
- [x] 让设置页支持异步读取终端列表并保留兜底。
- [x] 执行测试与构建验证。

## 验证方法
- 直接调用 `terminalLauncher.getAvailableTerminals()` 验证本机返回 Terminal / iTerm2。
- 运行终端工具测试。
- 运行 uTools / Desktop 构建与 `git diff --check`。

## 风险
- 非 Terminal / iTerm2 终端的直接执行能力可能受终端自身命令行参数支持影响，需要保持错误提示。

## 结果记录
- 修改内容：macOS 终端探测从 Terminal / iTerm2 扩展到 Warp、Ghostty、WezTerm、Kitty、Alacritty、Tabby、Hyper；设置页改为异步加载终端列表，宿主结果为空时仍兜底显示系统默认。
- 验证结果：本机直接调用 `terminalLauncher.getAvailableTerminals()` 返回 `system`、`Terminal`、`iTerm2`；`node --test tests/terminalLauncher.test.cjs` 通过；`npm run build:utools` 通过；`npm run build:desktop` 通过；`git diff --check` 通过。
- 未验证项：未运行完整 `npm test`，此前完整测试存在既有桌面 preload 路径和 Gemini OAuth 相关失败/卡住问题。
- 风险说明：当前 macOS 直接执行仍稳定支持 Terminal / iTerm2，其他终端会先作为可选项显示；如果后续要求这些终端也直接执行命令，需要分别适配各终端的启动参数。

# 任务：修复 Codex/Gemini CLI 已安装但检测不到

## 目标
- 已安装 `codex` / `gemini` CLI 时，卡片 CLI 按钮不应误提示未安装。
- 参考 cockpit-tools 的运行时搜索目录逻辑，兼容 GUI 应用较短的 `PATH`。

## 步骤
- [x] 对比当前 shell 与 Node 检测结果。
- [x] 参考 cockpit-tools CLI 搜索目录实现。
- [x] 增强 CLI 命令解析目录。
- [x] 终端启动时使用解析到的命令路径。
- [x] 增加测试并执行构建验证。

## 验证方法
- 本机直接检测 `codex` / `gemini` 状态。
- 模拟受限 `PATH` 时仍能从 `~/.npm-global/bin` 找到 CLI。
- 运行终端工具测试、构建与 `git diff --check`。

## 风险
- 终端中展示的执行命令可能使用 CLI 完整路径，以避免终端环境 PATH 不一致。

## 结果记录
- 修改内容：`terminalLauncher` 增加运行时搜索目录，除进程 `PATH` 外补充 Homebrew、`~/.npm-global/bin`、`~/.npm/bin`、`~/.local/bin`、`~/.volta/bin`、`~/.bun/bin`、`~/.nvm/versions/node/*/bin` 等；`getCommandStatus` 返回解析到的 `path`；启动终端时使用解析到的完整 CLI 路径执行。
- 验证结果：本机正常 PATH 和受限 PATH(`/usr/bin:/bin`) 下均检测到 `/Users/liuml/.npm-global/bin/codex`、`/Users/liuml/.npm-global/bin/gemini`；`node --test tests/terminalLauncher.test.cjs` 通过；`npm run build:utools` 通过；`npm run build:desktop` 通过；`git diff --check` 通过。
- 未验证项：未运行完整 `npm test`，此前完整测试存在既有桌面 preload 路径和 Gemini OAuth 相关失败/卡住问题。
- 风险说明：终端里会执行 CLI 的完整路径，避免 GUI 应用和终端 shell 的 `PATH` 不一致导致启动失败。

# 任务：增加消息通知中心与未读自动弹窗

## 目标
- 参考 cockpit-tools 的消息通知中心。
- 通知按钮放在侧边栏底部全局工具区，位于“日志/设置”上方。
- 有未读且 `popup=true` 的消息时自动弹窗展示。
- 支持远程读取仓库 `announcements.json`、本地缓存、已读状态、刷新、全部已读。

## 步骤
- [x] 调研 Aideck 当前侧边栏和全局弹窗布局。
- [x] 确定按钮放置位置：侧边栏底部全局工具区。
- [x] 增加公告宿主服务、缓存与已读记录。
- [x] 前端接入公告状态 Hook 和 hostBridge API。
- [x] 增加消息通知弹窗组件、侧边栏按钮和未读角标。
- [x] 增加仓库根公告 JSON 示例。
- [x] 执行测试、构建和差异检查。

## 验证方法
- 使用本地公告文件测试服务过滤、未读、全部已读。
- 运行公告服务测试。
- 运行 uTools / Desktop 构建和 `git diff --check`。

## 风险
- 远程 GitHub raw 网络失败时应回退缓存或空列表。
- 自动弹窗必须只对未读弹出，关闭后标记已读，避免重复打扰。

## 结果记录
- 修改内容：新增 `announcementService`，支持 GitHub raw 远程公告、本地缓存、已读 ID；uTools/Desktop preload 暴露公告 API；新增 `useAnnouncements` 和 `AnnouncementCenter`；侧边栏底部新增“消息”入口与未读角标；仓库根新增 `announcements.json` 示例。
- 验证结果：`node --test tests/announcementService.test.cjs tests/terminalLauncher.test.cjs` 通过；`node -e` 导入 `useAnnouncements` 通过；本地公告文件读取验证返回 1 条未读；`npm run build:utools` 通过；`npm run build:desktop` 通过；`git diff --check` 通过。
- 未验证项：未运行完整 `npm test`，此前完整测试存在既有桌面 preload 路径和 Gemini OAuth 相关失败/卡住问题。
- 风险说明：默认远程地址为 `https://raw.githubusercontent.com/wannanbigpig/AiDeck/main/announcements.json`，发布前需要确保该文件已提交到默认分支；自动弹窗只对 `popup: true` 且未读的第一条消息触发。

# 任务：本次更新写入消息并让开发环境读取本地公告

## 目标
- 将本次 Codex/Gemini CLI、订阅到期、刷新粒度和通知中心更新写入公告消息。
- 开发环境直接读取仓库根目录 `announcements.json`，不依赖远程 GitHub Raw。
- 消息支持置顶，排序规则为置顶优先，同组内按发布时间倒序。

## 步骤
- [x] 审查现有公告服务的本地覆盖和远程读取链路。
- [x] 增加开发环境本地公告文件优先逻辑。
- [x] 更新 `announcements.json` 的本次更新消息内容。
- [x] 增加公告置顶字段与排序规则。
- [x] 增加测试覆盖开发环境本地读取。
- [x] 执行测试、构建和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行 `node --test tests/announcementService.test.cjs`。
- 运行 `npm run build:utools`。
- 运行 `npm run build:desktop`。
- 运行 `git diff --check`。

## 风险
- 开发环境判断不能影响生产环境远程读取。
- 本地公告读取应继续保留 `AIDECK_ANNOUNCEMENT_FILE` 手动覆盖能力。

## 结果记录
- 修改内容：`announcementService` 开发环境默认读取仓库根 `announcements.json`，仍保留 `AIDECK_ANNOUNCEMENT_FILE` 显式覆盖；公告新增 `pinned` 字段，排序规则改为置顶优先、同组内按 `createdAt` 倒序；通知中心前端增加置顶兜底排序和“置顶”标识；根公告文件写入本次更新内容并设为置顶弹窗。
- 验证结果：`node --test tests/announcementService.test.cjs tests/terminalLauncher.test.cjs` 通过；本地公告读取验证返回根目录 `announcements.json`，首条为置顶更新消息且 `popupAnnouncement` 命中；`npm run build:utools` 通过；`npm run build:desktop` 通过；`git diff --check` 通过。
- 未验证项：未运行完整 `npm test`，此前完整测试存在既有桌面 preload 路径和 Gemini OAuth 相关失败/卡住问题。
- 风险说明：生产环境仍默认走 GitHub Raw 和缓存；开发环境源代码方式运行会优先读本地公告文件，若要强制远程可设置 `AIDECK_ANNOUNCEMENT_DEV_LOCAL=0`。

# 任务：修复 uTools dev 模式消息为空

## 目标
- 修复 uTools dev 模式打开消息通知时显示“暂无消息”。
- 确保源码 preload 和构建后的 `dist/preload` dev 加载方式都能读取本地 `announcements.json`。

## 步骤
- [x] 检查 uTools 插件入口、preload 转发和公告 API 暴露链路。
- [x] 扩展公告服务的开发态路径识别。
- [x] 增加路径识别测试。
- [x] 执行公告服务测试、构建和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行 `node --test tests/announcementService.test.cjs`。
- 运行 `npm run build:utools`。
- 运行 `git diff --check`。

## 风险
- 不能让生产环境误读本地开发公告。
- uTools dev 可能加载源码 preload，也可能加载 `dist/preload`，两种路径都要兼容。

## 结果记录
- 修改内容：`announcementService.isDevelopmentRuntime` 增加 `dist/preload` 识别，当仓库根目录存在 `announcements.json` 时，uTools 构建产物 preload 也按开发态读取本地公告；新增对应测试。
- 根因：uTools dev 模式实际可能加载 `dist/preload/services.js`，此前开发态判断只覆盖源码路径，导致公告服务仍走远程 Raw；远程无可用公告时列表显示“暂无消息”。
- 验证结果：`node --test tests/announcementService.test.cjs tests/terminalLauncher.test.cjs` 通过；`npm run build:utools` 通过；`npm run build:desktop` 通过；模拟加载 `dist/preload/services.js` 后返回 2 条消息，首条为置顶更新消息且 `popupAnnouncement` 命中；`git diff --check` 通过。
- 未验证项：未在真实 uTools GUI 内热重载验证；需要重新加载 uTools 插件或重启开发窗口让新的 preload 生效。
- 风险说明：`dist/preload` 只有在其上两级存在仓库根 `announcements.json` 时才按开发态处理，降低生产环境误读本地文件的风险。

# 任务：优化消息通知弹框样式

## 目标
- 优化消息详情弹框视觉层次。
- 修复通知弹框未使用项目通用 modal 外壳样式导致的铺满感。
- 让详情弹框更紧凑、正文更易读、底部操作区更自然。

## 步骤
- [x] 检查当前通知组件和通用 modal 样式。
- [x] 调整消息详情结构与 CSS。
- [x] 执行构建和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行 `npm run build:utools`。
- 运行 `git diff --check`。

## 风险
- 不影响其他通用弹窗样式。
- 列表弹窗和自动详情弹窗都要保持可用。

## 结果记录
- 修改内容：通知列表和详情弹窗补齐独立卡片外壳；详情弹窗宽度收紧，新增圆角、边框、阴影和进入动画；详情头部改为标签/时间在上、标题在下；正文和底部操作区重新调整间距，去掉大片灰色 footer 的突兀感。
- 根因：通知组件使用 `className="modal"`，但项目通用外壳样式实际绑定在 `.modal-content`，导致消息详情缺少卡片背景、圆角、边框和尺寸约束。
- 验证结果：`node --test tests/announcementService.test.cjs` 通过；`npm run build:utools` 通过；`npm run build:desktop` 通过；`git diff --check` 通过。
- 未验证项：未在真实 uTools 窗口截图复验，需要重新加载插件后查看最新样式。
- 风险说明：样式作用域限定在 `.announcement-*` 和 `.announcement-detail-modal`，不影响其他通用弹窗。

# 任务：项目减负为仅支持 uTools

## 目标
- 项目不再维护多端宿主，只保留 uTools 插件端。
- 根工作区、构建脚本、发布脚本、README 和测试去除 Desktop/Electron 端支持。
- 保留 `packages/*` 共享业务代码，继续服务 uTools。

## 步骤
- [x] 审查 workspace、构建脚本、发布脚本、README、测试和 desktop 源码引用。
- [x] 调整根 `package.json` 和 lockfile，仅保留 uTools workspace 与脚本。
- [x] 移除 Electron Desktop app 源码入口。
- [x] 调整发布脚本为 uTools 构建产物校验。
- [x] 更新 README 和测试，去掉桌面端支持断言。
- [x] 执行测试、uTools 构建和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行与结构相关的测试：`node --test tests/preloadStructure.test.cjs tests/hostBridge.test.cjs tests/settingsStore.test.cjs`。
- 运行公告/终端测试：`node --test tests/announcementService.test.cjs tests/terminalLauncher.test.cjs`。
- 运行 `npm run build`，确认默认构建只构建 uTools。
- 运行 `npm run release`，确认发布脚本只处理 uTools `dist`。
- 运行 `git diff --check`。

## 风险
- 移除 Desktop workspace 后 lockfile 会有较大依赖裁剪。
- 部分共享代码仍使用通用 HostBridge 命名，不应为了单端强行重构公共协议。

## 结果记录
- 修改内容：根 workspace 从 `apps/*` 收窄为 `apps/utools`；移除 `dev:desktop`、`build:desktop*` 和 Electron 根依赖；删除 `apps/desktop` 源码入口和 `tests/desktopSmoke.test.cjs`；`release` 改为只构建 uTools `dist` 并生成 `SHA256SUMS.txt`；README 改为 uTools 单端说明；结构测试改为断言不再保留 Desktop 宿主源码；uTools preload 后置构建移除 Electron external；操作日志打开目录移除 Electron fallback。
- 根因：项目此前保留 uTools 和 Electron Desktop 两套宿主，导致 workspace、构建脚本、发布脚本、测试和依赖树都要同时照顾多端，维护成本偏高。
- 验证结果：`node --test tests/preloadStructure.test.cjs tests/hostBridge.test.cjs tests/settingsStore.test.cjs` 通过；`node --test tests/announcementService.test.cjs tests/terminalLauncher.test.cjs` 通过；`npm run build` 通过且只构建 uTools；`npm run release` 通过并生成 `dist/SHA256SUMS.txt`；`git diff --check` 通过。
- 未验证项：未运行完整 `npm test`；本次按单端改造重点运行结构、HostBridge、设置、公告、终端和构建发布链路。
- 风险说明：`package-lock.json` 已裁掉 Desktop workspace 和 Electron/Electron Builder 直接依赖；`electron-to-chromium` 仍作为前端构建链路的 Browserslist 间接依赖保留，不代表继续支持 Electron Desktop。

# 任务：移除 electron-to-chromium 间接依赖

## 目标
- 继续按 uTools 官方方式接入：React/Vite 源码编译成 `dist` 中的普通 `html/css/js`，preload 保持 CommonJS 本地能力入口。
- 移除 `electron-to-chromium` 及其 Babel/Browserslist 间接链路。
- 保留 uTools 单端必要依赖。

## 步骤
- [x] 查清 `electron-to-chromium` 依赖来源。
- [x] 将 `@vitejs/plugin-react` 替换为 `@vitejs/plugin-react-swc`。
- [x] 更新 Vite 配置和 lockfile。
- [x] 验证依赖树不再包含 `electron-to-chromium`。
- [x] 执行 uTools 构建、发布和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行 `npm ls electron-to-chromium --all`。
- 运行 `npm run build`。
- 运行 `npm run release`。
- 运行 `git diff --check`。

## 风险
- React 编译器从 Babel 插件切换到 SWC 插件，需要确认现有 JSX 构建仍正常。
- uTools preload 仍应保持 CommonJS 和本地能力打包逻辑。

## 结果记录
- 修改内容：将 `apps/utools` 的 Vite React 插件从 `@vitejs/plugin-react` 替换为 `@vitejs/plugin-react-swc`；更新 `apps/utools/vite.config.js` 和 `package-lock.json`，裁掉 Babel/Browserslist 链路中的 `electron-to-chromium`。
- 根因：`electron-to-chromium` 是由 `@vitejs/plugin-react -> @babel/core -> @babel/helper-compilation-targets -> browserslist` 间接引入，不是 uTools 运行需要，也不是项目继续支持 Electron Desktop。
- 验证结果：`npm ls electron-to-chromium --all` 返回 empty；`rg` 确认 lockfile 中不再包含 `electron-to-chromium`、`browserslist`、`@babel/core`；`node --test tests/preloadStructure.test.cjs tests/announcementService.test.cjs tests/terminalLauncher.test.cjs` 通过；`npm run build` 通过；`npm run release` 通过；`git diff --check` 通过。
- 未验证项：未在真实 uTools 开发窗口重新加载验证热更新体验；构建产物已验证。
- 风险说明：React 编译器切换为 SWC，正常 JSX 构建通过；若后续依赖 Babel 插件能力，需要显式评估再加入。

# 任务：删除非 uTools 旧入口和兼容层

## 目标
- 不再兼容历史根目录 Vite 入口、根 `public` 转发层和 preload lib wrapper。
- 只保留 `apps/utools` 官方插件目录结构和当前功能需要的共享包。
- 删除旧架构记忆文档，避免后续维护被多端/旧桥接误导。

## 步骤
- [x] 扫描旧根入口、旧 public、preload wrapper 和兼容 JS wrapper。
- [x] 删除根 `src`、根 `public`、根 `index.html`、根 `vite.config.js`、`test_api.js`。
- [x] 删除 `apps/utools/public/preload/lib` 和未被当前链路使用的 `.js` wrapper。
- [x] 删除旧 `MEMORY.md`。
- [x] 更新 README、CI、jsconfig 和测试。
- [x] 执行测试、构建、发布和残留扫描。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行 `node --test tests/preloadStructure.test.cjs tests/multiPlatformPaths.test.cjs tests/platformRuntimeHelpers.test.cjs`。
- 运行公告/终端测试。
- 运行 `npm run build`。
- 运行 `npm run release`。
- 运行残留关键字扫描和 `git diff --check`。

## 风险
- 删除旧 wrapper 后，测试或脚本必须直接使用当前 `apps/utools` 和 `packages` 路径。
- 只删除与旧宿主/旧入口相关的兼容层，不删除 Antigravity/Codex/Gemini 当前业务能力里的多系统路径支持。

## 结果记录
- 修改内容：删除根 `src`、根 `public`、根 `index.html`、根 `vite.config.js`、`test_api.js`、`MEMORY.md`、`apps/utools/public/preload/lib`、未使用的 infra/platform `.js` 转发 wrapper；CI 只保留 uTools 构建；README logo 和结构说明指向 `apps/utools`；`jsconfig` 只包含当前 uTools/app-shell 源码；测试改为直接使用当前 `packages` 路径。
- 根因：这些文件是旧根应用、旧 preload 转发层或多端/旧桥接记忆，不是当前 uTools 单端运行链路的一部分。
- 验证结果：`node --test tests/preloadStructure.test.cjs tests/multiPlatformPaths.test.cjs` 通过；`node --test --test-name-pattern="normalizeRefreshIntervalMinutes|resolveCodexSubscriptionDisplay|三平台服务应暴露统一共享契约入口" tests/platformRuntimeHelpers.test.cjs` 通过；`node --test tests/announcementService.test.cjs tests/terminalLauncher.test.cjs tests/hostBridge.test.cjs tests/settingsStore.test.cjs` 通过；`npm run build` 通过；`npm run release` 通过；`npm ls electron-to-chromium --all` 返回 empty；残留扫描未发现旧根入口、Desktop、Babel/Browserslist/Electron 依赖链。
- 未验证项：完整 `tests/platformRuntimeHelpers.test.cjs` 组合运行在后段卡住，已中断；已改跑与本次清理相关的定向测试。
- 风险说明：已删除旧入口和 wrapper，不再支持从根 `public/plugin.json` 或根 `src` 启动；当前入口统一为 `apps/utools`，构建产物统一为根 `dist`。

# 任务：优化公告编号、多语言和版本提示

## 目标
- 公告详情里的更新项使用 `1.`、`2.` 这类编号展示，减少长段落堆叠。
- 公告内容支持按当前系统语言读取本地化标题、摘要、正文和按钮文案。
- 当公告版本与当前应用版本不一致时，在消息详情中提示可更新版本。

## 步骤
- [x] 检查公告服务、前端公告弹框和现有公告数据结构。
- [x] 为公告规范化结果补充版本字段，并补充本地化测试覆盖。
- [x] 调整公告详情渲染，支持编号列表和版本差异提示。
- [x] 更新 `announcements.json` 的 v1.0.2 公告内容与多语言文案。
- [x] 执行公告测试、构建和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行 `node --test tests/announcementService.test.cjs`。
- 运行 `npm run build`。
- 运行 `git diff --check`。

## 风险
- 公告服务继续保持旧公告兼容，缺少 `version` 的公告不能影响展示。
- 编号渲染只处理显式编号行，不改变普通公告正文。

## 结果记录
- 修改内容：公告规范化结果新增 `version` 字段；本地化匹配支持完整 locale 和主语言码；消息详情正文会将 `1.`、`2.` 编号行渲染为有序列表并跳过空白行；版本号与当前 `APP_VERSION` 不一致时显示更新提示；`announcements.json` 的 v1.0.2 公告改为编号更新项，并补充 `en-US` 文案。
- 根因：公告正文之前按换行逐段渲染，空行会产生大段留白，更新项也只是普通段落；公告缺少单条消息版本字段，前端无法判断公告版本与当前应用版本是否不一致；本地化只支持部分 locale 精确匹配。
- 验证结果：`node --test tests/announcementService.test.cjs` 通过；`node --test tests/preloadStructure.test.cjs tests/announcementService.test.cjs` 通过；`npm run build` 通过；`git diff --check` 通过；`announcements.json` 已通过 Node 解析并确认首条公告版本为 `1.0.2` 且中英文内容均为编号项；模拟根目录 `preload/services.js` 可读取 `/Users/liuml/.ai_deck`，Antigravity/Codex/Gemini 账号数为 4/4/4。
- 未验证项：未在真实 uTools 窗口截图复验弹框视觉效果，需要重新加载插件后查看。
- 风险说明：旧公告没有 `version` 时不会显示版本差异提示；本地化只会覆盖公告内容，不改变应用其他中文 UI。

# 任务：按 uTools 应用市场状态调整版本提示

## 目标
- 避免 GitHub 公告先发布、uTools 应用市场仍审核中时直接提示用户更新。
- 公告支持 `releaseStatus`，区分审核中和已上架。
- v1.0.2 当前提示为“等待应用市场审核通过后更新并重启插件”。

## 步骤
- [x] 检查现有版本提示逻辑和公告数据。
- [x] 在公告规范化结果里保留应用市场发布状态。
- [x] 前端按 `reviewing` / `available` 展示不同提示。
- [x] 更新 v1.0.2 公告状态为审核中。
- [x] 执行公告测试、构建和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行 `node --test tests/announcementService.test.cjs`。
- 运行 `npm run build`。
- 运行 `git diff --check`。

## 风险
- 缺少 `releaseStatus` 的旧公告应保持原有展示，不影响普通消息。
- 只有应用市场状态为已上架时才能提示“可更新”。

## 结果记录
- 修改内容：公告规范化新增 `releaseStatus` 和 `marketVersion`；消息详情按状态展示提示，`reviewing`/`pending` 显示“已提交 uTools 应用市场审核，审核通过后请更新并重启插件”，`available`/`released`/`published` 才显示“请在 uTools 应用市场更新后重启插件”；v1.0.2 公告当前标记为 `releaseStatus: reviewing`、`marketVersion: 1.0.1`。
- 根因：GitHub 公告发布时间不等于 uTools 应用市场可更新时间，单纯比较公告版本和当前插件版本会在审核未通过时提前提示用户更新。
- 验证结果：`node --test tests/announcementService.test.cjs` 通过；`npm run build` 通过；`git diff --check` 通过；Node 解析确认首条公告为 `version: 1.0.2`、`releaseStatus: reviewing`、`marketVersion: 1.0.1`。
- 未验证项：未在真实 uTools 窗口截图复验提示文案。
- 风险说明：审核通过后需要把远程公告里的 `releaseStatus` 改为 `available`，并把 `marketVersion` 改为已上架版本，用户才会看到正式更新提示。

# 任务：调整 Codex 配额展示并移除代码审查额度开关

## 目标
- Codex 设置中不再显示“代码审查额度”开关。
- Codex 卡片以后不再展示代码审查额度。
- 根据当前 Plus/Pro 返回结构展示主 5 小时、主每周、Pro 额外模型额度和积分余额。

## 步骤
- [x] 检查 Codex 设置、配额解析和卡片展示链路。
- [x] 移除代码审查额度设置项和前端展示逻辑。
- [x] 解析 `additional_rate_limits` 和 `credits` 字段。
- [x] 设计并实现 Codex 卡片额度展示。
- [x] 增加或调整测试覆盖。
- [x] 执行相关测试、构建和 diff 检查。

## 验证方法
- 运行 Codex 配额解析相关测试。
- 运行 `npm run build`。
- 运行 `git diff --check`。

## 风险
- 旧账号已有 `showCodeReviewQuota` 设置需要自然失效，不能影响其他设置读取。
- Pro 额外模型额度只在接口返回 `additional_rate_limits` 时展示，Plus 不应出现空组。

## 结果记录
- 修改内容：移除 Codex 设置弹窗里的代码审查额度开关；Codex 卡片不再接收或展示代码审查额度；Codex 配额解析不再回退生成 `code_review_*` 字段，新增解析 `additional_rate_limits` 为额外模型 5 小时/每周额度，新增解析 `credits` 并在卡片展示“剩余额度”；旧 `showCodeReviewQuota` 设置会在归一化时删除。
- 展示设计：Plus 展示主 `5小时`、主 `每周`、`剩余额度`；Pro 在主 `5小时` 和主 `每周` 下追加 `additional_rate_limits` 中每个模型的 `5小时` 与 `每周`，例如 `GPT-5.3-Codex-Spark 5小时`、`GPT-5.3-Codex-Spark 每周`，最后展示 `剩余额度`。
- 根因：当前 Plus/Pro 返回里的 `code_review_rate_limit` 为 `null`，代码之前在没有独立代码审查窗口时把周配额回退成代码审查额度，导致 UI 展示出并不存在的“代码审查”额度。
- 验证结果：`node --test --test-name-pattern="normalizeCodexAdvancedSettings|Codex 配额解析|三平台预警设置" tests/platformRuntimeHelpers.test.cjs` 通过；`npm run build` 通过；`git diff --check` 通过；用用户给出的 Plus/Pro 结构模拟解析，Plus 得到 5 小时 100%、每周 0%、额外模型 0 个、额度 0，Pro 得到 5 小时 46%、每周 89%、Spark 额外模型 100%/100%、额度 0。
- 未验证项：未在真实 uTools 窗口截图复验卡片多行额度高度。
- 风险说明：后续如果 Codex 官方重新提供真正独立的 `code_review_rate_limit`，本项目也会继续忽略，不再展示代码审查额度。

# 任务：调整 Codex 剩余额度位置

## 目标
- Codex 卡片的“剩余额度”固定显示在底部操作栏上方。
- 避免它混在配额条列表里，造成位置不稳定。

## 步骤
- [x] 检查当前 Codex 卡片布局和样式。
- [x] 将剩余额度从配额列表移到分割线上方。
- [x] 调整样式间距，保持空配额时仍有兜底。
- [x] 执行构建和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行 `npm run build`。
- 运行 `git diff --check`。

## 风险
- Pro 账号额外模型较多时，底部信息不能遮挡操作栏。

## 结果记录
- 修改内容：`CodexAccountItem` 将“剩余额度”、分割线、操作栏包进 `codex-card-bottom` 底部组；`.codex-card-bottom` 使用 `margin-top: auto`，并覆盖底部分割线间距。
- 根因：仅给“剩余额度”设置 `margin-top: auto` 时，后面的分割线自身也有 `margin: auto 0 10px`，真正被推到底的是分割线而不是额度文本，导致额度仍停在中间。
- 验证结果：`npm run build` 通过；`git diff --check` 通过。
- 未验证项：未在真实 uTools 窗口截图复验位置。
- 风险说明：如果 Pro 额外模型很多，卡片高度会继续被配额内容撑高；目前不会遮挡操作栏。

# 任务：调整 Codex 平台排序

## 目标
- 侧边栏中 Codex 放到仪表盘下面第一个。
- 仪表盘账号分组中 Codex 也放第一个。

## 步骤
- [x] 检查侧边栏平台数组和仪表盘分组排序。
- [x] 调整侧边栏平台顺序。
- [x] 调整仪表盘分组顺序。
- [x] 执行构建和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 运行 `npm run build`。
- 运行 `git diff --check`。

## 风险
- 只改展示排序，不影响平台 ID、路由和账号数据读取。

## 结果记录
- 修改内容：侧边栏平台顺序调整为 `dashboard -> codex -> antigravity -> gemini`；仪表盘分组新增固定排序 `codex -> antigravity -> gemini`。
- 根因：侧边栏和仪表盘此前依赖原始数组/对象顺序，Codex 排在 Antigravity 后面。
- 验证结果：`npm run build` 通过；`git diff --check` 通过。
- 未验证项：未在真实 uTools 窗口截图复验排序。
- 风险说明：仅调整展示顺序，平台 ID 和数据结构未变。

# 任务：修复 Codex 旧配额结构进入页面不自动显示新额度

## 目标
- 升级后再次进入 Codex 页面时，旧本地配额结构能自动补齐新字段。
- 配额结构变化时 snapshot 能正确刷新 UI。
- 避免用户必须手动点击刷新配额才能看到新额外模型额度。

## 步骤
- [x] 检查 Codex 页面进入、自动刷新、snapshot 指纹和配额解析链路。
- [x] 为 Codex 新配额结构增加 schema 版本。
- [x] Codex 页面检测旧 schema 后静默刷新一次。
- [x] 将 quota 关键字段纳入 snapshot 指纹。
- [x] 增加或调整测试覆盖。
- [x] 执行相关测试、构建和 diff 检查。

## 验证方法
- 运行 Codex 配额解析与 snapshot 相关测试。
- 运行 `npm run build`。
- 运行 `git diff --check`。

## 风险
- 旧 schema 自动刷新只应触发一次，不能造成进入页面反复刷新。
- 配额指纹不能过大，避免无意义重渲染。

## 结果记录
- 修改内容：Codex 配额解析结果新增 `schema_version: 2`；Codex 页面检测到账号本地配额 schema 小于 2 时，进入页面后静默触发一次全量配额刷新；`usePlatformSnapshot` 的账号指纹纳入 quota schema、更新时间、主额度、额外模型额度和积分余额。
- 根因：新额外模型额度来自新接口解析结果，旧本地配额没有 `additional_rate_limits`；页面重新进入时只读取本地旧配额，不会自动调用接口补字段，同时 snapshot 指纹未覆盖 quota 关键字段，配额结构变化时容易不刷新 UI。
- 验证结果：`node --test --test-name-pattern="Codex 配额解析|normalizeCodexAdvancedSettings|shouldEnableStandaloneTokenAutoRefresh" tests/platformRuntimeHelpers.test.cjs` 通过；`npm run build` 通过；`git diff --check` 通过。
- 未验证项：未在真实 uTools 窗口复验旧配额首次进入时的静默刷新。
- 风险说明：旧 schema 自动刷新每次页面挂载最多触发一次；刷新失败时下次重新进入页面会再次尝试。

# 任务：版本号更新到 1.0.2

## 目标
- 将 AiDeck 当前应用版本统一更新为 `1.0.2`。
- 保持 uTools 插件配置、运行时公告版本和 npm workspace 版本一致。

## 步骤
- [x] 定位项目版本声明位置。
- [x] 更新根包、uTools 包、各 workspace 包、uTools `plugin.json` 和运行时 `APP_VERSION`。
- [x] 刷新 `package-lock.json`。
- [x] 执行构建和 diff 检查。
- [x] 记录修改内容、验证结果和风险。

## 验证方法
- 使用 `rg` 确认应用版本声明为 `1.0.2`。
- 运行 `npm run build`。
- 运行 `git diff --check`。

## 结果记录
- 修改内容：`package.json`、`apps/utools/package.json`、`packages/*/package.json`、根 `plugin.json`、`apps/utools/public/plugin.json`、`packages/app-shell/src/runtime/useAnnouncements.js`、README 版本徽标和 `package-lock.json` 更新到 `1.0.2`。
- 根因：当前发布配置和运行时公告版本仍停留在 `1.0.1`，会导致 uTools 插件版本与本次 `v1.0.2` 公告不一致。
- 验证结果：`rg` 确认应用版本声明已为 `1.0.2`；`npm run build` 通过；`git diff --check` 通过。
- 未验证项：未在真实 uTools 开发者工具中重新导入插件查看版本号。
- 风险说明：`package-lock.json` 已按当前 uTools-only workspace 重新生成，顺带移除了旧桌面端依赖锁定项，符合此前项目减负方向。
