import { notifyUsers } from './clientEvents.service';
import * as dispatchRepo from '../repositories/dispatchedTaskRepository';
import { logger } from '../utils/logger';

const POLL_MS = 3_000;
const OVERLAP_MS = 10_000; // 覆盖多机时钟偏差与写入延迟
const SWEEP_MS = 5 * 60_000;
const BROADCAST_JITTER_MS = 5_000;

let timer: NodeJS.Timeout | null = null;
let lastTickAt = Date.now();
let lastSweepAt = 0;
const seen = new Map<string, number>(); // taskId -> created_at

export function startDispatchWatcher(): void {
  if (timer) return;
  lastTickAt = Date.now();
  const loop = async (): Promise<void> => {
    try {
      await tick();
    } catch (err) {
      logger.warn('[DispatchWatcher] tick failed:', err);
    }
    if (timer !== null) {
      timer = setTimeout(loop, POLL_MS);
    }
  };
  timer = setTimeout(loop, POLL_MS);
  logger.info('[DispatchWatcher] Started');
}

export function stopDispatchWatcher(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  seen.clear();
  logger.info('[DispatchWatcher] Stopped');
}

export async function tick(): Promise<void> {
  const now = Date.now();
  const since = lastTickAt - OVERLAP_MS;
  lastTickAt = now;

  const tasks = await dispatchRepo.listTasksCreatedSince(since, now);
  for (const task of tasks) {
    if (seen.has(task.taskId)) continue;
    seen.set(task.taskId, task.createdAt);

    if (task.targetScope === 'ALL') {
      notifyUsers('NEW_TASK', { taskId: task.taskId, jitterMs: BROADCAST_JITTER_MS }, 'ALL');
    } else {
      const userIds =
        task.targetScope === 'USER'
          ? (task.targetId ? [task.targetId] : [])
          : await dispatchRepo.listProjectMemberIds(task.targetId || '');
      notifyUsers('NEW_TASK', { taskId: task.taskId, jitterMs: 0 }, new Set(userIds));
    }
  }

  for (const [taskId, createdAt] of seen) {
    if (createdAt < since) seen.delete(taskId);
  }

  if (now - lastSweepAt >= SWEEP_MS) {
    lastSweepAt = now;
    try {
      await dispatchRepo.markAbandonedLeases(now);
      await dispatchRepo.markExpiredExecutions(now);
    } catch (sweepErr) {
      logger.warn('[DispatchWatcher] Sweep failed:', sweepErr);
    }
  }
}
