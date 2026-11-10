import { Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest } from '../middleware/auth';
import { getApplicationById } from '../repositories/applicationRepository';
import {
  getLatestVersion,
  getVersionByNumber,
} from '../repositories/applicationVersionRepository';
import { getUserById } from '../repositories/userRepository';
import { getProjectById } from '../repositories/projectRepository';
import { storageService } from '../services/storage';
import { readZipEntry, MANIFEST_ID_PATTERN } from '../utils/zip';
import { logger } from '../utils/logger';
import * as dispatchRepo from '../repositories/dispatchedTaskRepository';
import { TargetScope } from '../models/dispatchedTask';

interface ManifestParamDef {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'enum' | 'path' | 'text';
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
}

const MAX_REASON_CHARS = 500;
const MAX_PRESET_PARAMS_BYTES = 32 * 1024;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validationError(res: Response, message: string): void {
  res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message } });
}

interface SubAppManifestMini {
  id: string;
  name: string;
  version: string;
  type?: string;
  confirm_before_run?: boolean;
  params?: ManifestParamDef[];
}

export async function dispatchTaskHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      appId,
      appVersion,
      presetParams = {},
      targetScope,
      targetId,
      forceConfirm = false,
      autoInstall = false,
      reason,
      expiresInHours = 24,
    } = req.body;

    if (!appId || typeof appId !== 'string' || !MANIFEST_ID_PATTERN.test(appId)) {
      validationError(res, 'appId is required and must be a valid application id');
      return;
    }

    if (appVersion !== undefined && appVersion !== null && typeof appVersion !== 'string') {
      validationError(res, 'appVersion must be a string');
      return;
    }

    // presetParams: a plain object; host-reserved `__` keys are never accepted
    // (the client strips them as well, see subapp-run.service on the desktop).
    if (!isPlainObject(presetParams)) {
      validationError(res, 'presetParams must be an object');
      return;
    }
    if (Object.keys(presetParams).some((k) => k.startsWith('__'))) {
      validationError(res, "presetParams keys must not start with '__' (reserved)");
      return;
    }
    if (JSON.stringify(presetParams).length > MAX_PRESET_PARAMS_BYTES) {
      validationError(res, 'presetParams is too large');
      return;
    }

    if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > MAX_REASON_CHARS)) {
      validationError(res, `reason must be a string of at most ${MAX_REASON_CHARS} characters`);
      return;
    }

    if (!['ALL', 'USER', 'PROJECT'].includes(targetScope)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'targetScope must be ALL, USER, or PROJECT' },
      });
      return;
    }

    if (targetScope !== 'ALL' && (!targetId || typeof targetId !== 'string')) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `targetId is required when targetScope is ${targetScope}` },
      });
      return;
    }

    const expHours = Number(expiresInHours);
    if (isNaN(expHours) || expHours < 1 || expHours > 168) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'expiresInHours must be between 1 and 168' },
      });
      return;
    }

    if (targetScope === 'USER') {
      const targetUser = await getUserById(targetId);
      if (!targetUser) {
        res.status(404).json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: `Target user ${targetId} not found` },
        });
        return;
      }
    } else if (targetScope === 'PROJECT') {
      const targetProject = await getProjectById(targetId);
      if (!targetProject) {
        res.status(404).json({
          success: false,
          error: { code: 'PROJECT_NOT_FOUND', message: `Target project ${targetId} not found` },
        });
        return;
      }
    }

    const application = await getApplicationById(appId);
    if (!application) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Application ${appId} not found` },
      });
      return;
    }

    if (!application.published) {
      res.status(400).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Application is not published' },
      });
      return;
    }

    if (application.type !== 'app') {
      res.status(400).json({
        success: false,
        error: { code: 'NOT_DISPATCHABLE', message: 'Only Python app resources can be dispatched' },
      });
      return;
    }

    if (!application.dispatchable) {
      res.status(400).json({
        success: false,
        error: { code: 'NOT_DISPATCHABLE', message: 'Application is not marked as dispatchable by admin' },
      });
      return;
    }

    const targetVersion = appVersion
      ? await getVersionByNumber(appId, appVersion)
      : await getLatestVersion(appId);

    if (!targetVersion) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Specified version for application ${appId} not found` },
      });
      return;
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await storageService.readFile(targetVersion.filePath);
    } catch (readErr) {
      logger.error(`Application package missing on disk for ${appId} v${targetVersion.version}:`, readErr);
      res.status(500).json({
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'Application package file is missing on the server' },
      });
      return;
    }

    const packageSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const manifestContent = readZipEntry(fileBuffer, 'manifest.json');
    if (!manifestContent) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PACKAGE', message: 'Application package is missing manifest.json' },
      });
      return;
    }

    let manifest: SubAppManifestMini;
    try {
      manifest = JSON.parse(manifestContent);
    } catch {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PACKAGE', message: 'manifest.json is not valid JSON' },
      });
      return;
    }

    // The client installs and runs the package by its manifest id; it must be
    // the application being dispatched (and the version the admin picked).
    if (!manifest || manifest.id !== appId || (manifest.type && manifest.type !== 'app')) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PACKAGE', message: 'Package manifest id/type does not match the application' },
      });
      return;
    }

    const paramDefs = Array.isArray(manifest.params) ? manifest.params : [];
    const paramDefMap = new Map<string, ManifestParamDef>();
    for (const p of paramDefs) {
      paramDefMap.set(p.name, p);
    }

    {
      for (const [key, val] of Object.entries(presetParams)) {
        const def = paramDefMap.get(key);
        if (!def) {
          res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: `Unknown parameter '${key}' for ${appId}` },
          });
          return;
        }

        if (val !== undefined && val !== null) {
          switch (def.type) {
            case 'boolean':
              if (typeof val !== 'boolean') {
                res.status(400).json({
                  success: false,
                  error: { code: 'VALIDATION_ERROR', message: `Parameter '${key}' must be a boolean` },
                });
                return;
              }
              break;
            case 'number':
              if (typeof val !== 'number' || isNaN(val)) {
                res.status(400).json({
                  success: false,
                  error: { code: 'VALIDATION_ERROR', message: `Parameter '${key}' must be a valid number` },
                });
                return;
              }
              break;
            case 'string':
            case 'path':
            case 'text':
              if (typeof val !== 'string') {
                res.status(400).json({
                  success: false,
                  error: { code: 'VALIDATION_ERROR', message: `Parameter '${key}' must be a string` },
                });
                return;
              }
              break;
            case 'enum':
              if (typeof val !== 'string' || (def.options && def.options.length > 0 && !def.options.includes(val))) {
                res.status(400).json({
                  success: false,
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: `Parameter '${key}' must be one of: ${(def.options || []).join(', ')}`,
                  },
                });
                return;
              }
              break;
          }
        }
      }
    }

    const missingRequired = paramDefs.some((p) => {
      const val = presetParams[p.name];
      return p.required && (val === undefined || val === null || val === '');
    });

    const hasSensitiveParam = paramDefs.some(
      (p) => (p.type === 'path' || p.type === 'text') && presetParams[p.name] !== undefined
    );

    const willConfirm = Boolean(
      forceConfirm ||
      manifest.confirm_before_run ||
      missingRequired ||
      hasSensitiveParam
    );

    const now = Date.now();
    const expiresAt = now + expHours * 3600 * 1000;
    const taskId = `disp-${uuidv4()}`;

    await dispatchRepo.createDispatchedTask({
      taskId,
      appId,
      appName: application.name || manifest.name || appId,
      appVersion: targetVersion.version,
      packageSha256,
      targetScope: targetScope as TargetScope,
      targetId: targetScope === 'ALL' ? null : targetId,
      presetParams: presetParams || {},
      forceConfirm: Boolean(forceConfirm),
      autoInstall: Boolean(autoInstall),
      reason: (reason as string | undefined)?.trim() || null,
      dispatchedBy: req.userId!,
      createdAt: now,
      expiresAt,
      revokedAt: null,
      revokedBy: null,
    });

    res.status(200).json({
      success: true,
      data: {
        taskId,
        appVersion: targetVersion.version,
        expiresAt,
        willConfirm,
      },
    });
  } catch (err) {
    logger.error('Error dispatching remote task:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

export async function revokeTaskHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const task = await dispatchRepo.getDispatchedTaskById(taskId);
    if (!task) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found' },
      });
      return;
    }

    if (task.revokedAt != null) {
      res.status(400).json({
        success: false,
        error: { code: 'ALREADY_REVOKED', message: 'Task is already revoked' },
      });
      return;
    }

    const success = await dispatchRepo.revokeDispatchedTask(taskId, req.userId!);
    res.status(200).json({
      success: true,
      data: { revoked: success },
    });
  } catch (err) {
    logger.error('Error revoking task:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

export async function listTasksHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 20;

    const result = await dispatchRepo.listDispatchedTasks({ page, pageSize });
    res.status(200).json({
      success: true,
      data: {
        tasks: result.tasks,
        total: result.total,
        page,
        pageSize,
      },
    });
  } catch (err) {
    logger.error('Error listing dispatched tasks:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

export async function getTaskExecutionsHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const task = await dispatchRepo.getDispatchedTaskById(taskId);
    if (!task) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found' },
      });
      return;
    }

    const executions = await dispatchRepo.listTaskExecutions(taskId);
    res.status(200).json({
      success: true,
      data: executions,
    });
  } catch (err) {
    logger.error('Error getting task executions:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

export async function updateAppDispatchableHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { applicationId } = req.params;
    const { dispatchable } = req.body;

    if (typeof dispatchable !== 'boolean') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'dispatchable must be a boolean' },
      });
      return;
    }

    const app = await getApplicationById(applicationId);
    if (!app) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Application not found' },
      });
      return;
    }

    await dispatchRepo.setApplicationDispatchable(applicationId, dispatchable);
    res.status(200).json({
      success: true,
      data: { applicationId, dispatchable },
    });
  } catch (err) {
    logger.error('Error updating application dispatchable state:', err);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}
