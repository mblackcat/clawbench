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
| 收藏栏 | `/workbench/installed` | 已收藏资源卡片（应用/技能/提示词），拖拽排序，按类型执行不同操作 |
| 发现 | `/workbench/library` | 多资源发现市场：3 Tab（应用/AI 技能/提示词），搜索、安装、发布 |
| 我的 | `/workbench/my-contributions` | 本地创建的所有资源管理（草稿/本地/已发布状态） |
| Developer | `/developer/*` | App editor (3-step), SkillEditor (3-step), PromptEditor, LinkEditor, Monaco code editor, publisher |
| AI Chat | `/ai-chat` | Multi-model chat (OpenAI/Claude/Gemini), streaming, tool calling, MCP, welcome view |
| AI Agents | `/ai-agents` | AI agent management hub; OpenClaw at `/ai-agents/openclaw`; Hermes Agent at `/ai-agents/hermes` |
| AI Coding | `/ai-coding` | AI coding sessions (Claude Code/Codex/Gemini/Grok/…/Antigravity `agy`/Oh My Pi `omp`), workspace landing, split view, sidebar pin/sort/archive, VCS changes (git/svn/perforce, diff viewer), Feishu IM control |
| AI Terminal | `/ai-terminal` | Terminal + DB dual mode: local/SSH terminals, multi-DB GUI (MySQL/PG/Mongo/SQLite), AI assistant (model chat **or** CLI Agent mode) |
| Local Env | `/local-env` | Dev tool detection & install (Python/Node/Git/SVN/Perforce/Docker + AI CLIs incl. agy/omp), winget/Homebrew, pip/npm/docker China mirrors toggle |
| Settings | `/settings` | General, modules, AI models, MCP servers, image generation |

### Core Files

| File | Role |
|---|---|
| `frontend/src/main/services/hermes.service.ts` | Hermes Agent: install (spawn+stream), gateway start/stop/upgrade, config read/write (`~/.hermes/config.yaml` + `.env`), cron jobs, dashboard URL |
| `frontend/src/main/ipc/hermes.ipc.ts` | Thin IPC wrappers for all hermes.service operations (11 handlers) |
| `frontend/src/renderer/src/stores/useHermesStore.ts` | Hermes Zustand store: install state, install log, gateway status polling, config, cron jobs |
| `frontend/src/renderer/src/pages/AIAgents/HermesCard.tsx` | AI Agents hub preview card: brand logo + 4-stat info panel (version/status/model/channels) |
| `frontend/src/renderer/src/pages/Hermes/HermesPage.tsx` | Hermes detail page: StatusBar + 6-tab config (Providers/Channels/Skills/Tools/Memory/Cron) + BottomBar |
| `frontend/src/main/services/python-runner.service.ts` | Spawns Python sub-apps, parses JSON-line stdout, manages task lifecycle |
| `frontend/src/main/services/skill-activation.service.ts` | AI 技能部署：检测工作区 AI 工具类型，部署 SKILL.md 到 .claude/skills、.codex/skills、.gemini/skills |
| `frontend/src/preload/api.ts` | Typed bridge defining the entire `window.api` surface (incl. `skill` namespace) |
| `frontend/src/main/services/ai.service.ts` | AI provider adapters (OpenAI-compatible, Claude, Google) + streaming via StreamEmitter + tool calling |
| `frontend/src/main/services/mcp/mcp-client.service.ts` | MCP client: stdio/SSE transport, tool listing, tool calling |
| `frontend/src/main/services/im/im-bridge.service.ts` | IM Bridge: connects IM adapters to AI Coding |
| `frontend/src/main/services/ai-terminal.service.ts` | AI Terminal: SSH parsing, PTY management, multi-DB connection pool + query |
| `frontend/src/renderer/src/stores/useChatStore.ts` | Chat state: conversations, messages, streaming, tool calling |
| `frontend/src/renderer/src/components/ThinkingBlock.tsx` | Shared AI thinking/reasoning block component (used by AIChat, AICoding, AITerminal) |
| `frontend/src/renderer/src/utils/markdown-plugins.ts` | Shared rehype-highlight config with lowlight/common (37 languages) for reduced bundle size |
| `frontend/src/renderer/src/components/WeatherEffect.tsx` | 全屏天气粒子效果（雪/雨/风叶/烟花/樱花/流星/孔明灯），Canvas overlay；状态在 `stores/useWeatherStore.ts` |
| `frontend/src/renderer/src/theme/index.ts` | 主题模块：antd tokens、4 套配色（light-lagoon/light-meadow/dark-gunmetal/dark-ocean）、`isDarkTheme`/`getBaseTheme` 等 helper |
| `frontend/src/renderer/src/motion/` | 动效层（敏捷/优雅，`cb-motion`），见 `docs/MOTION.md` |
| `frontend/src/renderer/src/hooks/useXterm.ts` | Shared xterm 6 hook (fit/search/web-links/Nerd Font, preload PTY fan-out); used by `CodingTerminalView` + AI Terminal `TerminalPanel` with `TerminalSearchBar` |
| `frontend/src/main/services/pty-manager.service.ts` | PTY sessions: chunked raw ring buffer, tool command/resume args, `touchPtyActivity` (attention "output stable"), process-tree kill, `killAllPtySessions` on quit |
| `frontend/src/main/services/terminal-detect.service.ts` / `ide-detect.service.ts` | Terminal/IDE scan for Settings dropdowns; `openExternalTerminal()`; `resolveLocalTerminalShell()` |
| `frontend/src/main/services/python-venv.service.ts` / `python-detect.service.ts` | Workbench venv + per-app `requirements.txt`; Python scan. Resolve chain (`resolvePythonCommand`): app venv → settings path → workbench venv → system |
| `frontend/src/main/services/builtin-apps.service.ts` | Seeds bundled `builtin-apps/` into user-apps (install/upgrade, never downgrade) |
| `frontend/src/main/services/vcs.service.ts` | Multi-VCS (git/svn/perforce) detection, changed files, diff (`renderer/src/utils/unified-diff.ts` + `DiffViewerModal`) |
| `frontend/src/main/services/tray-attention.service.ts` | Attention tray + optional system notifications (sources: workbench / ai-chat / ai-coding); renderer `stores/useAttentionStore.ts` |
| `frontend/src/main/services/protocol/` | `clawbench://` URL router (`registry` + commands `app`/`auth`/`install`). **No shell `cmd` command** by design; `app` auto-install asks the user |
| `frontend/src/main/services/terminal-assistant.service.ts` + `terminal-exec-mcp.ts` | AI Terminal CLI Agent mode: per-host AI Coding group/session, exec target via `clawbench-terminal` MCP |
| `frontend/src/main/utils/ipc-validation.ts` | IPC argument validation (paths, commands, tool types — keep `VALID_TOOL_TYPES` in sync with `AIToolType`) |
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
- **AI Shared Components**: `ThinkingBlock` in `components/ThinkingBlock.tsx` — shared across AIChat, AICoding, AITerminal
- **Theme palettes**: `theme/index.ts` (`light-lagoon`/`light-meadow`/`dark-gunmetal`/`dark-ocean`; legacy `light`/`dark` aliases). Use `isDarkTheme()`/`getBaseTheme()` — never `theme === 'dark'`. Terminal colors from `utils/terminal-theme.ts`
- **Motion**: `motion/` (`cb-motion` agile/elegant, view transitions, stagger) + `styles/motion.css`; respects reduced motion — see `docs/MOTION.md`
- **Terminals**: always go through `hooks/useXterm.ts` (xterm 6); don't instantiate `Terminal` directly
- **Admin check**: `useIsAdmin()` hook in `useAuthStore`; outside React use `isAdminUser(user)` from `utils/is-admin-user.ts`
- **Coding tool list**: detect results are cached in `utils/coding-tools-cache.ts`; call `invalidateCodingToolsCache()` after install/uninstall/enable changes
- **AI tool ids**: AI Coding `AIToolType` (`antigravity`, `omp`, …) ↔ Local Env ids (`antigravity-cli`, `omp`, …) via `TOOL_ID_TO_AI_TYPE` (renderer) / `AI_TYPE_TO_TOOL_ID` (cli-detect). Only `claude-code`/`codex-cli` are enabled by default

### Main Process

- **Services** (`services/`) contain business logic, no IPC awareness
- **IPC handlers** (`ipc/`) are thin wrappers calling services
- **Stores** (`store/`) use `electron-store` with typed schemas
- **Auth tokens** encrypted with `safeStorage.encryptString()`
- **Paths**: Use `utils/paths.ts` for dev vs packaged resolution (`getUserAppsPath` honours `settings.userAppDir`; `getBuiltinAppsPath`)
- **Main-process strings**: `mainT()` from `utils/i18n.ts` (zh-CN + en)
- **Windows env**: `utils/windows-env.ts` (registry PATH merge, tool candidate paths); child processes killed with `utils/process-tree.ts`
- **pip mirror**: `settings.pipIndexUrl` / `CB_PIP_INDEX_URL` (none by default)

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
| `app`（默认） | `main.py` | AppEditor (3-step) | 运行 Python 子应用 |
| `ai-skill` | `SKILL.md` | SkillEditor (3-step) | 激活到工作区 AI 工具（Claude/Codex/Gemini） |
| `prompt` | `prompt.md` | PromptEditor (single page) | 复制提示词到剪贴板 |

### AI 技能激活 (Skill Activation)

技能通过 `window.api.skill` IPC 部署到 AI 工具工作区：
1. `detectWorkspaceType(path)` — 检测 `.claude`/`.codex`/`.gemini` 标记目录
2. `activate(skillId, path)` — 部署 SKILL.md 到对应 commands 目录
3. `deactivate(skillId, path)` — 移除已部署的技能

部署目标：`.claude/skills`、`.codex/skills`、`.gemini/skills`

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

全屏天气粒子特效系统（"氛围"），纯装饰性功能。入口在右上角头像菜单的「氛围」行（原底部状态栏已移除）。

**文件**: `frontend/src/renderer/src/components/WeatherEffect.tsx`（画布）、`stores/useWeatherStore.ts`（状态 + 自动天气调度，`useAutoWeather()` 在 AppLayout 挂载一次）、`components/WeatherIcon.tsx`（图标 + `useWeatherNames`）

**效果类型**: snow（雪花）、rain（雨滴）、leaves（风吹树叶）、fireworks（烟花）、sakura（樱花雨）、meteor（流星雨）、lantern（孔明灯）

**交互**:
- 头像菜单「氛围」开/关胶囊：开关天气效果（每次开启随机选择效果类型）
- 点击「氛围」文字（已开启时）或右键：切换效果类型（snow → rain → leaves → fireworks → sakura → meteor → lantern 循环）

**自动触发**:
- 每小时 50% 概率自动出现随机天气，持续 5~15 分钟后自动消失
- 启动时也会触发一次随机判断
- 用户手动开启时不受自动消失影响（`cb-weather-manual` flag）

**技术要点**:
- Canvas 全屏 overlay，`pointer-events: none` + `z-index: 9999`，不影响任何用户交互
- 粒子透明度 0.1~0.4，可见但不干扰阅读
- 菜单图标使用 inline SVG（非 emoji），避免 macOS CoreText 字体警告
- 状态通过 localStorage 持久化（`cb-weather-visible`、`cb-weather-type`、`cb-weather-manual`、`cb-weather-auto`）

## Hermes Agent Integration

[Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research — a messaging gateway AI agent that connects to Telegram/Discord/Slack/Signal.

**Install path**: `~/.local/bin/hermes` (symlink to `~/.hermes/bin/hermes`)
**Config**: `~/.hermes/config.yaml` (model, channels, skills, memory) + `~/.hermes/.env` (API keys)
**Gateway**: `hermes gateway` — default dashboard at `http://localhost:7860`

**IPC namespace**: `window.api.hermes.*`
- `checkInstalled()` → `{ installed, version? }`
- `install()` — spawns curl+bash with no timeout; progress streamed via `hermes:install-progress` push event
- `uninstall()` — removes `~/.hermes/` and symlink
- `getStatus()` → `'running' | 'stopped' | 'unknown'`
- `start() / stop() / upgrade()` — gateway lifecycle
- `getConfig() / saveConfig(config)` — read/write config.yaml + .env
- `getCronJobs()` → string[] (filenames from `~/.hermes/cron/`)
- `getDashboardUrl()` → `string | null` (null when gateway not running)

**Detail page tabs**:
| Tab | Key content |
|---|---|
| AI Providers | Radio-style provider cards (Anthropic/OpenAI/Google/Nous/OpenRouter/Custom); active one expands with model + API key |
| Channels | Telegram/Discord/Slack/Signal — toggle + token fields |
| Skills | 6 built-in read-only skills (web_search, file_system, shell, memory, learn, reflect) |
| Tools | 4 read-only tools (browser, computer_use, image_gen, code_exec) |
| Memory | Memory system toggle, user profile toggle, agent params (max turns, reasoning effort) |
| Scheduled Tasks | Lists files from `~/.hermes/cron/`; Empty state when none |

**Install implementation note**: uses `spawn` (not `execAsync`) to avoid timeout — `uv pip install` can take 10+ minutes. Pass `--skip-setup` so app manages config itself.

## Shell Mode (通用 / 研发)

Top-bar capsule toggle (`constants/app-mode.ts`, `AppMode = 'general' | 'pro'`, persisted under `cb-app-mode`).

- **研发 (pro)** — default; full left sidebar (all modules incl. AI Chat/Agents).
- **通用 (general)** — left sidebar hidden; workbench-focused. **All product routes remain reachable** (AI-inclusive allow-list in `isGeneralModePath`) — only the sider collapses.
- `resolveDefaultRoute(lastRoute, mode)` drives root + post-login landing. It **never drops** `/ai-chat`, `/ai-agents/*`, `/openclaw` — pro mode preserves them; general mode restores an allowed lastRoute else falls back to `/workbench/installed`.
- Sidebar gating: `AppLayout` renders `<Sider>` only when `shouldShowLeftSider(appMode)`; a misroute-guard redirects stale paths to workbench in general mode.
- Switching to 研发 auto-enables the AI Coding + Local Env modules (`withProModulesEnabled`); 通用 hides the workspace switcher and git branch selector in the TopBar.
- Mode state lives in `useSettingsStore` (`appMode` / `setAppMode`), hydrated from localStorage on boot.

## Shell chrome (no StatusBar)

- The bottom StatusBar was removed. Task status lives on the **avatar ring** (TopBar): spinning conic ring while a sub-app runs, pulsing warning ring for 6s after an error (`useTaskStore.errorAlert*`, tooltip shows the summary), green ring for 3.5s on completion.
- **Logs entry**: sidebar bottom button (研发) or a TopBar icon (通用, no sider). Both use `components/Layout/LogsIndicator.tsx`, which carries the merged badge (attention items / unread notifications / unseen task errors / unread system logs).
- Avatar menu: 4-swatch palette picker, language, motion (敏捷/优雅), atmosphere (weather), guide, settings, local IP (copy), version + manual update check, logout. A downloaded update also shows an "Update Client" button next to the avatar (updater no longer installs silently on quit).
- Content renders inside `.cb-content-island` with its own `ConfigProvider` (`getIslandThemeConfig`). Compare themes with `isDarkTheme()` / `getBaseTheme()` from `theme/`, never `=== 'dark'`.

## Projects & Common Apps (admin layer)

Multi-tenant **Projects** + **common-apps** (builtin app registry with admin kill-switch + admin-pin). AI chat/agent code is untouched.

**Backend** (`backend/src/`): `models/project.ts`, `controllers/{project,commonApp}Controller.ts`, `routes/{project,commonApp}Routes.ts`, `repositories/{project,commonApp}Repository.ts`, `database/schema/common-apps.seed.ts`. Mounted at `/api/v1/projects` and `/api/v1/common-apps`. 9 tables (`projects`, `project_members`, `project_app_configs`, `project_nav_groups`, `project_nav_links`, `common_apps`, `common_app_events`, `common_app_version_history`, `common_app_execution_errors`) across all 3 DB dialects; add-column migrations backfill older DBs (sqlite/mysql check-then-add, PG `ADD COLUMN IF NOT EXISTS`). Two-tier roles: global `users.role` (`admin|user`) vs project-scoped `project_members.role` (`admin|member`); last-project-admin protected. First registered user becomes global admin (first-user-wins in `userRepository`). ClawBench ships an **empty common-apps seed** — admins create builtins via `POST /api/v1/common-apps` (no CREATE in the fork; added here).
- **Archives**: admins publish a common-app archive via `POST /api/v1/common-apps/:appKey/upload` (multipart `file` + semver `version`; stored under `builtin-<appKey>/`, bumps version + version history); any logged-in user pulls it with `GET /:appKey/download` (increments `download_count` + records a download event; 404 when none). Responses expose `hasArchive`. `scripts/flush-builtin-apps.ts` (`sop.sh -flush-builtin`, also non-fatal after start/restart) publishes newer `frontend/builtin-apps` versions automatically (no-op if the dir is missing).
- **Project nav**: `/api/v1/projects/:projectId/nav/*` (groups, links, order, click, refresh-metadata) — admin-panel `ProjectNavDrawer`. Missing titles/icons are fetched server-side with SSRF protection (private addresses blocked unless `NAV_METADATA_ALLOW_PRIVATE=true`).
- **Applications**: `POST /api/v1/applications` accepts an optional `applicationId`/`id` (manifest id, `[a-zA-Z0-9][a-zA-Z0-9._-]*`, dup → 409); `scripts/migrate-application-ids.ts` (`sop.sh -migrate-app-ids [--apply]`) migrates legacy uuid IDs (fallback `cb.<user>.<slug>`). Execution reports accept `cancelled` (no error log).
- **Ops**: upload whitelists (`utils/uploadFilters.ts`), rate limits via `RATE_LIMIT_*`, `TRUST_PROXY` (default off) — see `backend/.env.example`.

**Desktop consumer side** (no admin UI — actions live in the web panel):
- `main/services/project.service.ts`: `enrichBuiltinAppParams` (kill-switch gate: project && global enable; throws `AppDisabledError`) + config injection (`__project`, `__app_config`). `BUILTIN_APP_ID_PREFIX = 'com.clawbench.builtin.'`.
- `main/ipc/subapp.ipc.ts`: gates builtin runs before `task-started`. `subapp:execute` returns `{ taskId, earlyTerminal? }`; on `AppDisabledError` / missing Python it returns `earlyTerminal` (status `disabled` | `failed` + i18n summary) without emitting task events — renderer seeds the task via `utils/subapp-execute.ts` (`seedTaskFromExecuteResult`). Builtin runs also get `__user` (userId/username/email/feishuId).
- `main/services/builtin-apps.service.ts`: `seedBuiltinApps()` at startup copies `resources/builtin-apps/*` (manifest id `com.clawbench.builtin.*`) into user-apps — installs missing, upgrades newer, never downgrades; `resetBuiltinApp` / `getBundledBuiltinVersion` back `subapp:reset-builtin` / `subapp:get-bundled-builtin-version`.
- `components/ProjectSwitcher.tsx` (read-only; TopBar; hidden in local mode), `apiClient.{listProjects,joinProject,listProjectCommonApps,listCommonApps}`.
- `store/settings.store.ts`: `activeProject`, `pinnedApps`, `commonAppConfigCache`.

**Web admin panel** (`backend/admin-panel/`): app management (incl. Common Apps: kill-switch/pin/sort/config/stats), Projects (members CRUD), and a tabbed Resources page for ai-skill/prompt/link.

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
