# AI Workbench

AI Workbench (`/ai-workbench`) 是 ClawBench 的 AI 编程会话管理模块，提供：

- **工作区（Workspace）管理**：目录 + AI 工具类型的组合，按 Tab 分组展示
- **会话（Session）管理**：每个工作区可有多个会话，以文件夹式 Tab 显示在卡片底部
- **托管进程（Managed Session）**：Claude Code 以子进程 + pipe 方式运行，无需终端窗口
- **飞书 IM 远程控制**：WebSocket 长连接，指令控制 + 纯文本转发到会话 stdin

---

## 数据模型

### AIWorkbenchWorkspace

```typescript
{
  id: string           // UUID
  toolType: 'claude' | 'codex' | 'gemini'
  title: string        // basename(workingDir)，自动生成
  workingDir: string   // 绝对路径
  groupId: string      // 所属 Tab 分组
  createdAt: number
  updatedAt: number
}
```

### AIWorkbenchSession

```typescript
{
  id: string
  workspaceId: string        // FK → Workspace
  toolSessionId?: string     // AI 工具的原生 session ID（用于 --resume）
  status: 'closed' | 'idle' | 'running' | 'completed' | 'error'
  lastActivity: 'none' | 'thinking' | 'writing' | 'reading' | 'tool_call' | 'waiting_input' | 'auth_request'
  createdAt: number
  updatedAt: number
  pidFile?: string    // Terminal 会话专用
  windowId?: number   // Terminal.app 窗口 ID
}
```

### AIWorkbenchGroup

```typescript
{
  id: string
  name: string
  isDefault: boolean   // 默认分组不可删除/重命名
  order: number
}
```

---

## 架构分层

```
飞书客户端
    │ WebSocket (WSClient)
    ▼
FeishuAdapter          ← 接收消息 / 发送卡片 / 更新卡片 / 表情回复
    │
IMBridgeService        ← 单例编排器：解析指令、路由、维护 per-chat 状态、15s 刷新
    │
ai-workbench.service   ← 业务逻辑：Workspace/Session CRUD、进程管理、输出缓冲
    │
ai-workbench.store     ← electron-store 持久化（workspaces / sessions / groups / imConfig）
```

### Electron 三层

```
Renderer (React)
  useAIWorkbenchStore (Zustand)
    window.api.aiWorkbench.*
      ai-workbench.ipc.ts      ← 薄包装层
        ai-workbench.service.ts
```

---

## 会话类型：Managed vs Terminal

### Managed Session（claude）

Claude Code 支持 `--input-format stream-json --output-format stream-json`，以 JSON Lines 协议通信，**无需终端窗口**。

**启动命令：**
```
claude -p --input-format stream-json --output-format stream-json --verbose [--resume <session_id>]
```

**启动流程：**
```
launchSession(id)
  → launchManagedSession(id, workspace, resumeId?)
    → spawn('claude', args, { cwd: workingDir, stdio: ['pipe','pipe','pipe'] })
    → readline on stdout → handleManagedEvent()
    → updateSession(id, { status: 'idle' })
```

**stdin 发送消息：**
```typescript
// writeToSession(sessionId, text)
const msg = {
  type: 'user',
  message: { role: 'user', content: text },
  session_id: session.toolSessionId   // 可选，用于会话续接
}
proc.stdin.write(JSON.stringify(msg) + '\n')
```

**stdout 事件处理：**

| 事件 `type` | 处理逻辑 |
|---|---|
| `system` (subtype: `init`) | 保存 `session_id` → `session.toolSessionId`（供下次 `--resume`） |
| `assistant` | 追加文本到输出缓冲；`status → running`，`lastActivity → thinking` |
| `result` | 更新 `toolSessionId`；`status → idle` |
| `error` | `status → idle` |
| 进程退出 | `status → completed` |

**输出缓冲：** 最近 4000 字符，通过 `getSessionOutput(sessionId)` 读取，用于飞书会话详情卡片展示。

**Resume：** 每次 `launchSession` 若 `session.toolSessionId` 非空，自动附加 `--resume <id>`，延续上一次对话上下文。

### Terminal Session（codex / gemini）

其他工具不支持 stream-json，在 Terminal.app（或 iTerm2）中以交互式终端运行。

**启动：** AppleScript `do script` 在 Terminal.app 新窗口运行 expect 包装脚本。

**Expect 包装脚本作用：**
1. `spawn -noecho <command>` 分配 pty，保持工具的交互式 TUI
2. 写 PID 到 pidFile（供进程存活检测）
3. 每秒轮询 inputFile：有内容则 `send "$data\r"` 注入 pty（正确的回车字符）

**进程存活检测：** 每 3 秒读取 pidFile，`kill(pid, 0)` 检测；进程退出时 `status → completed`。

**活动状态检测：** 读取 Terminal.app 窗口内容（AppleScript），用正则推断 `lastActivity`（thinking / tool_call / writing / reading / waiting_input / auth_request）。

---

## IM 集成（飞书）

### 连接方式

使用 `@larksuiteoapi/node-sdk` 的 **WSClient**，建立 WebSocket 长连接。
**不需要公网 HTTPS 回调地址**，适合桌面应用在 NAT 后运行。

**自动连接：** 应用启动时，若设置中 AI Workbench 模块已启用且飞书 AppID / AppSecret 已配置，自动发起连接（非阻塞异步）。

### Per-Chat 状态

IMBridgeService 为每个 `chatId` 维护独立状态，多用户互不干扰：

```typescript
interface IMChatState {
  chatId: string
  activeWorkspaceId: string | null
  activeSessionId: string | null
}
```

### 指令系统

| 指令 | 简写 | 说明 |
|---|---|---|
| `/help` | `/h` | 帮助卡片 + 工作区概览 |
| `/work` | `/w` | 工作区列表卡片 |
| `/work <n>` | `/w <n>` | 切换到第 n 个工作区；自动创建并启动会话 |
| `/session` | `/ss` | 当前工作区的会话列表卡片 |
| `/session <n>` | `/ss <n>` | 切换到第 n 个会话，显示详情卡片 |
| `/exit` | — | 停止当前活跃会话（保留 toolSessionId 供 resume） |
| `/status` | `/st` | 全局状态汇总卡片 |
| 任意文本 | — | 有活跃会话时转发到 stdin；否则提示先选择工作区 |

### 纯文本转发流程

```
用户在飞书发送文本
  → IMBridgeService.handleIncomingMessage()
    → parseCommand() → command: 'unknown'
    → chatState.activeSessionId 存在？
      ├─ 是 → handleStdinForward(chatId, text, messageId)
      │         → writeToSession(sessionId, text)
      │           ├─ Managed(claude): stdin.write(JSON line) → Claude Code 接收
      │           └─ Terminal(其他): 写 inputFile → expect 注入 pty
      │         → 成功: addReaction(messageId, 'DONE')  ← 表情回复，不发新消息
      │         → 失败: sendText(chatId, '发送失败: ...')
      └─ 否 → buildNoContextCard() 提示先选择工作区
```

### 切换工作区自动启动

`/w <n>` 的完整逻辑：

1. 按序号找到工作区，设置 `chatState.activeWorkspaceId`
2. 查找该工作区下的会话列表
3. 若无会话 → 自动 `createSession(workspaceId)`
4. 优先选已运行（idle/running）的会话，否则选最后一个（最近创建）
5. 若选中会话未运行（closed/completed）→ 自动 `launchSession()`
6. 回复工作区详情卡片 + 文字确认，并提示可直接发文本

### 卡片自动刷新

IMBridgeService 启动 **15 秒间隔定时器**，遍历所有 cardMappings：
- 只刷新 `status === 'running'` 的会话对应的卡片
- 对比 `getSessionOutput()` 与上次快照，有变化才调用飞书 patch 接口更新

---

## IPC 通道

### 请求-响应（invoke/handle）

| 通道 | 参数 | 说明 |
|---|---|---|
| `ai-workbench:get-workspaces` | — | 获取所有工作区 |
| `ai-workbench:create-workspace` | toolType, workingDir, groupId | 创建工作区 |
| `ai-workbench:update-workspace` | id, updates | 更新工作区字段 |
| `ai-workbench:delete-workspace` | id | 删除工作区（级联停止并删除所有会话） |
| `ai-workbench:get-workspace-sessions` | workspaceId | 获取工作区下的会话列表 |
| `ai-workbench:get-sessions` | — | 获取所有会话 |
| `ai-workbench:create-session` | workspaceId | 创建会话（status: closed） |
| `ai-workbench:update-session` | id, updates | 更新会话字段 |
| `ai-workbench:delete-session` | id | 删除会话（终止进程） |
| `ai-workbench:stop-session` | id | 停止会话（→ closed，保留 toolSessionId） |
| `ai-workbench:launch-session` | id | 启动/恢复会话 |
| `ai-workbench:write-to-session` | sessionId, text | 向会话 stdin 写入文本 |
| `ai-workbench:get-groups` | — | 获取分组列表 |
| `ai-workbench:create-group` | name | 创建分组 |
| `ai-workbench:rename-group` | id, name | 重命名分组（默认分组不可操作） |
| `ai-workbench:delete-group` | id | 删除分组（工作区迁移到默认分组） |
| `ai-workbench:get-im-config` | — | 获取 IM 配置 |
| `ai-workbench:save-im-config` | config | 保存 IM 配置 |
| `ai-workbench:open-directory` | dirPath | 在系统文件管理器中打开目录 |
| `ai-workbench:im-connect` | — | 连接 IM（当前仅飞书） |
| `ai-workbench:im-disconnect` | — | 断开 IM |
| `ai-workbench:im-get-status` | — | 获取 IM 连接状态 |
| `ai-workbench:im-test` | — | 测试 IM 连接（临时连接后断开） |

### Push 事件（主进程 → 渲染进程）

| 事件 | 数据 | 触发时机 |
|---|---|---|
| `ai-workbench:data-changed` | — | 任何 session/workspace 状态变化 |
| `ai-workbench:im-status-changed` | `{ state, error?, connectedAt? }` | IM 连接状态变化 |

---

## 数据持久化与迁移

所有数据持久化在 electron-store（`ai-workbench` key）：

```
{
  workspaces: AIWorkbenchWorkspace[]
  sessions: AIWorkbenchSession[]
  groups: AIWorkbenchGroup[]
  imConfig: { feishu: { appId, appSecret } }
}
```

**V1 → V2 迁移：** 首次启动时 `migrateV1ToV2()` 检测旧版 session 格式（session 中直接含 `toolType`/`workingDir`/`groupId`），自动拆分为 Workspace + Session 两层结构，保留所有 ID。

**启动重置：** `resetActiveSessionsOnStart()` 在 IPC 注册时执行：
- Managed 会话（claude）：管道已断开，无法续接 → 重置为 `closed`（`toolSessionId` 保留，下次启动可 resume）
- Terminal 会话：尝试通过 pidFile 检测进程是否仍在运行，存活则恢复追踪，否则 → `completed`

---

## 飞书应用配置指南

在飞书开放平台创建自建应用：

**1. 权限配置**

在「权限管理」中开通：
- `im:message` — 获取与发送单聊、群组消息
- `im:message.group_at_msg` — 接收群消息（如需群聊）
- `im:message.reaction:write` — 添加表情回复

**2. 事件订阅**

在「事件与回调」→「事件配置」中：
- 选择「使用长连接接收事件」（无需配置回调 URL）
- 添加事件：`im.message.receive_v1`（接收消息）
- 添加事件：`card.action.trigger`（接收卡片按钮点击）

**3. 获取凭证**

在「凭证与基础信息」中复制 **App ID** 和 **App Secret**，填入：
ClawBench 设置 → AI 工作台 → IM 配置 → 飞书

**4. 发布应用**

自建应用需在「版本管理与发布」中创建版本并提交审核（或在测试环境直接使用）。
