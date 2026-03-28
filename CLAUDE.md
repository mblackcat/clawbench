# CLAUDE.md - ClawBench Desktop App

## Project Overview

ClawBench is a cross-platform (Mac + Windows) desktop application for managing local workspaces and developer tools through a multi-resource content platform (应用/AI 技能/提示词), with a discovery marketplace and backend API.

**Tech Stack:**
- **Frontend**: Electron + React 18 + TypeScript + Ant Design v5 + Zustand + electron-vite
- **Backend**: Node.js + Express + TypeScript + SQLite/MySQL/PostgreSQL + JWT

## Quick Reference

```bash
# Frontend
cd frontend
npm run dev          # Start dev (electron-vite)
npm run build        # Production build
npm run build:mac    # Mac .dmg (x64 + arm64)
npm run build:win    # Windows .nsis
npm run typecheck    # Type checking
npm run lint         # ESLint

# Backend
cd backend
npm run dev          # API server (port 3001)
npm test             # Tests (200+, default SQLite)
npm run test:mysql   # Tests against MySQL
npm run test:postgres # Tests against PostgreSQL
npm run docker:up    # Start MySQL + PostgreSQL containers
```

## Architecture

### Electron Three-Process Model

```
Main Process (Node.js)              Preload (Bridge)              Renderer (React)
frontend/src/main/                  frontend/src/preload/         frontend/src/renderer/src/
  index.ts (entry)                    index.ts                      main.tsx (entry)
  services/*.ts (business logic)      api.ts (typed window.api)     pages/, components/
  ipc/*.ts (thin IPC wrappers)                                      stores/ (Zustand)
  store/*.ts (electron-store)                                       services/ (API client)
```

- **Main process** owns Node.js/OS capabilities: file system, child processes, electron-store, OAuth
- **Preload** exposes `window.api` via `contextBridge` (fully typed)
- **Renderer** is a pure React SPA; accesses system features only through `window.api`

### Backend (Controller → Service → Repository)

```
backend/src/
  controllers/    # Request handlers (user, application, chat, ai)
  services/       # Business logic (auth, storage, ai providers)
  repositories/   # Data access (type-safe DB operations)
  middleware/     # Auth (JWT), error handler, request logger
  database/       # Multi-DB adapter pattern (SQLite/MySQL/PostgreSQL)
    adapters/     # DatabaseAdapter interface + per-dialect adapters
    schema/       # Per-dialect DDL
```

### Key Modules

| Module | Route | Description |
|---|---|---|
| 收藏栏 | `/apps/installed` | 已收藏资源卡片（应用/技能/提示词），拖拽排序，按类型执行不同操作 |
| 发现 | `/apps/library` | 多资源发现市场：3 Tab（应用/AI 技能/提示词），搜索、安装、发布 |
| 我的 | `/apps/my-contributions` | 本地创建的所有资源管理（草稿/本地/已发布状态） |
| Developer | `/developer/*` | App editor (4-step), SkillEditor (3-step), PromptEditor, Monaco code editor, publisher |
| AI Chat | `/ai-chat` | Multi-model chat (OpenAI/Claude/Gemini), streaming, tool calling, MCP, welcome view |
| AI Agents | `/ai-agents` | AI agent management hub; OpenClaw detail at `/ai-agents/openclaw` |
| AI Workbench | `/ai-workbench` | AI coding sessions (Claude Code/Codex/Gemini), Feishu IM control |
| AI Terminal | `/ai-terminal` | Terminal + DB dual mode: local/SSH terminals, multi-DB GUI (MySQL/PG/Mongo/SQLite), AI assistant |
| Local Env | `/local-env` | Dev tool detection & install (Python/Node/Git/Docker + AI tools) |
| Settings | `/settings` | General, modules, AI models, MCP servers, image generation |

### Core Files

| File | Role |
|---|---|
| `frontend/src/main/services/python-runner.service.ts` | Spawns Python sub-apps, parses JSON-line stdout, manages task lifecycle |
| `frontend/src/main/services/skill-activation.service.ts` | AI 技能部署：检测工作区 AI 工具类型，部署 SKILL.md 到 .claude/commands、.codex/agents、.gemini/commands |
| `frontend/src/preload/api.ts` | Typed bridge defining the entire `window.api` surface (incl. `skill` namespace) |
| `frontend/src/main/services/ai.service.ts` | AI provider adapters (OpenAI-compatible, Claude, Google) + streaming via StreamEmitter + tool calling |
| `frontend/src/main/services/mcp/mcp-client.service.ts` | MCP client: stdio/SSE transport, tool listing, tool calling |
| `frontend/src/main/services/im/im-bridge.service.ts` | IM Bridge: connects IM adapters to AI Workbench |
| `frontend/src/main/services/ai-terminal.service.ts` | AI Terminal: SSH parsing, PTY management, multi-DB connection pool + query |
| `frontend/src/renderer/src/stores/useChatStore.ts` | Chat state: conversations, messages, streaming, tool calling |
| `frontend/src/renderer/src/components/ThinkingBlock.tsx` | Shared AI thinking/reasoning block component (used by AIChat, AIWorkbench, AITerminal) |
| `frontend/src/renderer/src/utils/markdown-plugins.ts` | Shared rehype-highlight config with lowlight/common (37 languages) for reduced bundle size |
| `frontend/src/renderer/src/components/WeatherEffect.tsx` | 全屏天气粒子效果（雪/雨/风叶/烟花/樱花/流星/孔明灯），Canvas overlay + useWeatherEffect hook |
| `frontend/src/renderer/src/i18n/index.ts` | 全局多语言翻译（中英文），useT() hook |
| `frontend/src/renderer/src/pages/AIChat/WelcomeChatView.tsx` | AI Chat 欢迎界面：无对话时显示 Logo 动画 + 提示语 + 居中输入框 |
| `frontend/python-sdk/clawbench_sdk/base_app.py` | Abstract base class for Python sub-apps |
| `backend/src/database/index.ts` | DB adapter factory (DB_TYPE → SQLite/MySQL/PG) |
| `backend/src/services/aiService.ts` | Backend AI provider adapters + SSE streaming |

## Conventions

### Renderer

- **State**: Zustand stores in `stores/`, each calls `window.api.*` for IPC
- **Routing**: `HashRouter` (required for Electron `file://`), routes in `routes.tsx`
- **UI**: Ant Design v5 + `zhCN` locale + `@ant-design/icons`
- **i18n**: `useT()` hook from `i18n/index.ts`, supports `zh-CN` and `en`. All user-facing strings must use `t('key')` — never hardcode Chinese/English text
- **Theming**: Use `theme.useToken()` for colors. **Never** hardcode `#fff`/`#333` — use tokens for dark/light mode
- **Message/Modal**: Use `App.useApp()` for context-aware instances. **Never** use static `message.success()` or `Modal.confirm()`
- **Types**: `window.api` typed via `types/ipc.ts`
- **API calls**: Use `apiClient` service (auto JWT management)
- **DnD**: `@dnd-kit/core` + `@dnd-kit/sortable` with `PointerSensor` + `activationConstraint`
- **Markdown**: Use `rehypeHighlightPlugin` from `utils/markdown-plugins.ts` (NOT raw `rehype-highlight`) — uses lowlight/common for reduced bundle size
- **AI Shared Components**: `ThinkingBlock` in `components/ThinkingBlock.tsx` — shared across AIChat, AIWorkbench, AITerminal

### Main Process

- **Services** (`services/`) contain business logic, no IPC awareness
- **IPC handlers** (`ipc/`) are thin wrappers calling services
- **Stores** (`store/`) use `electron-store` with typed schemas
- **Auth tokens** encrypted with `safeStorage.encryptString()`
- **Paths**: Use `utils/paths.ts` for dev vs packaged resolution

### Backend

- **DB**: Set `DB_TYPE` to `sqlite` (default), `mysql`, or `postgres`. Repos use `?` placeholders; PG adapter auto-converts to `$1,$2,...`
- **Transactions**: MySQL/PG use `AsyncLocalStorage` to scope connections in `transaction()` callbacks
- **PM2 Cluster**: Only primary instance runs schema init. Feishu OAuth state is DB-backed
- **Response format**: `{ success: boolean, data?: any, error?: { code, message, details } }`
- **Testing**: Jest, `cleanAllTables()` from `helpers/db-cleanup.ts` for FK-safe cleanup

## Python Sub-App Protocol

### Resource Types (资源类型)

市场支持三种资源类型，由 `manifest.json` 的 `type` 字段区分：

| Type | Entry File | 编辑器 | 收藏栏操作 |
|---|---|---|---|
| `app`（默认） | `main.py` | AppEditor (4-step) | 运行 Python 子应用 |
| `ai-skill` | `SKILL.md` | SkillEditor (3-step) | 激活到工作区 AI 工具（Claude/Codex/Gemini） |
| `prompt` | `prompt.md` | PromptEditor (single page) | 复制提示词到剪贴板 |

### AI 技能激活 (Skill Activation)

技能通过 `window.api.skill` IPC 部署到 AI 工具工作区：
1. `detectWorkspaceType(path)` — 检测 `.claude`/`.codex`/`.gemini` 标记目录
2. `activate(skillId, path)` — 部署 SKILL.md 到对应 commands 目录
3. `deactivate(skillId, path)` — 移除已部署的技能

部署目标：`.claude/commands`、`.codex/agents`、`.gemini/commands`

### manifest.json

```json
{
  "id": "com.company.app-name",
  "name": "Display Name",
  "version": "1.0.0",
  "type": "app",
  "entry": "main.py",
  "params": [
    { "name": "branch", "type": "string", "label": "Branch", "required": true, "default": "main" }
  ]
}
```

`type` 可选值：`app`（默认）| `ai-skill`（entry 为 `SKILL.md`）| `prompt`（entry 为 `prompt.md`）

Param types: `string | boolean | number | enum | path | text`

### Writing a Sub-App

```python
from workbench_sdk import WorkbenchApp

class MyApp(WorkbenchApp):
    def run(self) -> None:
        self.emit_output("Starting...", "info")
        self.emit_progress(50.0, "Halfway")
        self.emit_result(True, "Done!")

if __name__ == "__main__":
    MyApp.execute()
```

### JSON-Line Output Protocol

```json
{"type": "output", "message": "...", "level": "info|warn|error"}
{"type": "progress", "percent": 50.0, "message": "..."}
{"type": "result", "success": true, "summary": "..."}
{"type": "error", "message": "...", "details": "..."}
```

## Packaging

- `electron-builder`, config in `package.json` `"build"` field
- `python-sdk/` bundled as `extraResources`
- Auto-update via `electron-updater` with self-hosted generic provider (`/api/v1/releases`)
- Upload: `npm run build:upload:mac` (build + upload artifacts)

## Important Notes

- **Feishu OAuth**: `FEISHU_APP_ID`/`FEISHU_APP_SECRET` in `auth.service.ts` are placeholders
- **Sub-app discovery**: Scans `{userData}/user-apps/` (installed) for `manifest.json`，支持 app/ai-skill/prompt 三种类型
- **ApplicationType**: 后端 `applications` 表有 `type` 字段（`app` | `ai-skill` | `prompt`），默认 `app`，有 `idx_applications_type` 索引
- **JWT Secret**: Must be changed in production
- **DB Schema**: Auto-created on startup

## Weather Effect (天气效果)

状态栏右下角的天气粒子特效系统，纯装饰性功能。

**文件**: `frontend/src/renderer/src/components/WeatherEffect.tsx`

**效果类型**: snow（雪花）、rain（雨滴）、leaves（风吹树叶）、fireworks（烟花）、sakura（樱花雨）、meteor（流星雨）、lantern（孔明灯）

**交互**:
- 左键点击状态栏云朵图标：开关天气效果（每次开启随机选择效果类型）
- 右键点击图标：切换效果类型（snow → rain → leaves → fireworks → sakura → meteor → lantern 循环）

**自动触发**:
- 每小时 50% 概率自动出现随机天气，持续 5~15 分钟后自动消失
- 启动时也会触发一次随机判断
- 用户手动开启时不受自动消失影响（`cb-weather-manual` flag）

**技术要点**:
- Canvas 全屏 overlay，`pointer-events: none` + `z-index: 9999`，不影响任何用户交互
- 粒子透明度 0.1~0.4，可见但不干扰阅读
- 状态栏图标使用 inline SVG（非 emoji），避免 macOS CoreText 字体警告
- 状态通过 localStorage 持久化（`cb-weather-visible`、`cb-weather-type`、`cb-weather-manual`、`cb-weather-auto`）

## General Rules

- **Never revert or undo user changes without explicitly asking first.** If a line is commented out or removed by the user, assume it was intentional.
- When fixing bugs, consider edge cases thoroughly before committing. Test the fix against multiple input variations (e.g., string prefixes, version formats, empty values, Chinese characters) rather than implementing the obvious first fix.
- When splitting files or refactoring modules, preserve all existing functionality and verify imports. Ensure changes haven't corrupted existing code (especially function declarations).

## Git Workflow

- After making code changes, always commit and push to **ALL** configured remotes (`git remote` 列出的所有远端) unless told otherwise
- Use conventional commit messages in English

## UI Development

- Use `antd` current non-deprecated APIs (e.g., `Space.Compact` instead of `Button.Group`)
- For React hooks, avoid putting derived data in state or dependencies that create new references each render (e.g., i18n's `t` function — use stable references)
- When implementing visual/UI features, prefer iterative small changes over big-bang implementations
- For animations, default to 60fps unless told otherwise
