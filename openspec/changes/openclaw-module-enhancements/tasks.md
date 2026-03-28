## 1. 数据类型扩展

- [x] 1.1 在 `frontend/src/renderer/src/types/openclaw.ts` 中为 `OpenClawItem` 添加 `docsUrl?: string` 和 `openclawDocsUrl?: string` 字段
- [x] 1.2 在同文件添加 `CommunitySkill` 接口（id, name, description, downloads, installCmd）
- [x] 1.3 在同文件添加 `CronJob` 接口（id, name, expression, enabled, description, nextRun?）和 `CronFrequencyGroup` 类型

## 2. Store 层——默认数据更新

- [x] 2.1 在 `openclaw.store.ts` 的 `OpenClawItem` 接口中添加 `docsUrl?` 和 `openclawDocsUrl?` 字段
- [x] 2.2 在 `openclaw.store.ts` 的 electron-store schema 中添加 `installedSkills: string[]` 字段
- [x] 2.3 更新 `getDefaultItems()` 中 AI 服务商条目，添加 `docsUrl`（官方 API Key 申请页）和 `openclawDocsUrl`（OpenClaw 文档）：
  - openai → `https://platform.openai.com/api-keys` / `https://docs.openclaw.ai/providers/openai`
  - anthropic → `https://console.anthropic.com/settings/keys` / `https://docs.openclaw.ai/providers/anthropic`
  - google → `https://aistudio.google.com/app/apikey` / `https://docs.openclaw.ai/concepts/model-providers#google-gemini-api-key`
  - deepseek → `https://platform.deepseek.com/api_keys` / `https://docs.openclaw.ai/providers/deepseek`（若存在）
  - custom → 无 docsUrl / 无 openclawDocsUrl
- [x] 2.4 将通信工具列表中 `feishu` 条目移至第一个位置，并添加 `docsUrl: 'https://open.larkoffice.com/'` 和 `openclawDocsUrl: 'https://docs.openclaw.ai/channels/feishu'`
- [x] 2.5 为其他通信工具添加 `openclawDocsUrl`：
  - telegram → `https://docs.openclaw.ai/channels/telegram`
  - discord → `https://docs.openclaw.ai/channels/discord`
  - slack → `https://docs.openclaw.ai/channels/slack`
  - whatsapp → 暂不添加（无官方文档）
- [x] 2.6 为所有内置功能条目添加 `openclawDocsUrl: 'https://docs.openclaw.ai/tools'`
- [x] 2.7 更新 schema version guard：在 `getOpenClawConfig()` 中增加检测逻辑（检查 openai 条目是否缺少 `openclawDocsUrl`），若检测到旧版本则重置为新默认值
- [x] 2.8 导出新增的 `getInstalledSkills()` 和 `setInstalledSkills(ids: string[])` helper 函数

## 3. Service 层——新增业务逻辑

- [x] 3.1 在 `openclaw.service.ts` 中添加 `parseCronToNaturalLanguage(expr: string): string` 私有方法，处理常见模式（每分钟、每小时、每日定时、工作日、每周、每月）
- [x] 3.2 添加 `listCommunitySkills(): Promise<CommunitySkill[]>` 方法，HTTP GET `https://clawhub.ai/api/skills?sort=downloads&limit=20`，失败时返回空数组并 log warn
- [x] 3.3 添加 `installSkill(id: string): Promise<{success: boolean; output: string}>` 方法，通过 `spawn('openclaw', ['skill', 'install', id])` 执行并收集 stdout
- [x] 3.4 添加 `getCronJobs(): Promise<CronJob[]>` 方法，读取 `~/.openclaw/openclaw.json` 中 `cron.jobs` 数组，调用 `parseCronToNaturalLanguage` 填充 `description` 字段
- [x] 3.5 添加 `toggleCronJob(id: string, enabled: boolean): Promise<void>` 方法，更新 `~/.openclaw/openclaw.json` 中对应 job 的 `enabled` 字段并保存文件

## 4. IPC 层

- [x] 4.1 在 `openclaw.ipc.ts` 注册 `openclaw:list-community-skills` → `openclawService.listCommunitySkills()`
- [x] 4.2 注册 `openclaw:install-skill` (id) → `openclawService.installSkill(id)`
- [x] 4.3 注册 `openclaw:get-cron-jobs` → `openclawService.getCronJobs()`
- [x] 4.4 注册 `openclaw:toggle-cron-job` (id, enabled) → `openclawService.toggleCronJob(id, enabled)`

## 5. Preload 层

- [x] 5.1 在 `preload/api.ts` 的 `openclaw` 对象中添加：`listCommunitySkills`, `installSkill`, `getCronJobs`, `toggleCronJob`

## 6. 共享组件——迁移 FeishuGuideModal

- [x] 6.1 将 `pages/AIWorkbench/FeishuGuideModal.tsx` 复制到 `components/FeishuGuideModal.tsx`
- [x] 6.2 删除 `pages/AIWorkbench/FeishuGuideModal.tsx`
- [x] 6.3 更新 `pages/AIWorkbench/AIWorkbenchIMConfigModal.tsx` 中的 import 路径

## 7. Renderer Store

- [x] 7.1 在 `useOpenClawStore.ts` 中添加 state：`communitySkills: CommunitySkill[]`, `installedSkillIds: string[]`, `skillsLoading: boolean`, `cronJobs: CronJob[]`, `cronLoading: boolean`
- [x] 7.2 添加 action `fetchCommunitySkills()`：调用 `window.api.openclaw.listCommunitySkills()`，更新 communitySkills + 从 store 读取 installedSkillIds
- [x] 7.3 添加 action `installSkill(id: string)`：调用 IPC → 成功后将 id 加入 installedSkillIds 并持久化
- [x] 7.4 添加 action `fetchCronJobs()`：调用 `window.api.openclaw.getCronJobs()` 更新 cronJobs
- [x] 7.5 添加 action `toggleCronJob(id: string, enabled: boolean)`：调用 IPC → 本地更新 cronJobs 中对应条目

## 8. 新增 UI 组件

- [x] 8.1 创建 `pages/OpenClaw/CommunitySkillCard.tsx`：展示社区技能卡片，含名称、描述、下载量 badge、安装状态（已安装/安装中/安装）按钮
- [x] 8.2 创建 `pages/OpenClaw/CronJobManager.tsx`：
  - 按频率分组展示 cron job 卡片
  - 每张卡片显示：任务名、自然语言描述、下次执行时间、启用/停止 Switch
  - 顶部工具栏：刷新按钮、全部启用/停止
  - 空状态提示：若无 cron jobs，显示说明文字

## 9. 修改 OpenClawItemCard

- [x] 9.1 在卡片标题区域渲染 `docsUrl` 链接按钮（图标 + "官方文档" 文字，`target="_blank"`）
- [x] 9.2 渲染 `openclawDocsUrl` 链接按钮（图标 + "OpenClaw 指引" 文字）
- [x] 9.3 Feishu 卡片特判：渲染 "配置指引" 按钮，点击打开 FeishuGuideModal

## 10. 修改 OpenClawPage

- [x] 10.1 在技能 tab 下方（内置技能之后）新增 "社区技能" 分组，渲染 CommunitySkillCard 列表，tab 激活时触发 `fetchCommunitySkills()`
- [x] 10.2 移除内置功能 tab 中的 `cron` 条目（cron 功能移到专用 tab）
- [x] 10.3 新增第 5 个 tab "定时任务"，渲染 CronJobManager，tab 激活时触发 `fetchCronJobs()`
- [x] 10.4 在内置功能 tab 的 `cron` 对应条目处，保留 `cron` enable toggle（控制是否全局启用 cron），但移除其在内置功能卡片列表中的显示（cron 现在有独立 tab）

## 11. 类型检查

- [x] 11.1 在 `frontend/` 目录运行 `npm run typecheck` 确认无类型错误
