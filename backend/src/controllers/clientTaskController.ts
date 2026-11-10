import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as dispatchRepo from '../repositories/dispatchedTaskRepository';
import { DispatchedTaskStatus } from '../models/dispatchedTask';
import { logger } from '../utils/logger';

const MAX_LOG_EXCERPT_CHARS = 32_000;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_REASON_CODE_CHARS = 64;
/** Client-generated random id (UUID); bounded so it fits the indexed column. */
const MACHINE_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

function isValidMachineId(machineId: unknown): machineId is string {
  return typeof machineId === 'string' && MACHINE_ID_PATTERN.test(machineId);
}

function optionalString(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export async function pullTasksHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { machineId } = req.body;
    if (!isValidMachineId(machineId)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'machineId is required' },
      });
      return;
    }

    const tasks = await dispatchRepo.pullForMachine(req.userId!, machineId);
    res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (err) {
    logger.error('Error pulling remote tasks:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

export async function updateStatusHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const { machineId, status, reasonCode, summary } = req.body;

    if (!isValidMachineId(machineId)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'machineId is required' },
      });
      return;
    }

    if (status !== 'WAITING_CONFIRM' && status !== 'RUNNING') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'status must be WAITING_CONFIRM or RUNNING' },
      });
      return;
    }

    if (status === 'RUNNING') {
      const result = await dispatchRepo.markRunning(taskId, req.userId!, machineId);
      if (result.success) {
        res.status(200).json({
          success: true,
          data: { leaseExpiresAt: result.leaseExpiresAt },
        });
        return;
      }

      if (result.reason === 'TASK_REVOKED_OR_EXPIRED') {
        res.status(410).json({
          success: false,
          error: { code: 'TASK_REVOKED_OR_EXPIRED', message: 'Task has been revoked or expired' },
        });
        return;
      }

      if (result.reason === 'INVALID_TRANSITION') {
        res.status(409).json({
          success: false,
          error: { code: 'INVALID_TRANSITION', message: 'Task execution cannot be transitioned to RUNNING' },
        });
        return;
      }

      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task or execution not found' },
      });
      return;
    }

    // status === 'WAITING_CONFIRM'
    const result = await dispatchRepo.updateExecutionStatus(
      taskId,
      req.userId!,
      machineId,
      'WAITING_CONFIRM',
      {
        reasonCode: optionalString(reasonCode, MAX_REASON_CODE_CHARS) ?? undefined,
        summary: optionalString(summary, MAX_SUMMARY_CHARS) ?? undefined,
      }
    );

    if (result.success) {
      res.status(200).json({
        success: true,
        data: { updated: true },
      });
      return;
    }

    if (result.reason === 'TASK_REVOKED_OR_EXPIRED') {
      res.status(410).json({
        success: false,
        error: { code: 'TASK_REVOKED_OR_EXPIRED', message: 'Task has been revoked or expired' },
      });
      return;
    }

    if (result.reason === 'INVALID_TRANSITION') {
      res.status(409).json({
        success: false,
        error: { code: 'INVALID_TRANSITION', message: 'Invalid state transition' },
      });
      return;
    }

    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Task or execution not found' },
    });
  } catch (err) {
    logger.error('Error updating task execution status:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

export async function heartbeatHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const { machineId } = req.body;

    if (!isValidMachineId(machineId)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'machineId is required' },
      });
      return;
    }

    const result = await dispatchRepo.heartbeat(taskId, req.userId!, machineId);
    if (result.success) {
      res.status(200).json({
        success: true,
        data: { leaseExpiresAt: result.leaseExpiresAt },
      });
      return;
    }

    res.status(409).json({
      success: false,
      error: { code: 'HEARTBEAT_REJECTED', message: 'Task execution is not RUNNING or ABANDONED' },
    });
  } catch (err) {
    logger.error('Error processing task heartbeat:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

export async function reportHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const {
      machineId,
      status,
      reasonCode,
      exitCode,
      durationMs,
      summary,
      logExcerpt,
    } = req.body;

    if (!isValidMachineId(machineId)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'machineId is required' },
      });
      return;
    }

    const terminalStates: DispatchedTaskStatus[] = [
      'SUCCESS',
      'FAILED',
      'CANCELLED',
      'REJECTED',
      'SKIPPED',
    ];
    if (!terminalStates.includes(status)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `status must be one of: ${terminalStates.join(', ')}`,
        },
      });
      return;
    }

    let trimmedLogExcerpt: string | null = null;
    if (typeof logExcerpt === 'string') {
      trimmedLogExcerpt =
        logExcerpt.length > MAX_LOG_EXCERPT_CHARS
          ? logExcerpt.slice(0, MAX_LOG_EXCERPT_CHARS)
          : logExcerpt;
    }

    const toInt = (v: unknown): number | null => {
      if (v === undefined || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    };

    const result = await dispatchRepo.reportExecution(taskId, req.userId!, machineId, {
      status,
      reasonCode: optionalString(reasonCode, MAX_REASON_CODE_CHARS),
      exitCode: toInt(exitCode),
      durationMs: toInt(durationMs),
      summary: optionalString(summary, MAX_SUMMARY_CHARS),
      logExcerpt: trimmedLogExcerpt,
    });

    if (result.success) {
      res.status(200).json({
        success: true,
        data: { reported: true },
      });
      return;
    }

    if (result.reason === 'INVALID_TRANSITION') {
      res.status(409).json({
        success: false,
        error: { code: 'INVALID_TRANSITION', message: 'Execution is in a non-modifiable terminal state' },
      });
      return;
    }

    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Task or execution not found' },
    });
  } catch (err) {
    logger.error('Error reporting task execution:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}
