# AI Terminal

AI Terminal (`/ai-terminal`) 是 ClawBench 的终端 + 数据库双模式管理模块，提供：

- **终端模式**：本地终端 + SSH 远程连接，多 Tab 管理，`~/.ssh/config` 自动同步
- **DB 模式**：多数据库连接管理（MySQL / PostgreSQL / MongoDB / SQLite），可视化数据浏览与编辑
- **快捷命令**：保存常用命令组合，一键批量执行
- **AI 助手**：内嵌于面板底部，终端模式下充当运维专家，DB 模式下充当 DBA 专家，均支持 Tool Calling 自动操作

---

## 数据模型

### TerminalConnection

```typescript
{
  id: string
  name: string
  type: 'local' | 'ssh'
  // SSH 字段
  host?: string
  port?: number                  // 默认 22
  username?: string
  authMethod?: 'password' | 'key' | 'agent'
  privateKeyPath?: string
  password?: string
  // 通用
  startupCommand?: string
  fromSSHConfig?: boolean        // 来源于 ~/.ssh/config 自动同步
  createdAt: number
  updatedAt: number
}
```

### DBConnection

```typescript
{
  id: string
  name: string
  type: 'mysql' | 'postgres' | 'mongodb' | 'sqlite'
  host?: string
  port?: number
  username?: string
  password?: string
  database?: string
  filePath?: string              // 仅 SQLite
  createdAt: number
  updatedAt: number
}
```

### QuickCommand

```typescript
{
  id: string
  name: string
  commands: string               // 多条命令以 \n 分隔
  targets: string[]              // 空数组 = 所有目标；否则为指定连接 ID
  createdAt: number
  updatedAt: number
}
```

---

## 架构

```
Renderer (React)
  useAITerminalStore (Zustand)
    window.api.aiTerminal.*
      ai-terminal.ipc.ts           ← 薄包装层（40+ handle 注册）
        ai-terminal.service.ts     ← 业务逻辑（终端 + DB 双模式）
          pty-manager.service.ts   ← node-pty 进程管理
          ai-terminal.store.ts     ← electron-store 持久化
```

### 终端模式

```
openTerminal(connectionId, sessionId)
  → local: spawn($SHELL)
  → SSH: spawn('ssh', ['-o StrictHostKeyChecking=accept-new', ...args, user@host])
    → createPtySession()
      → node-pty 分配伪终端
        → TerminalPanel (xterm.js) 渲染
```

### DB 模式

```
connectDB(id)
  → mysql:    mysql2/promise.createPool()   (connectionLimit: 5)
  → postgres: pg.Pool()                     (max: 5)
  → mongodb:  MongoClient.connect()
  → sqlite:   better-sqlite3()
    → dbPools Map 管理活跃连接
```

---

## 页面组件

### 主页面

| 组件 | 文件 | 职责 |
|------|------|------|
| AITerminalPage | `pages/AITerminal/AITerminalPage.tsx` | 页面入口：可拖拽两栏布局（侧边栏 200–400px），模态管理 |
| AITerminalSidebar | `pages/AITerminal/AITerminalSidebar.tsx` | 左侧边栏：终端/DB 模式切换 Tab，连接列表，状态指示灯 |

### 终端组件

| 组件 | 文件 | 职责 |
|------|------|------|
| TerminalPanel | `pages/AITerminal/TerminalPanel.tsx` | xterm.js 终端渲染，键盘输入转发 PTY，选中文本传入 AI 上下文 |
| TerminalTabBar | `pages/AITerminal/TerminalTabBar.tsx` | 终端 Tab 栏，多 Tab 切换/关闭 |
| QuickBar | `pages/AITerminal/QuickBar.tsx` | 快捷命令栏，一键执行 |
| EditConnectionModal | `pages/AITerminal/EditConnectionModal.tsx` | SSH 连接表单（名称/主机/端口/认证方式/密钥路径/密码） |
| EditQuickCommandModal | `pages/AITerminal/EditQuickCommandModal.tsx` | 快捷命令编辑表单 |

### DB 组件

| 组件 | 文件 | 职责 |
|------|------|------|
| DBContentPanel | `pages/AITerminal/DBContentPanel.tsx` | DB Tab 切换，表浏览与 SQL 查询双视图 |
| DBTableBrowser | `pages/AITerminal/DBTableBrowser.tsx` | Handsontable 数据网格，支持行内编辑、主题适配 |
| DBQueryEditor | `pages/AITerminal/DBQueryEditor.tsx` | SQL 编辑器，Ctrl+Enter 执行，结果以只读网格展示 |
| DBConnectionList | `pages/AITerminal/DBConnectionList.tsx` | DB 连接卡片列表，连接状态指示 |
| EditDBConnectionModal | `pages/AITerminal/EditDBConnectionModal.tsx` | DB 连接表单（类型选择/主机/端口/凭据/数据库名） |

### AI 助手

| 组件 | 文件 | 职责 |
|------|------|------|
| AIAssistantPanel | `pages/AITerminal/AIAssistantPanel.tsx` | 底部可折叠聊天面板，双模式 Tool Calling，快速/深度思考切换 |

---

## 状态管理 (Zustand)

### useAITerminalStore

#### 终端状态

| 状态 | 说明 |
|------|------|
| `connections` | 终端连接列表（本地 + SSH） |
| `openTabs` | 已打开的终端 Tab |
| `activeTabId` | 当前激活的终端 Tab |
| `quickCommands` | 快捷命令列表 |
| `aiMessages` | 每个 Tab 独立的 AI 对话记录 `Record<tabId, TerminalAIMessage[]>` |
| `aiStreaming` | AI 是否正在流式输出 |
| `selectedText` | 终端中选中的文本（作为 AI 上下文） |

#### DB 状态

| 状态 | 说明 |
|------|------|
| `dbConnections` | 数据库连接配置列表 |
| `dbConnectionStatus` | 各连接的实时状态 `Record<connId, 'connected' \| 'disconnected' \| 'testing'>` |
| `openDBTabs` | 已打开的 DB Tab（表浏览 / SQL 查询） |
| `activeDBTabId` | 当前激活的 DB Tab |
| `dbTableData` | Tab 数据缓存 `Record<tabId, DBQueryResult>` |
| `dbTableSchemas` | 表结构缓存 `Record<'connId:tableName', DBTableColumn[]>` |
| `dbTables` | 各连接的表列表 `Record<connId, string[]>` |

关键操作：
- `openTerminal(connectionId, name)` — 创建 PTY 会话 + Tab
- `syncSSHConfig()` — 从 `~/.ssh/config` 同步 SSH 连接
- `connectDB(connId)` — 建立数据库连接，成功后自动加载表列表
- `queryDB(tabId, sql)` — 执行查询并缓存结果到 `dbTableData`

---

## SSH Config 同步

首次进入模块时自动调用 `syncSSHConfig()`：

1. 解析 `~/.ssh/config`，提取 `Host`、`HostName`、`Port`、`User`、`IdentityFile`
2. 跳过含通配符（`*`、`?`）的 Host 条目
3. 与已有连接合并：新增缺失的、更新已有的、删除已移除的
4. 同步来源的连接标记 `fromSSHConfig: true`

---

## AI 助手

### 终端模式工具

| 工具 | 说明 |
|------|------|
| `terminal_execute` | 在当前终端执行单条命令，等待输出稳定后返回结果（超时 15s） |
| `terminal_read_output` | 读取终端最近 3000 字符输出，用于了解当前上下文 |

**系统提示词**：角色为「顶级 Linux/系统运维专家」，强调危险操作警告、回滚方案、权限最小化、敏感数据保护。

终端输出和选中文本自动注入 AI 上下文。

### DB 模式工具

| 工具 | 说明 |
|------|------|
| `db_query` | 执行只读查询（SELECT/SHOW/DESCRIBE），结果限制前 50 行 |
| `db_execute` | 执行写操作（INSERT/UPDATE/DELETE/CREATE/ALTER/DROP），返回影响行数 |
| `db_get_tables` | 获取当前数据库的表/集合列表 |
| `db_get_schema` | 获取指定表的完整列结构（列名、类型、主键、可空、默认值） |

**系统提示词**：角色为「顶级数据库专家（DBA）」，强调 DROP/TRUNCATE 前警告、事务回滚、不猜测数据、大批量分批执行、敏感数据脱敏。

当前数据库类型、名称、可用表列表自动注入 AI 上下文。

### 通用特性

- **模型选择**：复用 AI Chat 模块的模型配置（`useAIModelStore`）
- **快速/深度思考**：切换 `chatMode`（`fast` / `thinking`），`thinking` 模式传递 `thinking: true` 给 AI 提供商
- **工具开关**：可禁用 Tool Calling，仅使用纯对话模式
- **流式响应**：复用 `ai.service.ts` 的 `streamChat` + delta/done/error 事件
- **每 Tab 独立对话**：AI 消息按 Tab ID 隔离

---

## IPC 通道

### 终端管理

| 通道 | 参数 | 说明 |
|------|------|------|
| `ai-terminal:get-connections` | — | 获取所有终端连接 |
| `ai-terminal:create-connection` | data | 创建终端连接 |
| `ai-terminal:update-connection` | id, updates | 更新终端连接 |
| `ai-terminal:delete-connection` | id | 删除终端连接 |
| `ai-terminal:sync-ssh-config` | — | 同步 `~/.ssh/config` |

### 终端会话

| 通道 | 参数 | 说明 |
|------|------|------|
| `ai-terminal:open-terminal` | connectionId, sessionId | 打开终端（创建 PTY） |
| `ai-terminal:close-terminal` | sessionId | 关闭终端（销毁 PTY） |
| `ai-terminal:write-terminal` | sessionId, data | 向终端写入数据 |
| `ai-terminal:resize-terminal` | sessionId, cols, rows | 调整终端尺寸 |
| `ai-terminal:get-terminal-output` | sessionId | 获取终端输出缓冲 |
| `ai-terminal:ai-execute-command` | sessionId, command | AI 执行命令并等待输出稳定 |

### 快捷命令

| 通道 | 参数 | 说明 |
|------|------|------|
| `ai-terminal:get-quick-commands` | — | 获取快捷命令列表 |
| `ai-terminal:save-quick-command` | data | 创建/更新快捷命令 |
| `ai-terminal:delete-quick-command` | id | 删除快捷命令 |
| `ai-terminal:execute-quick-command` | sessionId, commands | 执行快捷命令（多行逐条发送，间隔 300ms） |

### DB 连接管理

| 通道 | 参数 | 说明 |
|------|------|------|
| `ai-terminal:get-db-connections` | — | 获取所有 DB 连接 |
| `ai-terminal:create-db-connection` | data | 创建 DB 连接 |
| `ai-terminal:update-db-connection` | id, updates | 更新 DB 连接 |
| `ai-terminal:delete-db-connection` | id | 删除 DB 连接（自动断开） |
| `ai-terminal:test-db-connection` | config | 测试连接（临时连接后断开） |
| `ai-terminal:connect-db` | id | 建立数据库连接 |
| `ai-terminal:disconnect-db` | id | 断开数据库连接 |
| `ai-terminal:is-db-connected` | id | 检查连接是否活跃 |

### DB 查询与操作

| 通道 | 参数 | 说明 |
|------|------|------|
| `ai-terminal:get-db-tables` | id | 获取表/集合列表 |
| `ai-terminal:get-db-table-schema` | id, tableName | 获取表结构 |
| `ai-terminal:query-db` | id, sql | 执行只读查询 |
| `ai-terminal:execute-db` | id, sql | 执行写操作 |
| `ai-terminal:update-db-table-data` | id, tableName, changes | 按主键更新单元格数据 |

### MongoDB 专用

| 通道 | 参数 | 说明 |
|------|------|------|
| `ai-terminal:query-mongo-collection` | id, collection, filter, projection, limit | 查询集合文档 |
| `ai-terminal:update-mongo-document` | id, collection, filter, update | 更新文档（$set） |
| `ai-terminal:insert-mongo-document` | id, collection, doc | 插入文档 |
| `ai-terminal:delete-mongo-documents` | id, collection, filter | 删除文档 |

### 表结构修改（关系型）

| 通道 | 参数 | 说明 |
|------|------|------|
| `ai-terminal:add-db-column` | id, tableName, columnName, columnType, nullable, defaultValue | 添加列 |
| `ai-terminal:drop-db-column` | id, tableName, columnName | 删除列 |
| `ai-terminal:rename-db-column` | id, tableName, oldName, newName | 重命名列 |

### Push 事件（主进程 → 渲染进程）

| 事件 | 数据 | 触发时机 |
|------|------|------|
| `pty:data` | `{ sessionId, data }` | PTY 有新输出 |
| `pty:exit` | `{ sessionId, exitCode }` | PTY 进程退出 |
| `ai-terminal:exit` | `{ sessionId, exitCode }` | 终端会话退出（广播到所有窗口） |

---

## 数据持久化

所有配置持久化在 electron-store（文件 `ai-terminal.json`）：

```
{
  terminalConnections: TerminalConnection[]
  dbConnections: DBConnection[]
  quickCommands: QuickCommand[]
  sshConfigSynced: boolean
}
```

- 终端连接和 DB 连接分开存储
- 快捷命令支持多目标绑定
- `sshConfigSynced` 标记是否已完成首次 SSH 配置同步
- DB 连接池在内存中维护（`dbPools` Map），应用退出时自动释放

---

## 依赖

### 终端

| 包 | 用途 |
|------|------|
| `@xterm/xterm` | 终端模拟器 UI |
| `@xterm/addon-fit` | 终端自适应容器尺寸 |
| `node-pty` | 伪终端进程管理（通过 pty-manager.service 共享） |

### 数据库

| 包 | 用途 |
|------|------|
| `mysql2` | MySQL 连接（promise API，连接池） |
| `pg` | PostgreSQL 连接（连接池） |
| `mongodb` | MongoDB 驱动 |
| `better-sqlite3` | SQLite 同步驱动 |

### UI

| 包 | 用途 |
|------|------|
| `@handsontable/react` | 数据表格组件（表浏览 + 查询结果） |

---

## 关键文件

| 文件 | 用途 |
|------|------|
| `frontend/src/main/services/ai-terminal.service.ts` | 核心业务逻辑：SSH 解析、终端管理、DB 连接池、查询执行 |
| `frontend/src/main/ipc/ai-terminal.ipc.ts` | IPC 处理器（40+ 通道注册） |
| `frontend/src/main/store/ai-terminal.store.ts` | electron-store 持久化 |
| `frontend/src/renderer/src/stores/useAITerminalStore.ts` | Zustand 状态管理 |
| `frontend/src/renderer/src/types/ai-terminal.ts` | TypeScript 类型定义 |
| `frontend/src/renderer/src/pages/AITerminal/AITerminalPage.tsx` | 页面入口 |
| `frontend/src/renderer/src/pages/AITerminal/TerminalPanel.tsx` | xterm.js 终端渲染 |
| `frontend/src/renderer/src/pages/AITerminal/AIAssistantPanel.tsx` | AI 助手面板（双模式 Tool Calling） |
| `frontend/src/renderer/src/pages/AITerminal/DBTableBrowser.tsx` | Handsontable 数据浏览 |
| `frontend/src/renderer/src/pages/AITerminal/DBQueryEditor.tsx` | SQL 查询编辑器 |
