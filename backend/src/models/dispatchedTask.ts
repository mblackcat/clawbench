export type TargetScope = 'ALL' | 'USER' | 'PROJECT';

export type DispatchedTaskStatus =
  | 'RECEIVED'
  | 'WAITING_CONFIRM'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'SKIPPED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ABANDONED';

export type DispatchedReasonCode =
  | 'DISABLED_BY_USER'
  | 'APP_NOT_INSTALLED'
  | 'VERSION_MISMATCH'
  | 'INSTALL_FAILED'
  | 'HASH_MISMATCH'
  | 'NO_WORKSPACE'
  | 'PYTHON_UNAVAILABLE'
  | 'CLIENT_RESTARTED'
  | 'CLIENT_ERROR'
  | string;

export interface DispatchedTaskRow {
  task_id: string;
  app_id: string;
  app_name: string;
  app_version: string;
  package_sha256: string;
  target_scope: TargetScope;
  target_id: string | null;
  preset_params: string | null;
  force_confirm: number;
  auto_install: number;
  reason: string | null;
  dispatched_by: string;
  created_at: number | string;
  expires_at: number | string;
  revoked_at: number | string | null;
  revoked_by: string | null;
}

export interface DispatchedTask {
  taskId: string;
  appId: string;
  appName: string;
  appVersion: string;
  packageSha256: string;
  targetScope: TargetScope;
  targetId: string | null;
  presetParams: Record<string, unknown>;
  forceConfirm: boolean;
  autoInstall: boolean;
  reason: string | null;
  dispatchedBy: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  revokedBy: string | null;
}

export interface DispatchedTaskExecutionRow {
  execution_id: string;
  task_id: string;
  user_id: string;
  machine_id: string;
  status: DispatchedTaskStatus;
  reason_code: string | null;
  exit_code: number | null;
  duration_ms: number | string | null;
  summary: string | null;
  log_excerpt: string | null;
  claimed_at: number | string;
  started_at: number | string | null;
  completed_at: number | string | null;
  lease_expires_at: number | string | null;
  updated_at: number | string;
}

export interface DispatchedTaskExecution {
  executionId: string;
  taskId: string;
  userId: string;
  machineId: string;
  status: DispatchedTaskStatus;
  reasonCode: string | null;
  exitCode: number | null;
  durationMs: number | null;
  summary: string | null;
  logExcerpt: string | null;
  claimedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  leaseExpiresAt: number | null;
  updatedAt: number;
}

export function taskRowToTask(row: DispatchedTaskRow): DispatchedTask {
  let presetParams: Record<string, unknown> = {};
  if (row.preset_params) {
    try {
      presetParams = JSON.parse(row.preset_params);
    } catch {
      presetParams = {};
    }
  }

  return {
    taskId: row.task_id,
    appId: row.app_id,
    appName: row.app_name,
    appVersion: row.app_version,
    packageSha256: row.package_sha256,
    targetScope: row.target_scope,
    targetId: row.target_id,
    presetParams,
    forceConfirm: Boolean(row.force_confirm),
    autoInstall: Boolean(row.auto_install),
    reason: row.reason,
    dispatchedBy: row.dispatched_by,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
    revokedBy: row.revoked_by,
  };
}

export function executionRowToExecution(row: DispatchedTaskExecutionRow): DispatchedTaskExecution {
  return {
    executionId: row.execution_id,
    taskId: row.task_id,
    userId: row.user_id,
    machineId: row.machine_id,
    status: row.status,
    reasonCode: row.reason_code,
    exitCode: row.exit_code,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    summary: row.summary,
    logExcerpt: row.log_excerpt,
    claimedAt: Number(row.claimed_at),
    startedAt: row.started_at != null ? Number(row.started_at) : null,
    completedAt: row.completed_at != null ? Number(row.completed_at) : null,
    leaseExpiresAt: row.lease_expires_at != null ? Number(row.lease_expires_at) : null,
    updatedAt: Number(row.updated_at),
  };
}
