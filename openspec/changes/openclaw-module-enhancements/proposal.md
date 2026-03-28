## Why

The OpenClaw module currently lacks documentation links for users to find API keys and understand configuration options, the skills section only shows built-in presets with no access to community skills, and there is no way to manage cron jobs visually. This creates friction for first-time setup and limits discoverability of the OpenClaw ecosystem.

## What Changes

1. **AI Providers — Add API & docs links**: Each provider card gains an `apiDocsUrl` (official API key page) and an `openclawDocsUrl` (OpenClaw configuration guide). A small link button in the card header lets users jump directly to the relevant page.

2. **Communication Tools — Feishu first + docs links**: Feishu moves to position 1 in the `comm_tool` list. Each tool card gains an `openclawDocsUrl`. Feishu additionally gets a "配置指引" button that opens the existing `FeishuGuideModal` (currently only in AI Workbench) — the modal is extracted to a shared location and reused here.

3. **Built-in Features — OpenClaw docs links**: Each built-in feature card gains an `openclawDocsUrl` pointing to `https://docs.openclaw.ai/tools`.

4. **Skills — Community marketplace tab**: The `skill` category is replaced by a split layout:
   - **Built-in Skills** section: existing `coding` and `elevated` items (ClawHub marketplace item removed, replaced by the new tab).
   - **Community Skills** section: fetches hot skills from `clawhub.ai` API at runtime, displays each as a card with name, description, download count, and an **Install** / **Installed** button. Install calls `openclaw skill install <id>` via a new IPC channel.

5. **Cron Job Management — new tab**: Replaces the simple `cron` toggle in built-in features with a dedicated "定时任务" tab. The tab lists all configured cron jobs as cards, translates each cron expression to a human-readable Chinese description (e.g., `0 9 * * 1-5` → "工作日每天 09:00"), groups cards by frequency unit (分钟级 / 小时级 / 日级 / 周级 / 月级), and provides per-job Start / Stop controls plus a global Add Job button.

## Capabilities

### New Capabilities
- `openclaw-docs-links`: Navigation links to official API & OpenClaw docs embedded in provider/channel/tool cards
- `clawhub-community-skills`: Browse and one-click install community skills from clawhub.ai with installed-status detection
- `cron-job-manager`: Visual cron job management with natural-language descriptions, frequency grouping, and per-job lifecycle controls

### Modified Capabilities
- `openclaw-comm-tools`: Feishu reordered to first position; all channels gain docs links; Feishu gains config guide modal
- `openclaw-builtin-features`: Each built-in feature gains docs link; `cron` moves from toggle to dedicated tab

## Impact

- `frontend/src/main/store/openclaw.store.ts`: Add `docsUrl`/`openclawDocsUrl` fields to `OpenClawItem`; reorder Feishu to index 0 in comm_tools; update schema version guard
- `frontend/src/main/ipc/openclaw.ipc.ts`: Add `openclaw:list-community-skills`, `openclaw:install-skill`, `openclaw:get-cron-jobs`, `openclaw:toggle-cron-job` handlers
- `frontend/src/main/services/openclaw.service.ts`: Add `listCommunitySkills()`, `installSkill(id)`, `getCronJobs()`, `toggleCronJob(id, enabled)` methods
- `frontend/src/renderer/src/types/openclaw.ts`: Add `docsUrl`, `openclawDocsUrl` to `OpenClawItem`; add `CommunitySkill`, `CronJob` types
- `frontend/src/preload/api.ts`: Expose new IPC channels under `window.api.openclaw`
- `frontend/src/renderer/src/stores/useOpenClawStore.ts`: Add `communitySkills`, `cronJobs` state + fetch/install/toggle actions
- `frontend/src/renderer/src/pages/OpenClaw/OpenClawPage.tsx`: Add "定时任务" tab; wire docs-link buttons; add community skills section in skills tab
- `frontend/src/renderer/src/pages/OpenClaw/OpenClawItemCard.tsx`: Add docs-link button rendering when `docsUrl` or `openclawDocsUrl` present
- `frontend/src/renderer/src/pages/OpenClaw/CommunitySkillCard.tsx`: New component — community skill card with install button
- `frontend/src/renderer/src/pages/OpenClaw/CronJobManager.tsx`: New component — cron job list with NL descriptions, grouping, start/stop
- `frontend/src/renderer/src/pages/AIWorkbench/FeishuGuideModal.tsx` → `frontend/src/renderer/src/components/FeishuGuideModal.tsx`: Move to shared components; update all import sites
