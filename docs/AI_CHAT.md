# AI 助手 (AI Chat)

ChatGPT 风格的多模型 AI 对话系统，支持服务端内置模型和本地配置模型，提供流式响应、会话管理、Markdown 渲染等完整功能。

## 功能概览

- 多模型支持：服务端内置模型 + 本地配置模型（OpenAI、Claude、Google Gemini、Azure OpenAI、通义千问、豆包、DeepSeek、Kimi，以及 **Anthropic 兼容格式**第三方端点）
- 流式响应：实时逐字输出，支持中断
- 会话管理：创建、重命名、收藏、删除；自动生成标题
- Markdown 渲染：GFM 语法、代码高亮（亮/暗主题自适应）
- 导出：Markdown 或 JSON 格式导出完整会话
- 持久化：后端数据库存储会话和消息（支持 SQLite / MySQL / PostgreSQL，通过 DB_TYPE 切换）
- **多模态消息**：图片/文件上传，base64 内嵌，多 Provider 适配
- **图片生成**：DALL-E / Stable Diffusion / 自定义端点，文生图 + 图生图，支持预览和保存到本地
- **Tool Calling**：MCP 集成 + 命令行执行 + 用户授权流程
- **侧边栏可折叠**：节省空间，专注对话区
- **偏好持久化**：模型、模式（Thinking/Normal）、工具开关、MCP 开关跨会话保留
- **欢迎界面**：无对话时显示 Logo 动画（LobsterSVG idle）+ 提示语 + 居中输入框；无 AI 模型时发送弹窗引导配置

## 架构

```
Renderer (React + Zustand)
  ├─ 内置模型路径: apiClient → POST /api/v1/ai/chat/stream (SSE)
  │                 ← EventSource 推送内容
  └─ 本地模型路径: window.api.ai.streamChat (IPC) → Main Process
                    ← ai:chat-delta / ai:chat-done / ai:chat-error 事件

Main Process (ai.service.ts)
  ├─ streamOpenAI()     → OpenAI / Qwen / Doubao / DeepSeek / Kimi / OpenAI 兼容
  ├─ streamAzureOpenAI() → Azure OpenAI
  ├─ streamClaude()     → Anthropic Claude + Anthropic 兼容格式端点
  └─ streamGoogle()     → Google Gemini
```

## 页面组件

| 组件 | 文件 | 职责 |
|------|------|------|
| AIChatPage | `pages/AIChat/AIChatPage.tsx` | 页面入口，加载模型列表，条件渲染欢迎界面/对话界面 |
| WelcomeChatView | `pages/AIChat/WelcomeChatView.tsx` | 欢迎界面：LobsterSVG 动画 + 提示语 + 居中 ChatInput |
| ChatSidebar | `pages/AIChat/ChatSidebar.tsx` | 会话列表：收藏区 + 历史记录，新建按钮 |
| ChatSidebarItem | `pages/AIChat/ChatSidebarItem.tsx` | 单条会话：hover 菜单（编辑/导出/删除/收藏） |
| ChatArea | `pages/AIChat/ChatArea.tsx` | 主聊天区布局 |
| ChatMessageList | `pages/AIChat/ChatMessageList.tsx` | 可滚动消息列表，流式状态展示 |
| ChatMessage | `pages/AIChat/ChatMessage.tsx` | 单条消息：Markdown 渲染、角色头像、模型标签 |
| ChatInput | `pages/AIChat/ChatInput.tsx` | 输入框 + 发送/停止按钮 + 模型选择器 + 无模型弹窗引导 |
| ModelSelector | `pages/AIChat/ModelSelector.tsx` | 模型下拉选择，按来源分组（内置/本地） |

## 状态管理 (Zustand)

### useChatStore

| 状态 | 说明 |
|------|------|
| `conversations` | 普通会话列表 |
| `favConversations` | 收藏会话列表 |
| `activeConversationId` | 当前选中会话 |
| `messages` | 当前会话消息 |
| `streaming` | 是否正在流式输出 |
| `streamingContent` | 流式缓冲区 |
| `streamingTaskId` | 用于取消流式 |

关键操作：
- `sendMessage()` — 发送消息，自动选择内置或本地流式路径
- `toggleFavorite()` — 收藏/取消收藏
- `exportConversation(format)` — 导出为 Markdown 或 JSON
- 标题自动生成：首次 user→assistant 交互后触发

### useAIModelStore

| 状态 | 说明 |
|------|------|
| `builtinModels` | 服务端内置模型列表 |
| `localModels` | 本地配置模型列表 |
| `selectedModelId` | 当前选择的模型 |
| `selectedModelSource` | `'builtin'` 或 `'local'` |

## AI 模型配置

在「设置 → AI 模型」标签页中管理本地模型：

| 字段 | 说明 |
|------|------|
| 名称 | 配置显示名称 |
| 提供商 | OpenAI / Claude / Google / Azure OpenAI / 通义千问 / 豆包 / DeepSeek / Kimi / OpenAI 兼容 / **Anthropic 兼容** |
| 端点 | API 地址（选择提供商后自动填充默认值） |
| API Key | 密钥（显示时掩码，保存时保留未修改值） |
| 模型 ID | 逗号或回车分隔的模型标识列表 |
| API 版本 | 仅 Azure OpenAI 需要 |

支持连接测试（Test）验证配置有效性。

## IPC 通道

| 通道 | 用途 |
|------|------|
| `ai:stream-chat` | 发起本地模型流式对话 |
| `ai:cancel-chat` | 取消进行中的流式 |
| `ai:generate-title` | 从首轮对话生成标题（最长 10 字） |
| `ai:chat-delta` | 推送事件：流式内容片段 |
| `ai:chat-done` | 推送事件：流式完成 + token 用量 |
| `ai:chat-error` | 推送事件：错误信息 |

## 后端 API

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/v1/chat/conversations` | 创建会话 |
| GET | `/api/v1/chat/conversations` | 列表查询（支持 `?favorited=1&limit=20&offset=0`） |
| GET | `/api/v1/chat/conversations/:id` | 获取会话及消息 |
| PUT | `/api/v1/chat/conversations/:id` | 更新标题/收藏状态 |
| DELETE | `/api/v1/chat/conversations/:id` | 删除会话（级联删除消息） |
| POST | `/api/v1/chat/conversations/:id/messages` | 发送消息 |
| GET | `/api/v1/chat/conversations/:id/messages` | 消息分页查询 |
| GET | `/api/v1/ai/models` | 获取内置模型列表 |
| POST | `/api/v1/ai/chat/stream` | 内置模型 SSE 流式端点 |

## 渲染特性

- **Markdown**: `react-markdown` + `remark-gfm` (GFM 扩展语法)
- **代码高亮**: `rehype-highlight` (highlight.js)，亮色 GitHub Light / 暗色 GitHub Dark
- **消息样式**: 用户消息右对齐蓝色背景，助手消息左对齐，气泡圆角
- **动画**: 流式光标闪烁 (1s)、思考中跳动圆点
- **主题**: 使用 Ant Design `theme.useToken()` 全局适配亮/暗模式

## 关键文件

| 文件 | 用途 |
|------|------|
| `frontend/src/renderer/src/stores/useChatStore.ts` | 会话状态管理 |
| `frontend/src/renderer/src/stores/useAIModelStore.ts` | 模型状态管理 |
| `frontend/src/main/services/ai.service.ts` | AI 提供商适配器 + 流式实现 |
| `frontend/src/main/ipc/ai.ipc.ts` | IPC 处理器 |
| `frontend/src/renderer/src/pages/AIChat/chat-styles.css` | 主题感知样式 |
| `frontend/src/renderer/src/pages/Settings/AIModelSettings.tsx` | 模型配置 CRUD |
