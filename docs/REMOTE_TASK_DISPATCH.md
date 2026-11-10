# Remote Task Dispatch

Admins can ask logged-in ClawBench desktop clients to run a **specific,
published app version** with preset parameters — e.g. a cache clean-up, a
dependency fix, or a project-wide pre-build check — and follow each machine's
result from the web admin panel (**Task Dispatch**).

Design in one line: **push to notify, pull to work**. A Server-Sent Events
stream only says "there is a new task"; the client pulls the task over an
authenticated request, the server claims it per machine, and the client
reports the result. No WebSocket, no message broker.

## Trust model (read this first)

This feature lets a server start code on users' machines, so every layer is
restricted:

| Layer | Rule |
| :--- | :--- |
| **Who can dispatch** | Global admins only (`authenticate` + `requireAdmin` on `/api/v1/admin/tasks*`). Project admins cannot. `dispatched_by` is recorded. |
| **What can be dispatched** | Only an existing application with `type = 'app'`, `published = 1` **and** `dispatchable = 1` (a per-app admin switch, off by default). Never an arbitrary script or command. The package's `manifest.json` id must equal the application id. |
| **Which code runs** | A pinned version; the server stores the package's `sha256`. If the client has to install/upgrade, it downloads that version and rejects a hash mismatch (`HASH_MISMATCH`). Installed newer versions are never downgraded. |
| **Parameters** | Validated against the package manifest (unknown keys, types, enum values). `__`-prefixed keys are rejected by the server and stripped again by the client's shared run pipeline. |
| **Client consent** | Default mode **`always-confirm`**: every task waits in a "pending remote tasks" list until the user reviews it (dispatcher, reason, params — editable) and clicks *Confirm & Run* or *Reject*. |
| **Opt-in silent mode** | `silent` runs an *already installed, exact-version* app without a prompt, but still confirms when: the dispatcher forced confirmation, the manifest has `confirm_before_run`, a required param is missing, a `path`/`text` param is preset, or the app must be installed/upgraded. Silent runs show a system notification and a **Remote** badge in the output panel. |
| **Opt-out** | `disabled` skips every task (`SKIPPED · DISABLED_BY_USER`). Settings → General → *Remote Tasks*. |
| **Run pipeline** | Runs go through `main/services/subapp-run.service.ts` like every other launch path: reserved-key stripping, builtin kill-switch, `__project` / `__app_config` / `__user` injection, Python + requirements. |
| **Auditing** | Tasks are never hard-deleted; `dispatched_task_executions` keeps one row per machine. Each run also writes a full, redacted log to `{userData}/task-logs/remote/` (30 days / 200 files) — *View task logs* in Settings — and a head+tail excerpt (≤ 32K chars) is reported back. |
| **Isolation between users** | Status / heartbeat / report requests only touch execution rows owned by the caller's user id; another user who knows a machine id cannot drive or overwrite them. |

What it does **not** protect against: a compromised admin account or server
can still dispatch any *dispatchable* app to clients in `silent` mode. Keep
`dispatchable` limited to apps that are safe to run unattended, and leave
clients in `always-confirm` unless you control both sides.

## Flow

```
Admin panel ──POST /admin/tasks/dispatch──▶ DB (dispatched_tasks)
                                             │  every worker polls (3s)
Client ◀── SSE  event: NEW_TASK {taskId} ────┘  (signal only)
Client ──POST /client/tasks/pull {machineId}──▶ claim RECEIVED (unique task+machine)
Client: disabled? version/install plan? workspace? needs confirmation?
   └─ confirm needed → POST /status WAITING_CONFIRM → pending list (UI)
Client ──POST /status RUNNING──▶ gate (fails 409/410 if revoked/expired/already run)
Client: subapp-run pipeline → executeSubAppWithCallbacks, heartbeat every 60s
Client ──POST /report {status, exitCode, durationMs, summary, logExcerpt}──▶ (via outbox)
```

- **Fan-out across PM2 workers**: each worker keeps only its own SSE
  connections, so the dispatch request only writes to the DB and every worker
  polls `dispatched_tasks` (`created_at` window with 10s overlap, `seen` set)
  and notifies its local connections. `ALL` tasks carry a 5s jitter hint.
- **Catch-up**: clients also pull on start/login, after every SSE reconnect
  and every ~15 minutes, so offline clients run still-valid tasks later.
- **Leases**: `RUNNING` holds a 180s lease renewed by heartbeats; a sweep every
  5 minutes marks stale `RUNNING` rows `ABANDONED` (a late report may still
  overwrite it) and unstarted rows of expired tasks `EXPIRED`.
- **Outbox**: terminal reports are persisted (`remote-task-outbox` store, 7
  days) and replayed; a run interrupted by a crash is reported as
  `FAILED · CLIENT_RESTARTED` on the next start.
- **One run per app**: if the same app is already running (manual, scheduled,
  IM, …) the remote run waits.

## States

| Status | Terminal | Set by | Meaning |
| :--- | :---: | :--- | :--- |
| `RECEIVED` | | server (pull) | claimed by this machine |
| `WAITING_CONFIRM` | | client | waiting for the user |
| `RUNNING` | | client | process running, lease held |
| `SUCCESS` / `FAILED` / `CANCELLED` | ✓ | client | result |
| `REJECTED` | ✓ | client | user rejected |
| `SKIPPED` | ✓ | client | precondition failed, see `reason_code` |
| `EXPIRED` / `REVOKED` | ✓ | server | not started before expiry / revoked by an admin |
| `ABANDONED` | ✓* | server sweep | lease expired; *a late report may overwrite |

`reason_code`: `DISABLED_BY_USER`, `APP_NOT_INSTALLED`, `VERSION_MISMATCH`,
`INSTALL_FAILED`, `HASH_MISMATCH`, `NO_WORKSPACE`, `PYTHON_UNAVAILABLE`,
`APP_DISABLED` (builtin kill-switch), `CLIENT_RESTARTED`, `CLIENT_ERROR`.

Revoking a task flips its `RECEIVED` / `WAITING_CONFIRM` executions to
`REVOKED`; `RUNNING` ones are allowed to finish.

## Data

Created by `backend/src/database/schema/dispatch.schema.ts` for SQLite, MySQL
and PostgreSQL, after the base schema (it adds `applications.dispatchable`).

- `dispatched_tasks`: `task_id`, `app_id`, `app_name`, `app_version`,
  `package_sha256`, `target_scope` (`ALL`/`USER`/`PROJECT`), `target_id`,
  `preset_params` (JSON), `force_confirm`, `auto_install`, `reason`,
  `dispatched_by`, `created_at`, `expires_at`, `revoked_at`, `revoked_by`
  (ms timestamps).
- `dispatched_task_executions`: one row per `(task_id, machine_id)` (unique
  index) with `user_id`, `status`, `reason_code`, `exit_code`, `duration_ms`,
  `summary`, `log_excerpt` (MEDIUMTEXT on MySQL), `claimed_at`, `started_at`,
  `completed_at`, `lease_expires_at`, `updated_at`.

## API

Admin (global admin JWT):

| Method | Path | Notes |
| :--- | :--- | :--- |
| POST | `/api/v1/admin/tasks/dispatch` | `{ appId, appVersion?, presetParams?, targetScope, targetId?, forceConfirm?, autoInstall?, reason?, expiresInHours? (1–168, default 24) }` → `{ taskId, appVersion, expiresAt, willConfirm }` (`willConfirm` is the server-side minimum; clients in `always-confirm` always ask) |
| POST | `/api/v1/admin/tasks/:taskId/revoke` | |
| GET | `/api/v1/admin/tasks?page&pageSize` | tasks with `status` (`ACTIVE`/`REVOKED`/`EXPIRED`) and `executionCounts` |
| GET | `/api/v1/admin/tasks/:taskId/executions` | per-machine rows incl. log excerpt |
| GET | `/api/v1/admin/tasks/app-manifest/:applicationId?version=` | manifest params of a package (dispatch form) |
| PATCH | `/api/v1/admin/applications/:applicationId/dispatchable` | `{ dispatchable: boolean }` |

Client (user JWT in the `Authorization` header — also for SSE, never in the URL):

| Method | Path | Notes |
| :--- | :--- | :--- |
| GET | `/api/v1/client/events` | SSE; `: ping` every 25s; `event: NEW_TASK` |
| POST | `/api/v1/client/tasks/pull` | `{ machineId }` → pending tasks for this user + machine |
| POST | `/api/v1/client/tasks/:taskId/status` | `{ machineId, status: 'WAITING_CONFIRM' \| 'RUNNING' }`; 409 invalid transition, 410 revoked/expired |
| POST | `/api/v1/client/tasks/:taskId/heartbeat` | `{ machineId }` |
| POST | `/api/v1/client/tasks/:taskId/report` | `{ machineId, status, reasonCode?, exitCode?, durationMs?, summary?, logExcerpt? }` (body limit 256kb; idempotent) |

`machineId` is a random UUID generated once per installation
(`machine-store`), not a hardware fingerprint.

## Code map

- Backend: `controllers/{adminTask,clientTask}Controller.ts`,
  `routes/{adminTask,clientTask}Routes.ts`, `repositories/dispatchedTaskRepository.ts`,
  `models/dispatchedTask.ts`, `services/clientEvents.service.ts` (SSE),
  `services/taskDispatchWatcher.service.ts` (fan-out + sweep, started in `index.ts`),
  test `__tests__/remoteTaskDispatch.test.ts`.
- Admin panel: `pages/TaskDispatchPage.tsx` (`/admin/tasks/dispatch`), *Dispatchable*
  switch on `ResourceDetailPage`.
- Desktop main: `services/remote-task.service.ts` (SSE, pull, queue, run),
  `remote-task-rules.ts` (validation / install plan / confirmation rules),
  `remote-task-outbox.ts`, `remote-task-logger.ts`, `store/machine.store.ts`,
  `ipc/remote-task.ipc.ts`, `settings.store` `remoteTaskMode`.
- Desktop renderer: `components/RemoteTaskManager.tsx` (pending pill, attention
  item, confirmation via `ParamDrawer`), `pages/Settings/RemoteTaskSettingsCard.tsx`,
  `window.api.remoteTask`.
