# AI Agents / OpenClaw 管理

AI Agents 是 ClawBench 的 AI 代理管理模块（侧边栏入口 `/ai-agents`，模块键 `aiAgents`，默认开启）。当前包含 OpenClaw 卡片，展示版本、运行状态、默认模型和通讯方式；点击"详情配置"进入 OpenClaw 详情页（`/ai-agents/openclaw`）。

OpenClaw 是外部开源 CLI 工具/服务。详情页在 ClawBench 内管理其安装、配置和服务生命周期。

## 功能概览

- 安装检测（`openclaw --version`）与一键安装/卸载
- 服务生命周期管理：启动（`openclaw gateway`）、停止、重启、状态检测
- 四类配置管理：AI 服务商、通信工具、技能、内置功能
- 卡片式配置界面，每项含开关、描述、动态表单，支持折叠展开
- 保存（持久化到 electron-store + 生成原生配置文件）与应用（保存 + 重启服务）
- API Key 掩码显示，保存时保留未修改值
- **可视化龙虾场景**：动态 SVG 动画展示 Agent 状态和活动
- **社区技能浏览**：接入 clawhub-skills.com，展示热门技能列表
- **定时任务管理**：查看并启停 OpenClaw cron 任务
- **日志监听**：实时解析 OpenClaw 日志，推导 Agent 活动状态
- **模型优先级**：双区拖拽配置，设置 OpenClaw 默认模型顺序
- **Google OAuth**：一键授权绑定 Google 账号

## 架构

```
Renderer (AIAgentsPage → OpenClawPage)
  → useOpenClawStore (Zustand)
    → window.api.openclaw.* (IPC)
      → openclaw.ipc.ts (薄封装)
        → openclaw.service.ts (业务逻辑)
          → openclaw.store.ts (electron-store 持久化)
          → openclaw-log-watcher.service.ts (日志监听 → 活动状态推导)
          → ~/.openclaw/openclaw.json (原生配置文件)
          → ~/.openclaw/.env (环境变量)
```

## 页面组件

### AI Agents 落地页（`/ai-agents`）

| 组件 | 文件 | 职责 |
|------|------|------|
| AIAgentsPage | `pages/AIAgents/AIAgentsPage.tsx` | 落地页：检查安装状态、订阅活动推送，渲染 OpenClawCard |
| OpenClawCard | `pages/AIAgents/OpenClawCard.tsx` | 卡片容器：未安装时显示安装入口；已安装时显示多节点布局 + 服务控制按钮 |
| MainNodeCard | `pages/AIAgents/MainNodeCard.tsx` | 主节点卡片：AgentLobsterScene + NodeInfoPanel 左右布局 |
| SubNodeCard | `pages/AIAgents/SubNodeCard.tsx` | 子节点卡片（远程节点），含 AgentLobsterScene 缩略展示 |
| AgentLobsterScene | `pages/AIAgents/AgentLobsterScene.tsx` | 动态龙虾场景：按容器尺寸自适应布局，支持主 Agent 全宽或主/子分栏 |
| LobsterSVG | `pages/AIAgents/LobsterSVG.tsx` | 动态龙虾 SVG，按 `state` prop 驱动 CSS 动画 |
| NodeInfoPanel | `pages/AIAgents/NodeInfoPanel.tsx` | 节点信息面板：状态徽章、版本、默认模型（脑图标）、通信工具 |

#### 龙虾动画状态（`LobsterAnimationState`）

| 状态 | 触发场景 | 动画效果 |
|------|----------|----------|
| `idle` | 服务空闲 | 轻微漂浮，点击触发 scratching |
| `thinking` | AI 思考中 | 身体摇摆 + 思考气泡（三点）|
| `scratching` | 点击空闲龙虾 | 单侧爪子挠头，用于交互反馈 |
| `web_search` | 网络搜索 | 放大镜配件 + 爪子动作 |
| `doc_processing` | 文档处理 | 文档配件 + 爪子动作 |
| `sending_message` | 发送消息 | 对话气泡配件 |
| `tool_call` | 工具调用 | 齿轮配件旋转 |
| `agent_conversation` | Agent 互相对话 | 双气泡配件 |

- 点击**空闲**状态的主 Agent 或子 Agent，触发 `scratching` 动画（1800ms 后自动恢复）
- 子 Agent 各自独立追踪 scratching 状态

### OpenClaw 详情页（`/ai-agents/openclaw`）

| 组件 | 文件 | 职责 |
|------|------|------|
| OpenClawPage | `pages/OpenClaw/OpenClawPage.tsx` | 详情页：Tab 页、状态栏、底部操作栏、返回按钮 |
| StatusBar | `pages/OpenClaw/StatusBar.tsx` | 服务状态指示、版本号、启动/停止/卸载按钮 |
| OpenClawItemCard | `pages/OpenClaw/OpenClawItemCard.tsx` | 配置卡片：开关、描述、动态表单字段，支持折叠 |
| BottomBar | `pages/OpenClaw/BottomBar.tsx` | 保存/应用按钮（dirty 时启用）|
| NotInstalledView | `pages/OpenClaw/NotInstalledView.tsx` | 未安装提示 + 一键安装按钮 |
| CommunitySkillCard | `pages/OpenClaw/CommunitySkillCard.tsx` | 社区技能卡片：标题、Meta、描述、详情链接、脚标统计 |
| ModelPriorityPanel | `pages/OpenClaw/ModelPriorityPanel.tsx` | 模型优先级双区拖拽面板 |
| CronJobManager | `pages/OpenClaw/CronJobManager.tsx` | 定时任务列表：查看调度、启停开关 |

## 社区技能（clawhub-skills）

技能 Tab 下方展示来自 [clawhub-skills.com](https://clawhub-skills.com/skills/) 的热门社区技能。

**数据源：** `https://clawhub-skills.com/api/skills?sort=installsAllTime&page=1&pageSize=12`

**响应结构：**

```json
{ "skills": [{ "slug": "...", "displayName": "...", "summary": "...", "author": "...", "version": "...", "category": "...", "tags": [...], "downloads": 0, "installsAllTime": 0, "stars": 0 }] }
```

**字段映射（`CommunitySkill` 类型）：**

| API 字段 | 类型字段 | 说明 |
|----------|----------|------|
| `slug` | `id` | 唯一标识，也用于详情 URL |
| `displayName` | `name` | 显示名称 |
| `summary` | `description` | 描述 |
| `installsAllTime` | `installsAllTime` | 历史总安装次数 |
| `downloads` | `downloads` | 下载量 |
| `stars` | `stars` | 标星数 |
| `author` | `author` | 作者 |
| `version` | `version` | 版本 |
| `category` / `parentCategory` | `category` | 分类 |
| `tags` | `tags` | 标签（过滤 `latest`） |

**卡片布局：** 标题 → Meta 行（分类 Tag、标签、版本、作者）→ 描述（2 行截断）→ 详情链接 → 脚标（总安装数 / 下载量 / 标星量）

**安装方式（命令行）：**

```bash
npx clawhub@latest install <slug>
```

## 配置结构

### AI 服务商 (ai_provider)

| 项目 | 配置字段 |
|------|----------|
| OpenAI | apiKey |
| Anthropic (Claude) | apiKey |
| Google Gemini | apiKey（或 Google OAuth 授权） |
| DeepSeek | baseUrl, apiKey, api (协议), models |
| Custom (LM Studio/Ollama) | baseUrl, apiKey (可选), api, models |

### 通信工具 (comm_tool)

| 项目 | 配置字段 |
|------|----------|
| Telegram | botToken |
| Discord | token |
| Slack | botToken (xoxb-), appToken (xapp-) |
| WhatsApp | phoneNumber |
| 飞书 | appId, appSecret |

### 技能 (skill)

| 项目 | 配置字段 |
|------|----------|
| ClawHub 技能市场 | 无 |
| 代码编辑 | 无 |
| 提权执行 | 无 |

### 内置功能 (builtin_feature)

| 项目 | 配置字段 |
|------|----------|
| 网页搜索 | Brave Search API Key |
| 网页内容抓取 | 无 |
| 文字转语音 | provider (ElevenLabs/OpenAI/Edge), apiKey |
| 浏览器自动化 | 无 |
| 定时任务 | 无 |

## 配置文件生成

`saveConfig()` / `applyConfig()` 调用 `generateOpenClawJsonConfig()` 将内部数据映射为 OpenClaw 原生格式：

| 内部分类 | 映射目标 | 示例 |
|----------|----------|------|
| ai_provider (内置) | `~/.openclaw/.env` | `OPENAI_API_KEY=sk-...` |
| ai_provider (自定义) | `models.providers.<id>` | `{ baseUrl, apiKey, api, models }` |
| comm_tool | `channels.<id>` | `{ enabled: true, botToken: "..." }` |
| skill (coding) | `tools.profile` | `"coding"` |
| skill (elevated) | `tools.elevated` | `{ enabled: true }` |
| builtin (web_search) | `tools.web.search` | `{ enabled: true, apiKey: "..." }` |
| builtin (tts) | `messages.tts` | `{ auto: "inbound", provider, ... }` |
| builtin (browser) | `browser` | `{ enabled: true }` |
| builtin (cron) | `cron` | `{ enabled: true }` |

生成的文件权限为 0o600（仅所有者可读写）。

## 服务生命周期

| 操作 | 命令 | 超时 |
|------|------|------|
| 检测安装 | `openclaw --version` | 10s |
| 安装 | `npm install -g openclaw@latest` | 10min |
| 卸载 | `npm uninstall -g openclaw` | 2min |
| 状态检测 | `pgrep -f openclaw` (Unix) / `tasklist` (Win) | 5s |
| 启动 | `openclaw gateway` (detached) | — |
| 停止 | `pkill -f openclaw` (Unix) / `taskkill` (Win) | 10s |

应用配置流程：保存配置 → 停止服务 → 等待 1s → 启动服务

## 日志监听与活动状态

`openclaw-log-watcher.service.ts` 持续 tail OpenClaw 日志文件，通过正则匹配日志行推导当前 Agent 活动状态（`LobsterAnimationState`），并通过 IPC push 事件实时推送到渲染进程。

**Push 事件：**

| 事件 | 数据 | 说明 |
|------|------|------|
| `openclaw:activity-state` | `LobsterAnimationState` | 主 Agent 当前活动状态 |
| `openclaw:active-subagents` | `OpenClawAgent[]` | 当前活跃的子 Agent 列表 |

**订阅（`useOpenClawStore`）：**

```typescript
subscribeActivityState()  // 启动日志监听，返回取消订阅函数
```

当服务状态为 `running` 时，AIAgentsPage 自动调用 `subscribeActivityState()`。

## IPC 通道

| 通道 | 用途 |
|------|------|
| `openclaw:check-installed` | 检查安装状态，返回版本和路径 |
| `openclaw:install` | 全局安装 |
| `openclaw:uninstall` | 卸载，可选删除配置目录 |
| `openclaw:get-status` | 检查服务运行状态 |
| `openclaw:start` | 启动网关服务 |
| `openclaw:stop` | 停止服务 |
| `openclaw:get-config` | 获取配置（API Key 掩码） |
| `openclaw:save-config` | 保存配置（处理掩码值保留） |
| `openclaw:apply-config` | 保存配置 + 重启服务 |
| `openclaw:list-community-skills` | 从 clawhub-skills.com 获取社区技能列表 |
| `openclaw:install-skill` | 用 `npx clawhub@latest install <slug>` 安装社区技能 |
| `openclaw:get-cron-jobs` | 获取 OpenClaw cron 任务列表 |
| `openclaw:toggle-cron-job` | 启用/禁用指定 cron 任务 |
| `openclaw:check-latest-version` | 检查 openclaw 最新版本 |
| `openclaw:pairing-approve` | 审批节点配对请求 |
| `openclaw:get-gateway-url` | 获取本地网关 URL |
| `openclaw:start-google-oauth` | 发起 Google OAuth 授权流程 |
| `openclaw:start-log-watcher` | 启动日志监听（返回取消函数） |
| `openclaw:stop-log-watcher` | 停止日志监听 |

## 数据持久化

**electron-store** (`openclaw.store.ts`)：
- 存储键：`installPath` (安装路径) + `items` (配置项数组) + `modelPriority` (模型优先级列表)
- 首次加载自动填充默认配置项
- 敏感数据（API Key）以明文存储于 electron-store，传输时掩码处理

## 关键文件

| 文件 | 用途 |
|------|------|
| `frontend/src/main/services/openclaw.service.ts` | 安装/启停/配置生成/社区技能获取逻辑 |
| `frontend/src/main/services/openclaw-log-watcher.service.ts` | 日志 tail + 活动状态推导 |
| `frontend/src/main/ipc/openclaw.ipc.ts` | IPC 处理器 |
| `frontend/src/main/store/openclaw.store.ts` | electron-store 持久化 |
| `frontend/src/renderer/src/stores/useOpenClawStore.ts` | Zustand 状态管理 |
| `frontend/src/renderer/src/types/openclaw.ts` | 类型定义（`LobsterAnimationState`, `OpenClawNode`, `OpenClawAgent`, `CommunitySkill` 等）|
| `frontend/src/renderer/src/pages/AIAgents/LobsterSVG.tsx` | 龙虾 SVG 动画组件 |
| `frontend/src/renderer/src/pages/AIAgents/LobsterSVG.css` | 龙虾 CSS 动画定义 |
| `frontend/src/renderer/src/pages/AIAgents/AgentLobsterScene.tsx` | 多 Agent 场景布局 |
