# Application Logging System

## Overview

All application execution logs are sent to a unified logging system in the ClawBench. Users access logs through the log panel in the bottom-left corner of the interface.

## Log Flow

1. **Run an app** -- User clicks the Run button on an installed app or from the app library.
2. **Execution starts** -- The app begins executing and a task record is created in the task store.
3. **View logs** -- User clicks the log icon in the bottom-left corner to open the log panel.
4. **Log content** -- The panel displays app output (stdout), error messages (stderr), progress updates, and execution status (started, completed, failed).

## Log Display

### Grouped by Task

Logs are grouped by task (one task per app execution). Each task group shows:

- **Task header**: App name, status badge, start time, result summary
- **Log entries**: Each entry shows type tag, timestamp, and message
- **Separator**: Visual divider between task groups

Tasks are sorted in reverse chronological order (newest first).

### Status Badges

| Status | Label | Color |
|--------|-------|-------|
| running | Running | Blue (animated) |
| completed | Completed | Green |
| failed | Failed | Red |
| cancelled | Cancelled | Gray |

### Log Type Tags

| Type | Tag Color | Text Style |
|------|-----------|------------|
| output | Default | Normal |
| error | Red | Danger |
| progress | Blue | Normal |
| result | Green | Success |

## Technical Implementation

### Execution Flow

1. User clicks Run button.
2. `executeApp(appId, params)` is called, which:
   - Calls `window.api.subapp.execute(appId, params)` to start the app
   - Calls `startTask(taskId, appId, appName)` to create a task record
   - Sets the active task ID
3. Global listeners (initialized in `AppLayout`) receive events:
   - `subapp:output` -- adds to `task.outputs`
   - `subapp:progress` -- updates `task.progress`
   - `subapp:task-status` -- updates `task.status`
   - `subapp:ui` -- renders/updates/closes Ant Design Modal dialogs via `SubAppDialog`
4. The log drawer reads from `taskStore.tasks` and renders grouped entries.

### Key Components

| Component | Role |
|-----------|------|
| `AppLayout.tsx` | Initializes global `useSubAppExecution` listener and mounts `SubAppDialog` |
| `SubAppDialog.tsx` | Renders sub-app UI dialogs (ui_show/ui_update/ui_close) as Ant Design Modals |
| `ErrorLogDrawer.tsx` | Renders the log panel with grouped task logs |
| `useSubAppExecution.ts` | Hook that manages IPC event listeners and task state |
| `useTaskStore.ts` | Zustand store holding all task records and outputs |

### Running an App from a Page

Application pages use `taskStore` methods directly (not `useSubAppExecution`) to avoid duplicate event listeners:

```typescript
import { useTaskStore } from '../../stores/useTaskStore';

const startTask = useTaskStore((state) => state.startTask);
const setActiveTask = useTaskStore((state) => state.setActiveTask);

const handleRun = async (appId: string, appName: string) => {
  const taskId = await window.api.subapp.execute(appId, {});
  startTask(taskId, appId, appName);
  setActiveTask(taskId);
  message.success(`App ${appName} started. Check logs in the bottom-left corner.`);
};
```

### Style Details

- Task headers use the theme primary color (`token.colorPrimaryBg` background, `token.colorPrimary` left border)
- Log entries use a compact single-line flex layout: `[tag] time message`
- Type tags have fixed minimum width (50px) for alignment
- Timestamps: task headers show `MM/DD HH:MM:SS`, log entries show `HH:MM:SS`

## Clearing Logs

The "Clear completed" button removes tasks with status `completed`, `failed`, or `cancelled`, keeping `running` tasks visible.
