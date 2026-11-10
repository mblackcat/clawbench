import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import { config } from '../config';
import type { DispatchDialect as Dialect } from '../database/schema/dispatch.schema';
import {
  DispatchedTask,
  DispatchedTaskExecution,
  DispatchedTaskExecutionRow,
  DispatchedTaskRow,
  DispatchedTaskStatus,
  executionRowToExecution,
  taskRowToTask,
} from '../models/dispatchedTask';

function getDialect(): Dialect {
  const dbType = config.database.type;
  return dbType === 'mysql' || dbType === 'postgres' ? dbType : 'sqlite';
}

function insertIgnore(dialect: Dialect, table: string, cols: string[]): string {
  const sql = `INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  if (dialect === 'mysql') return `INSERT IGNORE ${sql}`;
  if (dialect === 'postgres') return `INSERT ${sql} ON CONFLICT DO NOTHING`;
  return `INSERT OR IGNORE ${sql}`;
}

/** Lease granted on RUNNING / heartbeat; the client heartbeats every 60s. */
export const LEASE_MS = 180_000;

export type DispatchedTaskListStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export function deriveTaskStatus(task: DispatchedTask, now = Date.now()): DispatchedTaskListStatus {
  if (task.revokedAt != null) return 'REVOKED';
  if (task.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

export interface PulledTaskItem {
  taskId: string;
  appId: string;
  appName: string;
  appVersion: string;
  packageSha256: string;
  presetParams: Record<string, unknown>;
  forceConfirm: boolean;
  autoInstall: boolean;
  reason: string | null;
  dispatchedByName: string | null;
  executionStatus: 'RECEIVED' | 'WAITING_CONFIRM';
  expiresAt: number;
}

export async function createDispatchedTask(task: DispatchedTask): Promise<void> {
  await database.run(
    `INSERT INTO dispatched_tasks (
      task_id, app_id, app_name, app_version, package_sha256,
      target_scope, target_id, preset_params, force_confirm, auto_install,
      reason, dispatched_by, created_at, expires_at, revoked_at, revoked_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.taskId,
      task.appId,
      task.appName,
      task.appVersion,
      task.packageSha256,
      task.targetScope,
      task.targetId || null,
      JSON.stringify(task.presetParams || {}),
      task.forceConfirm ? 1 : 0,
      task.autoInstall ? 1 : 0,
      task.reason || null,
      task.dispatchedBy,
      task.createdAt,
      task.expiresAt,
      task.revokedAt || null,
      task.revokedBy || null,
    ]
  );
}

export async function getDispatchedTaskById(taskId: string): Promise<DispatchedTask | undefined> {
  const row = await database.get<DispatchedTaskRow>(
    'SELECT * FROM dispatched_tasks WHERE task_id = ?',
    [taskId]
  );
  return row ? taskRowToTask(row) : undefined;
}

export async function revokeDispatchedTask(taskId: string, revokedBy: string): Promise<boolean> {
  const now = Date.now();
  const { changes } = await database.run(
    'UPDATE dispatched_tasks SET revoked_at = ?, revoked_by = ? WHERE task_id = ? AND revoked_at IS NULL',
    [now, revokedBy, taskId]
  );
  if (changes === 0) return false;

  // 撤回：RECEIVED / WAITING_CONFIRM 立即置为 REVOKED
  await database.run(
    `UPDATE dispatched_task_executions
     SET status = 'REVOKED', updated_at = ?
     WHERE task_id = ? AND status IN ('RECEIVED', 'WAITING_CONFIRM')`,
    [now, taskId]
  );

  return true;
}

export async function listDispatchedTasks(options: {
  page?: number;
  pageSize?: number;
}): Promise<{
  tasks: Array<
    DispatchedTask & {
      status: DispatchedTaskListStatus;
      stats: Record<string, number>;
      /** Same as `stats` (name used by the admin panel). */
      executionCounts: Record<string, number>;
      totalExecutions: number;
      dispatchedByName?: string;
    }
  >;
  total: number;
}> {
  const page = Math.max(1, options.page || 1);
  const pageSize = Math.max(1, Math.min(100, options.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const countRow = await database.get<{ total: number | string }>(
    'SELECT COUNT(*) as total FROM dispatched_tasks'
  );
  const total = countRow ? Number(countRow.total) : 0;

  const rows = await database.all<DispatchedTaskRow & { dispatched_by_name?: string }>(
    `SELECT t.*, u.username AS dispatched_by_name
     FROM dispatched_tasks t
     LEFT JOIN users u ON u.user_id = t.dispatched_by
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );

  if (rows.length === 0) {
    return { tasks: [], total };
  }

  const taskIds = rows.map((r) => r.task_id);
  const placeholders = taskIds.map(() => '?').join(', ');
  const statRows = await database.all<{ task_id: string; status: string; count: number | string }>(
    `SELECT task_id, status, COUNT(*) as count
     FROM dispatched_task_executions
     WHERE task_id IN (${placeholders})
     GROUP BY task_id, status`,
    taskIds
  );

  const statsMap = new Map<string, Record<string, number>>();
  const totalMap = new Map<string, number>();

  for (const tid of taskIds) {
    statsMap.set(tid, {});
    totalMap.set(tid, 0);
  }

  for (const s of statRows) {
    const cur = statsMap.get(s.task_id) || {};
    const cnt = Number(s.count);
    cur[s.status] = cnt;
    statsMap.set(s.task_id, cur);
    totalMap.set(s.task_id, (totalMap.get(s.task_id) || 0) + cnt);
  }

  const now = Date.now();
  const tasks = rows.map((r) => {
    const task = taskRowToTask(r);
    const stats = statsMap.get(task.taskId) || {};
    return {
      ...task,
      status: deriveTaskStatus(task, now),
      dispatchedByName: r.dispatched_by_name,
      stats,
      executionCounts: stats,
      totalExecutions: totalMap.get(task.taskId) || 0,
    };
  });

  return { tasks, total };
}

export async function listTaskExecutions(
  taskId: string
): Promise<Array<DispatchedTaskExecution & { username?: string }>> {
  const rows = await database.all<DispatchedTaskExecutionRow & { username?: string }>(
    `SELECT e.*, u.username
     FROM dispatched_task_executions e
     LEFT JOIN users u ON u.user_id = e.user_id
     WHERE e.task_id = ?
     ORDER BY e.claimed_at DESC`,
    [taskId]
  );

  return rows.map((r) => ({
    ...executionRowToExecution(r),
    username: r.username,
  }));
}

export async function setApplicationDispatchable(
  applicationId: string,
  dispatchable: boolean
): Promise<boolean> {
  const { changes } = await database.run(
    'UPDATE applications SET dispatchable = ? WHERE application_id = ?',
    [dispatchable ? 1 : 0, applicationId]
  );
  return changes > 0;
}

export async function listTasksCreatedSince(since: number, now: number): Promise<DispatchedTask[]> {
  const rows = await database.all<DispatchedTaskRow>(
    `SELECT * FROM dispatched_tasks
     WHERE revoked_at IS NULL AND expires_at > ? AND created_at > ?
     ORDER BY created_at ASC`,
    [now, since]
  );
  return rows.map(taskRowToTask);
}

export async function listProjectMemberIds(projectId: string): Promise<string[]> {
  const rows = await database.all<{ user_id: string }>(
    'SELECT user_id FROM project_members WHERE project_id = ?',
    [projectId]
  );
  return rows.map((r) => r.user_id);
}

export async function pullForMachine(userId: string, machineId: string): Promise<PulledTaskItem[]> {
  const now = Date.now();
  const dialect = getDialect();

  // 1. 查找此机器尚未认领的候选有效任务
  const candidates = await database.all<DispatchedTaskRow>(
    `SELECT t.* FROM dispatched_tasks t
     WHERE t.expires_at > ? AND t.revoked_at IS NULL
       AND (t.target_scope = 'ALL'
         OR (t.target_scope = 'USER' AND t.target_id = ?)
         OR (t.target_scope = 'PROJECT' AND t.target_id IN
             (SELECT project_id FROM project_members WHERE user_id = ?)))
       AND NOT EXISTS (SELECT 1 FROM dispatched_task_executions e
                       WHERE e.task_id = t.task_id AND e.machine_id = ?)
     ORDER BY t.created_at ASC
     LIMIT 20`,
    [now, userId, userId, machineId]
  );

  // 2. 为候选任务插入 RECEIVED 记录（利用唯一约束原子认领）
  if (candidates.length > 0) {
    const insertSql = insertIgnore(dialect, 'dispatched_task_executions', [
      'execution_id',
      'task_id',
      'user_id',
      'machine_id',
      'status',
      'claimed_at',
      'updated_at',
    ]);
    for (const t of candidates) {
      await database.run(insertSql, [
        uuidv4(),
        t.task_id,
        userId,
        machineId,
        'RECEIVED',
        now,
        now,
      ]);
    }
  }

  // 3. 返回本机本用户所有 RECEIVED / WAITING_CONFIRM 状态且仍有效的任务
  const rows = await database.all<
    DispatchedTaskRow & { execution_status: 'RECEIVED' | 'WAITING_CONFIRM'; dispatched_by_name?: string }
  >(
    `SELECT t.*, e.status AS execution_status, u.username AS dispatched_by_name
     FROM dispatched_task_executions e
     JOIN dispatched_tasks t ON t.task_id = e.task_id
     LEFT JOIN users u ON u.user_id = t.dispatched_by
     WHERE e.machine_id = ? AND e.user_id = ?
       AND e.status IN ('RECEIVED', 'WAITING_CONFIRM')
       AND t.expires_at > ? AND t.revoked_at IS NULL
     ORDER BY t.created_at ASC`,
    [machineId, userId, now]
  );

  return rows.map((r) => {
    let presetParams: Record<string, unknown> = {};
    if (r.preset_params) {
      try {
        presetParams = JSON.parse(r.preset_params);
      } catch {
        presetParams = {};
      }
    }
    return {
      taskId: r.task_id,
      appId: r.app_id,
      appName: r.app_name,
      appVersion: r.app_version,
      packageSha256: r.package_sha256,
      presetParams,
      forceConfirm: Boolean(r.force_confirm),
      autoInstall: Boolean(r.auto_install),
      reason: r.reason,
      dispatchedByName: r.dispatched_by_name || null,
      executionStatus: r.execution_status,
      expiresAt: Number(r.expires_at),
    };
  });
}

export async function markRunning(
  taskId: string,
  userId: string,
  machineId: string
): Promise<{
  success: boolean;
  reason?: 'INVALID_TRANSITION' | 'TASK_REVOKED_OR_EXPIRED' | 'NOT_FOUND';
  leaseExpiresAt?: number;
}> {
  const now = Date.now();
  const leaseExpiresAt = now + LEASE_MS;

  const { changes } = await database.run(
    `UPDATE dispatched_task_executions
     SET status = 'RUNNING', started_at = ?, lease_expires_at = ?, updated_at = ?
     WHERE task_id = ? AND user_id = ? AND machine_id = ?
       AND status IN ('RECEIVED', 'WAITING_CONFIRM')
       AND EXISTS (SELECT 1 FROM dispatched_tasks t
                   WHERE t.task_id = dispatched_task_executions.task_id
                     AND t.expires_at > ? AND t.revoked_at IS NULL)`,
    [now, leaseExpiresAt, now, taskId, userId, machineId, now]
  );

  if (changes === 1) {
    return { success: true, leaseExpiresAt };
  }

  // 失败时区分具体原因
  const task = await getDispatchedTaskById(taskId);
  if (!task) {
    return { success: false, reason: 'NOT_FOUND' };
  }
  if (task.revokedAt != null || task.expiresAt <= now) {
    return { success: false, reason: 'TASK_REVOKED_OR_EXPIRED' };
  }

  const execution = await database.get<DispatchedTaskExecutionRow>(
    'SELECT * FROM dispatched_task_executions WHERE task_id = ? AND machine_id = ? AND user_id = ?',
    [taskId, machineId, userId]
  );
  if (!execution) {
    return { success: false, reason: 'NOT_FOUND' };
  }

  return { success: false, reason: 'INVALID_TRANSITION' };
}

export async function updateExecutionStatus(
  taskId: string,
  userId: string,
  machineId: string,
  targetStatus: DispatchedTaskStatus,
  extra?: { reasonCode?: string; summary?: string }
): Promise<{ success: boolean; reason?: string; leaseExpiresAt?: number }> {
  const now = Date.now();
  const task = await getDispatchedTaskById(taskId);
  if (!task) return { success: false, reason: 'NOT_FOUND' };

  const execution = await database.get<DispatchedTaskExecutionRow>(
    'SELECT * FROM dispatched_task_executions WHERE task_id = ? AND machine_id = ? AND user_id = ?',
    [taskId, machineId, userId]
  );
  if (!execution) return { success: false, reason: 'NOT_FOUND' };

  if (task.revokedAt != null || task.expiresAt <= now) {
    return { success: false, reason: 'TASK_REVOKED_OR_EXPIRED' };
  }

  const currentStatus = execution.status;

  // 幂等处理
  if (currentStatus === targetStatus) {
    return { success: true };
  }

  // 状态机转换规则检查
  const validTransitions: Record<string, string[]> = {
    RECEIVED: ['WAITING_CONFIRM', 'RUNNING', 'SKIPPED', 'FAILED'],
    WAITING_CONFIRM: ['WAITING_CONFIRM', 'RUNNING', 'REJECTED', 'SKIPPED', 'FAILED'],
    RUNNING: ['SUCCESS', 'FAILED', 'CANCELLED', 'ABANDONED'],
    ABANDONED: ['RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'],
  };

  const allowed = validTransitions[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    return { success: false, reason: 'INVALID_TRANSITION' };
  }

  let leaseExpiresAt: number | null = execution.lease_expires_at ? Number(execution.lease_expires_at) : null;
  if (targetStatus === 'RUNNING') {
    leaseExpiresAt = now + LEASE_MS;
  }

  const { changes } = await database.run(
    `UPDATE dispatched_task_executions
     SET status = ?, reason_code = COALESCE(?, reason_code),
         summary = COALESCE(?, summary),
         lease_expires_at = ?,
         updated_at = ?
     WHERE task_id = ? AND machine_id = ? AND user_id = ? AND status = ?`,
    [
      targetStatus,
      extra?.reasonCode || null,
      extra?.summary || null,
      leaseExpiresAt,
      now,
      taskId,
      machineId,
      userId,
      currentStatus,
    ]
  );

  if (changes === 1) {
    return { success: true, leaseExpiresAt: leaseExpiresAt ?? undefined };
  }
  return { success: false, reason: 'INVALID_TRANSITION' };
}

export async function heartbeat(
  taskId: string,
  userId: string,
  machineId: string
): Promise<{ success: boolean; leaseExpiresAt?: number }> {
  const now = Date.now();
  const leaseExpiresAt = now + LEASE_MS;

  const { changes } = await database.run(
    `UPDATE dispatched_task_executions
     SET status = 'RUNNING', lease_expires_at = ?, updated_at = ?
     WHERE task_id = ? AND machine_id = ? AND user_id = ? AND status IN ('RUNNING', 'ABANDONED')`,
    [leaseExpiresAt, now, taskId, machineId, userId]
  );

  if (changes > 0) {
    return { success: true, leaseExpiresAt };
  }
  return { success: false };
}

export async function reportExecution(
  taskId: string,
  userId: string,
  machineId: string,
  data: {
    status: DispatchedTaskStatus;
    reasonCode?: string | null;
    exitCode?: number | null;
    durationMs?: number | null;
    summary?: string | null;
    logExcerpt?: string | null;
  }
): Promise<{ success: boolean; reason?: string }> {
  const now = Date.now();
  const execution = await database.get<DispatchedTaskExecutionRow>(
    'SELECT * FROM dispatched_task_executions WHERE task_id = ? AND machine_id = ? AND user_id = ?',
    [taskId, machineId, userId]
  );

  if (!execution) {
    return { success: false, reason: 'NOT_FOUND' };
  }

  // 幂等处理：如果已经是相同的终态，直接返回成功
  if (execution.status === data.status) {
    return { success: true };
  }

  const terminalStates = new Set(['SUCCESS', 'FAILED', 'CANCELLED', 'REJECTED', 'SKIPPED']);
  if (!terminalStates.has(data.status)) {
    return { success: false, reason: 'INVALID_STATUS' };
  }

  // 允许从 RECEIVED, WAITING_CONFIRM, RUNNING, ABANDONED 转到终态
  const allowedPreStatuses = ['RECEIVED', 'WAITING_CONFIRM', 'RUNNING', 'ABANDONED'];
  if (!allowedPreStatuses.includes(execution.status)) {
    // 已经处于其他终态（如已 SUCCESS，再报 FAILED），拒绝
    return { success: false, reason: 'INVALID_TRANSITION' };
  }

  const { changes } = await database.run(
    `UPDATE dispatched_task_executions
     SET status = ?, reason_code = ?, exit_code = ?, duration_ms = ?,
         summary = ?, log_excerpt = ?, completed_at = ?, updated_at = ?
     WHERE task_id = ? AND machine_id = ? AND user_id = ?
       AND status IN ('RECEIVED', 'WAITING_CONFIRM', 'RUNNING', 'ABANDONED')`,
    [
      data.status,
      data.reasonCode ?? null,
      data.exitCode ?? null,
      data.durationMs ?? null,
      data.summary ?? null,
      data.logExcerpt ?? null,
      now,
      now,
      taskId,
      machineId,
      userId,
    ]
  );

  return { success: changes > 0 };
}

export async function markAbandonedLeases(now: number): Promise<number> {
  const { changes } = await database.run(
    `UPDATE dispatched_task_executions
     SET status = 'ABANDONED', updated_at = ?
     WHERE status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
    [now, now]
  );
  return changes;
}

export async function markExpiredExecutions(now: number): Promise<number> {
  const { changes } = await database.run(
    `UPDATE dispatched_task_executions
     SET status = 'EXPIRED', updated_at = ?
     WHERE status IN ('RECEIVED', 'WAITING_CONFIRM')
       AND EXISTS (
         SELECT 1 FROM dispatched_tasks t
         WHERE t.task_id = dispatched_task_executions.task_id
           AND t.expires_at <= ?
       )`,
    [now, now]
  );
  return changes;
}
