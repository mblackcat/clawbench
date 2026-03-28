## Context

The OpenClaw module uses a three-layer architecture: `openclaw.store.ts` (electron-store schema + default items), `openclaw.service.ts` (business logic, CLI invocation), `openclaw.ipc.ts` (thin IPC wrappers), and the React pages/stores in the renderer. The `OpenClawItem` type is the central data model shared across all layers.

The existing `FeishuGuideModal` lives in `pages/AIWorkbench/` and is already polished — it only needs to be moved to `components/` and re-imported.

The `cron` item today is a simple toggle in the built-in features list. To surface cron job management, we need to read the actual jobs from the OpenClaw config (`~/.openclaw/openclaw.json` → `cron.jobs` array) and provide CRUD controls.

## Goals / Non-Goals

**Goals:**
- Zero-friction first-time setup: every config field that needs an external credential has a clickable link to the relevant docs/signup page
- Community skills are browsable and installable without leaving the app
- Cron jobs are visible and controllable in a human-readable UI

**Non-Goals:**
- Full cron editor (creating new jobs from scratch) in this change — only manage existing jobs that OpenClaw already knows about
- Caching or offline fallback for community skills API
- i18n beyond existing Chinese UI convention

## Decisions

### Decision 1: Extend `OpenClawItem` with `docsUrl` / `openclawDocsUrl` (not a separate lookup table)

Keeping the links co-located with the item definition in `getDefaultItems()` is the simplest approach. The alternative (a separate mapping keyed by item id) adds indirection with no benefit since these are static strings.

### Decision 2: Community skills fetched at runtime via a new IPC channel, not bundled

ClawHub skills are community-maintained and change frequently. A runtime fetch via `https://clawhub.ai/api/skills?sort=downloads&limit=20` ensures freshness. The main process owns the fetch (keeping renderer free of direct HTTP calls to third-party APIs). A loading/error state in the store handles network failures gracefully.

### Decision 3: Cron expression → Chinese natural language via lightweight parser in main process

No npm package needed. A custom `parseCronToNaturalLanguage(expr: string): string` utility covering the most common patterns (every N minutes, hourly, daily at HH:MM, weekly, monthly) handles 95% of real-world jobs. Edge cases render as the raw expression. This avoids adding a dependency (e.g., `cronstrue`) for a minor feature.

### Decision 4: Frequency grouping order

Groups ordered from high to low frequency: 分钟级 → 小时级 → 日级 → 周级 → 月级 → 其他. Each group is an `Ant Design` `Divider` with the group label, followed by its cards. Empty groups are hidden.

### Decision 5: Move `FeishuGuideModal` to `components/`

Currently the modal is inside `pages/AIWorkbench/`. Moving it to `frontend/src/renderer/src/components/FeishuGuideModal.tsx` makes it importable from both `OpenClaw` and `AIWorkbench` pages. The existing AIWorkbench import site gets updated to the new path — no behavioral change.

### Decision 6: Install skill via `openclaw skill install <id>` subprocess

This reuses the existing `getAugmentedEnv()` + `spawn` pattern from `startService()`. The main process runs the install command, streams stdout to a notification, and marks the skill as installed in a local `Set<string>` in the store (persisted in electron-store under `installedSkills`).

## File Map

```
Modified:
  frontend/src/main/store/openclaw.store.ts
    - Add docsUrl/openclawDocsUrl to OpenClawItem interface
    - Add installedSkills: string[] to schema
    - Reorder comm_tools: feishu first
    - Add docsUrl/openclawDocsUrl to all default items
    - Bump schema version guard

  frontend/src/main/services/openclaw.service.ts
    - Add listCommunitySkills(): Promise<CommunitySkill[]>
    - Add installSkill(id: string): Promise<{success: boolean; output: string}>
    - Add getCronJobs(): Promise<CronJob[]>  (reads ~/.openclaw/openclaw.json cron.jobs)
    - Add toggleCronJob(id: string, enabled: boolean): Promise<void>
    - Add parseCronToNaturalLanguage(expr: string): string  (private helper)

  frontend/src/main/ipc/openclaw.ipc.ts
    - Register: openclaw:list-community-skills
    - Register: openclaw:install-skill
    - Register: openclaw:get-cron-jobs
    - Register: openclaw:toggle-cron-job

  frontend/src/preload/api.ts
    - Add listCommunitySkills, installSkill, getCronJobs, toggleCronJob to window.api.openclaw

  frontend/src/renderer/src/types/openclaw.ts
    - Add docsUrl?: string, openclawDocsUrl?: string to OpenClawItem
    - Add CommunitySkill interface
    - Add CronJob interface + CronFrequencyGroup type

  frontend/src/renderer/src/stores/useOpenClawStore.ts
    - Add communitySkills, cronJobs, skillsLoading, cronLoading state
    - Add fetchCommunitySkills(), installSkill(id), fetchCronJobs(), toggleCronJob(id, enabled) actions

  frontend/src/renderer/src/pages/OpenClaw/OpenClawPage.tsx
    - Add "定时任务" tab (4th tab)
    - Render CronJobManager in cron tab
    - Add community skills section below built-in skills in skills tab
    - Add FeishuGuideModal trigger in Feishu card header
    - Remove standalone cron toggle from built-in features (cron moves to dedicated tab)

  frontend/src/renderer/src/pages/OpenClaw/OpenClawItemCard.tsx
    - Render docsUrl link button (官方文档)
    - Render openclawDocsUrl link button (OpenClaw 指引)
    - Feishu card: render 配置指引 button that opens FeishuGuideModal

  frontend/src/renderer/src/pages/AIWorkbench/AIWorkbenchIMConfigModal.tsx
    - Update FeishuGuideModal import path from local → components/

Created:
  frontend/src/renderer/src/components/FeishuGuideModal.tsx
    - Moved verbatim from pages/AIWorkbench/FeishuGuideModal.tsx

  frontend/src/renderer/src/pages/OpenClaw/CommunitySkillCard.tsx
    - Props: skill: CommunitySkill, isInstalled: boolean, onInstall: () => void, installing: boolean
    - Shows: name, description, download count badge, Install/Installed button

  frontend/src/renderer/src/pages/OpenClaw/CronJobManager.tsx
    - Reads cronJobs from store, groups by frequency
    - Renders grouped cards with NL description, next run time, start/stop toggle
    - Global enable/disable all + refresh button
```
