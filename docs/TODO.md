# ClawBench — 待办与技术债清单（Consolidated TODO）

集中记录探查到的真实 TODO、本期未实施的安全/类型加固项，避免散落在代码各处。
更新日期：2026-06-25（命名规范化重构 feat-misc 期间整理）。

## 安全加固（已做 / 待做）

### 本期已完成（Phase 2）
- [x] `developer.ipc.ts` 文件树 IPC 路径穿越守卫（`assertWithinAppRoots`，限定 `userData/user-apps`）
- [x] `utils/zip.ts` shell 注入修复（`execFileSync` 取代 `execSync` 字符串拼接；Windows PowerShell 单引号转义）
- [x] 后端 CORS 生产环境 fail-secure（缺失 `CORS_ORIGIN` 时启动报错，见 `backend/src/config/index.ts`）

### 待实施（本期记入，后续处理）
- [ ] **后端端点限流**：当前仅登录/注册有 `express-rate-limit`（`backend/src/app.ts`）。
      chat / ai / download（release 下载）等端点缺少限流，存在滥用风险。
- [ ] **上传 MIME 白名单**：`backend/src/routes/{applicationRoutes,chatRoutes,releaseRoutes}.ts`
      的 multer 上传未做 MIME / 扩展名白名单校验，应限定允许的文件类型与大小。
- [ ] **IPC 入参运行时校验**：多个 IPC handler 直接信任 renderer 入参（如
      `ipc/ai-coding.ipc.ts` 的 `toolType as any`，第 114/115/182/186 行）。
      应对 `toolType`、路径、ID 等做运行时枚举/类型校验，去掉 `as any`。

## 功能 / 集成

- [ ] **OpenCode 原生会话 provider 启用**：`services/native-sessions.service.ts:846`
      `opencodeProvider` 已实现但被注释禁用（`// TODO: enable after testing`）。
      待联调验证 `opencode session list` CLI 行为后启用。

## 文档一致性（命名重构遗留）

- [ ] `docs/AI_WORKBENCH.md` 文件名仍用旧模块名。模块已更名为 **AI Coding**
      （`/ai-coding`）。择机将该文档重命名为 `docs/AI_CODING.md` 并校正内文路由/命名。
- [ ] Python SDK 在 `CLAUDE.md` 示例中混用 `workbench_sdk` / `clawbench_sdk`，
      与实际包名 `clawbench_sdk`（`python-sdk/clawbench_sdk/`）对齐。
