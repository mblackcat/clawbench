# VexelBench → ClawBench 公共功能回迁计划

源（定制版，只读，SVN，无历史）：`/Users/joeyzhao/Documents/vexel/vx-tools/vexelbench`（下称 VB）
目标（开源版）：本仓库（下称 OSS），集成分支 `feat/vb-port`

辅助：`/tmp/vbnorm.sh <相对路径>` 输出 OSS→VB 的 unified diff（已把品牌名归一化，`+` 行 = VB）。VB 独有文件直接读。

## 全局规则（所有执行者必须遵守）

1. **只做加法，绝不删除 OSS 功能。** VB 在很多文件里把新功能和"删除 AI Chat / AI Agents / OpenClaw / Hermes / MCP / skill / prompt / link / 7 个编码 CLI（gemini, opencode, trae, qoder, kimi, zcode, mimo, qwen 兼容）"揉在一起。禁止整文件覆盖，必须逐 hunk 挑选。OSS 的多资源类型、Tab/平铺视图切换、技能安装、`developer:package-dir`、`install-skill-from-market`、`togglePinnedApp`、Python 校验按钮、每小时自动天气、日志红点（70651cc）、Copiper 新版工具栏（9f81200）、Claude 标题清洗（87f90b9 `isMeta` + sanitize）、admin 面板 App Manage / 多类型 Dashboard / useTheme 单例 / common-app 创建删除 等全部保留。
2. **定制特有内容一律不带入：** 品牌（VexelBench / Vexel工作台 / vexeltech / `vb-` 前缀 / `vx.` ID 前缀 / `vexel-terminal` / `data-vb-*`）、LICENSE/README、toolshub / 192.168.100.220 / svn 内网、`setup-project.ts`、PM2 实例数、公司专用 seed 和内置应用（vg1-client / feedback / env-check / launch-client）、4 类分类白名单的**存量改写迁移**、"AI Coding→AI Work"改名、app-only 限制、`/store` 移除、Dashboard 字段替换。
3. **命名映射：** `vb-`→`cb-`，`vexelbench`→`clawbench`，内置前缀 `com.clawbench.builtin.`，协议 scheme 用 OSS 现有的，MCP 名 `clawbench-terminal`，应用 ID 前缀 `cb.`。
4. **OSS 规范：** 用户可见文案走 `t('key')`（zh-CN + en 都要加）；主进程文案走 `main/utils/i18n.ts`；颜色用 `theme.useToken()`，禁止硬编码；`App.useApp()`；antd 非废弃 API。VB 里硬编码的中文/颜色移植时修正。
5. **已知 VB bug 不得照搬：**
   - `protocol/commands/cmd.command.ts`（URL 触发任意 shell 命令 = RCE）——**不移植 cmd 命令**；`app`+`autoInstall` 需用户确认。
   - `admin-panel/src/hooks/useApi.ts` 401 判断里被替换坏的路径 → 应排除登录请求本身（`/auth/login` 之类，按 OSS 实际登录路径）。
   - `postgres.schema.ts` 里 `ALTER common_app_events` 在 `CREATE TABLE` 之前。
   - `ipc-validation.ts`：`validatePermissionMode` 白名单与 renderer 实际值不符；`VALID_TOOL_TYPES` 需含 OSS 全部工具；`validateDirPath/FilePath` 误杀含 `..` 的目录名和 Windows `C:\`；`validateCommand` 拦反引号——须重写后再用。
   - AI Terminal `validateSQL` 白名单会挡 DDL——改为"危险语句二次确认"或不加。
   - `urlMetadata.service` 无私网/localhost 拦截——加 SSRF 防护；UA 改名。
   - `trust proxy`、限流阈值改为环境变量可配；release 白名单补 `.yml` `.blockmap`。
   - venv 硬编码阿里云 pip 镜像 → 可配置/默认不设；`ensureWindowsPythonPathPriority` 改写注册表 PATH → 做成可选（默认只改进程内 PATH）。
6. **每个执行者：** 完成后 `cd frontend && npm run typecheck && npx vitest run`（基线：129 通过 + 5 个既有 `appSchedule` unhandled error），后端 `cd backend && npx jest`（基线 258 通过）。不允许新增失败。小步提交，conventional commit 英文消息，末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。**不要 push**（集成者统一推）。

## 产品决策（用户已确认）

- A / B / C 三档全部合入；定制特有部分保持 OSS 现状。
- C9：**保持 OSS 规则**——默认 pro，通用模式下 AI 路由仍可达；只合入"切到研发自动开 aiCoding/localEnv、通用模式隐藏工作区切换器/分支选择"这类体验项。
- C3：错误提醒两者共存（保留 OSS 日志红点 + 增加 VB 的 6s 错误 alert / 未读标记）。
- C1：去掉 StatusBar 改头像光环 + 日志按钮移至侧栏；但**通用模式（无侧栏）必须仍有日志入口**（如头像菜单项或 TopBar 按钮），OSS StatusBar 的通知合并角标能力迁到新入口；天气开关进头像菜单。
- C2：4 配色主题 + content-island；修循环依赖；保留 OSS"光标跟随文字色"；所有 `theme === 'dark'` 判断改为识别 `dark-*`。
- C4：AI 终端助手新增"CLI Agent 模式"，与 OSS 现有模型对话模式**并存**（可切换），不删除 OSS 实现。
- C5：本地模式默认开启；更新器不再退出时静默安装（需确保有手动安装入口）。
- C6：新建会话对话框只列已安装工具 + "去安装"引导。
- C7：头像菜单显示本机 IP；设置页项目组选择卡片。
- C8：工作区 VCS 检测 SVN 优先。
- B1 内置应用：只带机制；`clean-project` / `update-project` 若无公司耦合可作为示例内置应用，否则不带。`vb_common.py` 公共部分并入 SDK。

## 分工

### Phase 0 — 基础模块（独立新文件为主）
`main/utils/{windows-env,process-tree,ipc-validation(修正版)}.ts`、`main/services/{python-detect,python-venv,terminal-detect,ide-detect}.service.ts`、renderer `utils/{unified-diff,terminal-theme,app-identity,coding-tools-cache}.ts`，及对应 VB 测试。`paths.ts` 新增函数（`getDefaultUserAppsPath`/`getBuiltinAppsPath`/venv 路径、`getUserAppsPath` 读 `settings.userAppDir`、非 Electron 兜底）、`logger.ts` 无窗口兜底、`tsconfig.web.json` vitest globals。只提供模块，不接入业务（接入由 Phase 1 做）。

### V1 — 后端 + 管理面板（与 Phase 0 并行）
A1 后端（市场应用 executions 支持 cancelled）、A30 列补齐迁移、A31 上传白名单 + 限流、A32 OAuth 回调页、A33 admin 401 + users 守卫、B2 common-app 归档上传/下载（保留 OSS create/delete）、B3 应用 ID 用 manifest.id（`APPLICATION_CATEGORIES` 常量仅做可选校验，不改写存量数据；迁移脚本前缀中性化）、B7 projectNav 后端 + `ProjectNavDrawer` + ProjectManagementPage 入口、B22 flush-builtin 脚本 + `utils/zip.ts`、Dashboard common-app 统计作为**附加**字段、admin 登录页 logo、feedback 配置占位提示（中性化）、`db-cleanup` 取并集、`.gitignore` 合并、测试（commonApp/project/projectNav/zip/commonAppArchive/migrateApplicationIds，改为不依赖公司 seed）。

### V2 — 工作台 / 子应用运行时 / Python
A1 前端+SDK（cancelled, `emit_cancelled`, `recordTaskUsageOnce`）、A2 定时防重入、A3 下载加固、A4 SubAppDialog 组件、A5 表单抽屉修复、A6 小修、A7 workspace 去重 + userAppDir、A8 作者判定、A14 快捷键、B1 内置应用机制、B3 前端（AppEditor 分类 + ID 生成 + AppPublisher，依赖 `pinyin-pro`）、B4 Python 解析链 + venv + requirements + `PythonEnvCheck`、B5 earlyTerminal + `disabled`、B6 收藏栏/我的/发现页功能点（逐项挑，保留 OSS 多类型）、B7 前端 `NavBookmarkBar` + `useProjectNavStore` + apiClient nav 方法、B2 前端（apiClient upload/download、AppPublisher 管理员覆盖发布、`hasArchive`）、FolderCard / AppIcon 卡片 UI、`useTaskStore` 中 startTask 幂等/disabled/cancelled 部分、`settings:get-available-pythons`、`settings:get-registered-shortcuts`、common-apps 缓存预热、ProjectSwitcher 体验。

### V3 — AI Coding / VCS / 提醒托盘
A9 性能（不含 `CodingTerminalView`）、A10 分屏、A11 关标签停进程 + 退出关 SDK/Codex 会话、A12 原生会话缓存 + 扫描减负、A13 关联修复（GENERIC_TOOL_TITLES 含 OSS 全部工具；保留 87f90b9，仅补 transcript/Codex 合成消息过滤）、B8 agy + omp（cli-detect、native-sessions provider、aiToolMeta、ProviderIcons、IM `/new`、types；**local-env 安装项由 V4 做**）、B9 cli-detect Windows 增强、B10 侧栏置顶/拖拽/归档/首字母头像、B11 VCS（Perforce、多 VCS、diff 查看器、平铺/树形）、B12 落地页、B14 提醒 + 托盘（保留 ai-chat 来源；系统通知加开关；主进程文案 i18n）、B19 ipc-validation 接入 ai-coding.ipc、C6、WorkspaceSwitcher 重复路径提示、`DetectedCLI.enabled`。

### V4 — 终端 / Local Env / Setup / 系统
A15 PTY 分块缓冲、A16 本地终端 shell、A17 高度统一、A18 Windows PATH/Python（local-env 部分）、A19 winget、A20 LocalEnv 交互、B8 local-env 的 agy/omp 安装项（只加不删，DEFAULT_ENABLED 维持 OSS）、B13 xterm 6 + `useXterm` + `TerminalSearchBar` + Nerd Font + preload PTY 分发（**含 `CodingTerminalView` 与 AI Terminal `TerminalPanel`**）、B15 设置页 Python/IDE/终端扫描下拉（保留校验按钮）+ 对应 IPC、B16 镜像源、B17 协议路由（无 cmd）、B18 Setup 向导模式/项目步骤（保留角色+模块自定义）、C4 终端助手 CLI Agent 模式（并存）+ `terminal-exec-mcp` + `terminal-assistant.service` + ai-coding.service 的 `ensureGroupByName`/`execTarget`、C5、C7 IP（system.ipc）、进程树清理 + `killAllPtySessions` 退出调用、`migrate-settings` 自动探测终端/IDE、auth IPC（`cancel-login`/`get-auth-url`/`open-modal-login`）主进程部分。

### V5 — 外壳 / UI / 主题 / 动效 / 登录
A21–A29（登录跳转、飞书登录加固 renderer 部分 + LoginPage 等待态、apiClient 超时、repoUrl null、设置页关闭、拖拽区、更新入口、module-visibility、role/useIsAdmin）、B20 动效层（`cb-motion`）、B21 天气 store（保留自动天气）、C1、C2、C3（useTaskStore 的 errorAlert 部分）、C7 设置页项目卡片 + TopBar IP 显示（IPC 由 V4 提供，接口名 `system.getLocalIp`）、C9（按决策）、侧栏图标与左上角角标（token 化颜色）。

## 归属调整与协作约定（Phase 1 开始前定稿）

- **C5（更新器 + 本地模式默认）、A22 全部（auth.service + auth.ipc + preload + LoginPage）、C7 全部（system.service/ipc + preload `system.getLocalIp` + TopBar + 设置页项目卡片）→ V5**（不再归 V4）。
- **im/marketplace 中 `resolvePythonCommand(app.path)`、internal-tools 的 Python 解析 → V2。**
- **pty-manager.service.ts**：V4 负责分块缓冲 / shell 解析 / 进程树 / killAll；V3 只追加提醒用的"输出稳定检测"（`touchPtyActivity` 及其回调），改动保持局部。
- **ai-coding.service.ts**：V3 负责 order/pinned/closeAll 等；V4 只追加 C4 需要的 `ensureGroupByName` / `ensureWorkspaceForWorkingDirInGroup` / `execTarget`。
- **CodingTerminalView.tsx 和 preload `onPtyData`：仅 V4。** V3 不改。
- **useTaskStore.ts**：V2 改 startTask / disabled / cancelled；V5 只追加 errorAlert 段。
- **SettingsPage.tsx**：V4 只改 Python/IDE/终端路径区（B15）；V5 改其余。
- 共享文件（`preload/api.ts`、`renderer/src/types/ipc.ts`、`i18n/index.ts`、`main/index.ts`、`main/ipc/index.ts`、`package.json`、`settings.store.ts`）：**只做局部追加**，不重排、不格式化无关代码；i18n 新 key 按功能成块追加到 zh-CN 和 en 各自末尾附近，便于合并。
- Phase 0 已提供的模块（直接 import，勿重复实现）：`main/utils/{windows-env,process-tree,ipc-validation,paths}`、`main/services/{python-detect,python-venv,terminal-detect,ide-detect}.service`、renderer `utils/{unified-diff,terminal-theme,app-identity,coding-tools-cache}`。`ipc-validation` 的 `validateToolType` 用 `satisfies Record<AIToolType,true>`，扩展 `AIToolType`（V3 加 agy/omp）时须同步。
