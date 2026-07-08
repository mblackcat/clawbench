# Workbench App Param Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each Workbench app's last submitted params locally and reuse them on later runs.

**Architecture:** Put parameter defaulting, coercion, localStorage read/write, and manifest filtering in a focused renderer utility. Wire `InstalledAppsPage` and `ParamDrawer` to consume merged initial values without changing the Python runner or main-process execution API.

**Tech Stack:** Electron renderer, React 18, TypeScript, Ant Design Form, Vitest/jsdom.

---

### Task 1: Param Utility

**Files:**
- Create: `frontend/src/renderer/src/utils/subapp-params.ts`
- Test: `frontend/src/renderer/src/utils/__tests__/subapp-params.test.ts`

- [ ] **Step 1: Write failing utility tests**

Create tests that import `buildInitialAppParams`, `saveAppParams`, and `loadSavedAppParams`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/renderer/src/utils/__tests__/subapp-params.test.ts`

Expected: FAIL because the utility module does not exist yet.

- [ ] **Step 3: Implement utility**

Implement:

```ts
export function coerceParamValue(value: unknown, type: ParamType): unknown
export function buildManifestDefaultParams(params?: ParamDef[]): Record<string, unknown>
export function loadSavedAppParams(appId: string): Record<string, unknown>
export function saveAppParams(appId: string, params: Record<string, unknown>): void
export function buildInitialAppParams(appId: string, params?: ParamDef[]): Record<string, unknown>
```

- [ ] **Step 4: Run utility test to verify it passes**

Run: `npm test -- src/renderer/src/utils/__tests__/subapp-params.test.ts`

Expected: PASS.

### Task 2: Renderer Wiring

**Files:**
- Modify: `frontend/src/renderer/src/components/ParamDrawer.tsx`
- Modify: `frontend/src/renderer/src/pages/Workbench/InstalledAppsPage.tsx`

- [ ] **Step 1: Update `ParamDrawer`**

Add `initialValues?: Record<string, unknown>` prop and initialize the Ant Design form from that prop when provided.

- [ ] **Step 2: Update `InstalledAppsPage`**

Use `buildInitialAppParams(appId, manifest.params)` for direct runs and drawer initial values. Call `saveAppParams(drawerAppId, params)` before executing drawer-submitted params.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: exit code 0.

### Task 3: Final Verification

**Files:**
- Verify all modified frontend files.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/renderer/src/utils/__tests__/subapp-params.test.ts`

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck**

Run: `npm run typecheck`

Expected: exit code 0.

